"""
Every advertised `allowed_actions` entry has a route behind it.

The frontend renders invoice and quotation header buttons directly from the
server's `allowed_actions` list (`InvoiceDetailPage.jsx`,
`QuotationDetailPage.jsx`), skipping any action it has no label for. So the list
is a promise: if the API says an action is available, calling it must work.

`allowed_actions` for invoices used to advertise `duplicate` and `delete` — the
state machine modelled both, no route implemented either, and the UI dropped them
on the floor. Nothing failed, so nothing was noticed: the contract simply lied,
and the buttons a user would most expect on a draft invoice were absent.

This walks the real Flask URL map rather than a hand-written list, so adding a
route makes the test pass and removing one makes it fail. A static list would
drift the moment someone added an endpoint.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions.database import db
from app.models import Invoice, Quotation

# Actions the API advertises, and the method + path that must implement each.
#
# `record_payment` and `delete_payment` are modelled but not part of the header
# action buttons — the payment list owns them — so they are listed with their
# routes to keep the mapping complete rather than being exceptions.
ACTION_ROUTES: dict[str, tuple[str, str]] = {
    # Quotations
    "send": ("POST", "/api/v1/quotations/<int:quotation_id>/status"),
    "approve": ("POST", "/api/v1/quotations/<int:quotation_id>/status"),
    "reject": ("POST", "/api/v1/quotations/<int:quotation_id>/status"),
    "reopen": ("POST", "/api/v1/quotations/<int:quotation_id>/status"),
    "duplicate": ("POST", "/api/v1/quotations/<int:quotation_id>/duplicate"),
    "delete": ("DELETE", "/api/v1/quotations/<int:quotation_id>"),
    "create_invoice": ("POST", "/api/v1/quotations/<int:quotation_id>/invoice"),
    # Invoices
    "issue": ("POST", "/api/v1/invoices/<int:invoice_id>/issue"),
    "cancel": ("POST", "/api/v1/invoices/<int:invoice_id>/cancel"),
    "record_payment": ("POST", "/api/v1/invoices/<int:invoice_id>/payments"),
    # Its own blueprint, and keyed by payment id alone rather than nested under the
    # invoice — the payment row already carries `invoice_id`, so nesting would
    # assert a relationship the route does not need to check.
    "delete_payment": ("DELETE", "/api/v1/payments/<int:payment_id>"),
}

# Deliberately not implemented. Advertising any of these is a broken promise, and
# the test below fails if one reappears in an `allowed_actions` list.
UNIMPLEMENTED_ACTIONS = {"record_payment_delete", "force_settle"}


@pytest.fixture
def rules():
    app = create_app({"TESTING": True})
    return {rule.rule: rule.methods for rule in app.url_map.iter_rules()}


def _assert_route_exists(action: str, rules) -> None:
    method, path = ACTION_ROUTES[action]
    assert path in rules, f"advertised action {action!r} has no route at {path}"
    assert method in rules[path], f"{path} does not accept {method}"


def test_every_advertised_action_has_a_route(rules):
    for action in ACTION_ROUTES:
        _assert_route_exists(action, rules)


@pytest.mark.parametrize("status", ["draft", "issued", "cancelled"])
def test_no_invoice_state_advertises_an_action_without_a_route(status, rules):
    """
    Walk every invoice state rather than trusting one snapshot.

    The bug was state-dependent in principle — `delete` was only advertised on a
    draft — so a single representative invoice would not have caught a regression
    added to the `issued` branch.
    """
    app = create_app({"TESTING": True})
    with app.app_context():
        db.create_all()
        invoice = Invoice(
            number=f"INV-TEST-{status}",
            year=2026,
            status=status,
            grand_total_paise=100_000,
        )
        # A draft needs a valid line to be issued; irrelevant here, but a
        # well-formed row keeps the guard output honest.
        db.session.add(invoice)
        db.session.commit()

        from app.services.lifecycle import get_invoice_allowed_actions

        actions = get_invoice_allowed_actions(invoice).to_list()
        db.session.remove()
        db.drop_all()

    for action in actions:
        assert action not in UNIMPLEMENTED_ACTIONS, (
            f"invoice in state {status!r} advertises {action!r}, which has no route"
        )
        if action in ACTION_ROUTES:
            _assert_route_exists(action, rules)
        else:
            pytest.fail(f"invoice in state {status!r} advertises unmapped action {action!r}")


@pytest.mark.parametrize("status", ["draft", "sent", "approved", "rejected", "converted"])
def test_no_quotation_state_advertises_an_action_without_a_route(status, rules):
    app = create_app({"TESTING": True})
    with app.app_context():
        db.create_all()
        from datetime import date

        quotation = Quotation(
            number=f"QTN-TEST-{status}",
            year=2026,
            quotation_date=date.today(),
            status=status,
        )
        db.session.add(quotation)
        db.session.commit()

        from app.services.lifecycle import get_quotation_allowed_actions

        actions = get_quotation_allowed_actions(quotation).to_list()
        db.session.remove()
        db.drop_all()

    for action in actions:
        assert action not in UNIMPLEMENTED_ACTIONS, (
            f"quotation in state {status!r} advertises {action!r}, which has no route"
        )
        if action in ACTION_ROUTES:
            _assert_route_exists(action, rules)
        else:
            pytest.fail(f"quotation in state {status!r} advertises unmapped action {action!r}")


def test_invoice_does_not_advertise_duplicate_or_delete(client):
    """
    The specific regression, named so a reintroduction points at itself.

    Both are modelled in the state machine and neither has a route. A draft is
    where they were advertised, and where a user would look for them.
    """
    app = create_app({"TESTING": True})
    with app.app_context():
        db.create_all()
        invoice = Invoice(number="INV-1", year=2026, status="draft", grand_total_paise=100)
        db.session.add(invoice)
        db.session.commit()

        from app.services.lifecycle import get_invoice_allowed_actions

        actions = get_invoice_allowed_actions(invoice).to_list()
        db.session.remove()
        db.drop_all()

    assert "duplicate" not in actions
    assert "delete" not in actions
    # The actions that do have routes are still there.
    assert "cancel" in actions
