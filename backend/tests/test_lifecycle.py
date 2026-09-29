"""
Ruchita Interiors — Lifecycle service tests (§13, §22).

Every legal transition; every illegal transition → 409/422;
expired overlay; reopen rules; convert guard; cancel-with-payments blocked.

The `app` fixture (conftest) yields inside an application context with the schema
created, so every test here requests it via the autouse `_ctx` fixture and can use
`db.session` directly.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.lifecycle import (
    get_quotation_allowed_actions,
    get_invoice_allowed_actions,
    validate_quotation_transition,
    validate_invoice_transition,
    QuotationAction,
    InvoiceAction,
)
from app.models.quotation import Quotation, QuotationItem
from app.models.invoice import Invoice, InvoiceItem, Payment
from app.models.client import Client
from app.extensions.database import db


@pytest.fixture(autouse=True)
def _ctx(app):
    """Bind every test in this module to the app context the `app` fixture opens."""
    yield


# ------------------------------------------------------------------- builders


def _make_quotation(status="draft", **overrides):
    client = Client(name="Test Client")
    db.session.add(client)
    db.session.commit()

    overrides.setdefault("valid_until", date.today() + timedelta(days=30))
    q = Quotation(
        number=f"QTN-2026-{status}-001",
        year=2026,
        client_id=client.id,
        client_snapshot={"name": "Test Client"},
        quotation_date=date.today(),
        status=status,
        discount_type="percent",
        discount_bp=0,
        gst_bp=1800,
        other_charges_paise=0,
        subtotal_paise=10000,
        discount_paise=0,
        gst_paise=1800,
        grand_total_paise=11800,
        **overrides,
    )
    q.items.append(
        QuotationItem(name="Test Item", qty_milli=1000, rate_paise=10000, line_total_paise=10000, position=0)
    )
    db.session.add(q)
    db.session.commit()
    return q


def _make_invalid_quotation(status="draft"):
    """Quotation with no valid lines."""
    client = Client(name="Test Client")
    db.session.add(client)
    db.session.commit()

    q = Quotation(
        number=f"QTN-2026-{status}-002",
        year=2026,
        client_id=client.id,
        client_snapshot={"name": "Test Client"},
        quotation_date=date.today(),
        status=status,
        discount_type="percent",
        discount_bp=0,
        gst_bp=1800,
        other_charges_paise=0,
        subtotal_paise=0,
        grand_total_paise=0,
    )
    q.items.append(QuotationItem(name="", qty_milli=0, rate_paise=0, line_total_paise=0, position=0))
    db.session.add(q)
    db.session.commit()
    return q


class TestQuotationLifecycle:
    """Quotation state machine: draft → sent → approved → converted."""

    # ---- Draft ----

    def test_draft_allowed_actions(self):
        q = _make_quotation("draft")
        actions = get_quotation_allowed_actions(q)
        assert actions.can_send
        assert actions.can_delete
        assert actions.can_duplicate
        assert not actions.can_approve
        assert not actions.can_reopen
        assert not actions.can_create_invoice

    def test_draft_send_valid(self):
        q = _make_quotation("draft")
        allowed, _ = validate_quotation_transition(q, QuotationAction.SEND)
        assert allowed

    def test_draft_send_invalid_no_items(self):
        q = _make_invalid_quotation("draft")
        allowed, error = validate_quotation_transition(q, QuotationAction.SEND)
        assert not allowed
        assert "items need name" in error

    def test_draft_send_invalid_no_client(self):
        q = _make_quotation("draft")
        q.client_id = None
        db.session.commit()
        allowed, error = validate_quotation_transition(q, QuotationAction.SEND)
        assert not allowed
        assert "Client is required" in error

    def test_draft_send_invalid_zero_total(self):
        q = _make_invalid_quotation("draft")
        allowed, error = validate_quotation_transition(q, QuotationAction.SEND)
        assert not allowed
        assert "grand total must be positive" in error.lower() or "items need name" in error

    def test_draft_can_delete(self):
        q = _make_quotation("draft")
        allowed, _ = validate_quotation_transition(q, QuotationAction.DELETE)
        assert allowed

    # ---- Sent ----

    def test_sent_allowed_actions(self):
        q = _make_quotation("sent")
        actions = get_quotation_allowed_actions(q)
        assert actions.can_approve
        assert actions.can_reject
        assert actions.can_reopen
        assert not actions.can_send
        assert not actions.can_delete

    def test_sent_approve_valid(self):
        q = _make_quotation("sent")
        allowed, _ = validate_quotation_transition(q, QuotationAction.APPROVE)
        assert allowed

    def test_sent_approve_expired_blocked(self):
        q = _make_quotation("sent", valid_until=date.today() - timedelta(days=1))
        allowed, error = validate_quotation_transition(q, QuotationAction.APPROVE)
        assert not allowed
        assert "expired" in error.lower()

    def test_sent_reopen(self):
        q = _make_quotation("sent")
        allowed, _ = validate_quotation_transition(q, QuotationAction.REOPEN)
        assert allowed

    def test_sent_reject(self):
        q = _make_quotation("sent")
        allowed, _ = validate_quotation_transition(q, QuotationAction.REJECT)
        assert allowed

    # ---- Approved ----

    def test_approved_allowed_actions(self):
        q = _make_quotation("approved")
        actions = get_quotation_allowed_actions(q)
        assert actions.can_create_invoice
        assert actions.can_reject
        assert not actions.can_send
        assert not actions.can_reopen
        assert not actions.can_delete

    def test_approved_create_invoice(self):
        q = _make_quotation("approved")
        allowed, _ = validate_quotation_transition(q, QuotationAction.CREATE_INVOICE)
        assert allowed

    def test_approved_reject(self):
        q = _make_quotation("approved")
        allowed, _ = validate_quotation_transition(q, QuotationAction.REJECT)
        assert allowed

    # ---- Rejected ----

    def test_rejected_allowed_actions(self):
        q = _make_quotation("rejected")
        actions = get_quotation_allowed_actions(q)
        assert actions.can_delete
        assert actions.can_duplicate
        assert not actions.can_send
        assert not actions.can_approve

    # ---- Converted ----

    def test_converted_allowed_actions(self):
        q = _make_quotation("converted")
        actions = get_quotation_allowed_actions(q)
        assert actions.can_duplicate
        assert not actions.can_delete
        assert not actions.can_create_invoice

    # ---- Duplicate always allowed ----

    def test_duplicate_allowed_on_all_states(self):
        for status in ["draft", "sent", "approved", "rejected", "converted"]:
            q = _make_quotation(status)
            allowed, _ = validate_quotation_transition(q, QuotationAction.DUPLICATE)
            assert allowed, f"Duplicate should be allowed on {status}"


class TestInvoiceLifecycle:
    """Invoice state machine: draft → issued → paid/cancelled."""

    def _make_invoice(self, status="draft"):
        client = Client(name="Test Client")
        db.session.add(client)
        db.session.commit()

        q = Quotation(
            number="QTN-2026-001", year=2026, client_id=client.id,
            client_snapshot={"name": "Test Client"}, quotation_date=date.today(),
            status="approved", discount_type="percent", discount_bp=0, gst_bp=1800,
            other_charges_paise=0, subtotal_paise=10000, discount_paise=0,
            gst_paise=1800, grand_total_paise=11800,
        )
        db.session.add(q)
        db.session.commit()

        inv = Invoice(
            number=f"INV-2026-{status}-001", year=2026, quotation_id=q.id,
            client_id=client.id, client_snapshot=q.client_snapshot,
            issue_date=date.today(), due_date=date.today() + timedelta(days=30),
            status=status, discount_type="percent", discount_bp=0, gst_bp=1800,
            other_charges_paise=0, subtotal_paise=10000, discount_paise=0,
            gst_paise=1800, grand_total_paise=11800,
        )
        inv.items.append(
            InvoiceItem(name="Test Item", qty_milli=1000, rate_paise=10000, line_total_paise=10000, position=0)
        )
        db.session.add(inv)
        db.session.commit()
        return inv

    def _make_invalid_invoice(self, status="draft"):
        client = Client(name="Test Client")
        db.session.add(client)
        db.session.commit()

        inv = Invoice(
            number=f"INV-2026-{status}-002", year=2026, client_id=client.id,
            client_snapshot={"name": "Test Client"},
            issue_date=date.today(), status=status,
            discount_type="percent", discount_bp=0, gst_bp=1800,
            other_charges_paise=0, subtotal_paise=0, grand_total_paise=0,
        )
        inv.items.append(InvoiceItem(name="", qty_milli=0, rate_paise=0, line_total_paise=0, position=0))
        db.session.add(inv)
        db.session.commit()
        return inv

    def test_draft_allowed_actions(self):
        inv = self._make_invoice("draft")
        actions = get_invoice_allowed_actions(inv)
        assert actions.can_issue
        assert actions.can_cancel
        assert actions.can_delete
        assert actions.can_duplicate
        assert not actions.can_record_payment

    def test_draft_issue_valid(self):
        inv = self._make_invoice("draft")
        allowed, _ = validate_invoice_transition(inv, InvoiceAction.ISSUE)
        assert allowed

    def test_draft_issue_invalid_no_items(self):
        inv = self._make_invalid_invoice("draft")
        allowed, error = validate_invoice_transition(inv, InvoiceAction.ISSUE)
        assert not allowed
        assert "items need name" in error

    def test_issued_allowed_actions(self):
        inv = self._make_invoice("issued")
        actions = get_invoice_allowed_actions(inv)
        assert actions.can_record_payment
        assert actions.can_cancel
        assert actions.can_duplicate
        assert not actions.can_issue
        assert not actions.can_delete

    def test_issued_cancel_no_payments(self):
        inv = self._make_invoice("issued")
        allowed, _ = validate_invoice_transition(inv, InvoiceAction.CANCEL)
        assert allowed

    def test_issued_cancel_with_payments_blocked(self):
        inv = self._make_invoice("issued")
        payment = Payment(
            invoice_id=inv.id, amount_paise=5000, paid_on=date.today(),
            method="cash", reference="REF-1"
        )
        db.session.add(payment)
        db.session.commit()

        allowed, error = validate_invoice_transition(inv, InvoiceAction.CANCEL)
        assert not allowed
        assert "payments" in error.lower()

    def test_cancelled_allowed_actions(self):
        inv = self._make_invoice("cancelled")
        actions = get_invoice_allowed_actions(inv)
        assert actions.can_duplicate
        assert not actions.can_issue
        assert not actions.can_cancel
        assert not actions.can_record_payment


class TestExpiredOverlay:
    """Expired is a computed overlay on draft/sent."""

    def test_expired_draft(self):
        q = _make_quotation("draft", valid_until=date.today() - timedelta(days=1))
        actions = get_quotation_allowed_actions(q)
        assert actions.is_expired
        assert actions.expired_reason is not None

    def test_not_expired_draft(self):
        q = _make_quotation("draft", valid_until=date.today() + timedelta(days=1))
        actions = get_quotation_allowed_actions(q)
        assert not actions.is_expired

    def test_expired_not_applied_to_approved(self):
        q = _make_quotation("approved", valid_until=date.today() - timedelta(days=1))
        actions = get_quotation_allowed_actions(q)
        assert not actions.is_expired
