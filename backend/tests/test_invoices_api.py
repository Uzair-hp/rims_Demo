"""
Phase 7 invoice API tests (§9.2, §11, §13.2, §8.4).

The invoice feature is defined by four things that are easy to get subtly wrong,
so each gets a dedicated block below:

1. **The snapshot.** An invoice is an independent copy. Editing the quotation, or
   the company Settings, afterwards must not change it (§8.4).
2. **Conversion happens once, and a second attempt says which invoice exists**
   (§9.2, §25) — a 409 carrying the id the UI needs for "View invoice".
3. **Conversion independently verifies its own money** (§11) and aborts rather
   than storing totals that disagree with the quotation.
4. **Issue locks, cancel releases.** Cancelling hands the quotation back to
   `approved` so the same work can be invoiced again, and is refused once a
   payment exists (§13.2).

Payment *recording* is Phase 8, so payments are inserted directly here to set up
the money fixtures the status and outstanding figures need.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.extensions.database import db
from app.models import Invoice, Payment
from app.services.invoices import ConversionSafetyError, convert_quotation

# ----------------------------------------------------------------- fixtures


def _make_client(authed_client, name="Invoice Test Client"):
    resp = authed_client.post(
        "/api/v1/clients",
        json={"name": name, "phone": "+91 90000 00000"},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 201, resp.get_data(as_text=True)
    return resp.get_json()["data"]["client"]


def _csrf(client) -> dict:
    from tests.conftest import _csrf as cs

    return cs(client)


def _quotation_payload(client_id, **overrides):
    payload = {
        "client_id": client_id,
        "quotation_date": date.today().isoformat(),
        "valid_until": (date.today() + timedelta(days=15)).isoformat(),
        "discount_type": "percent",
        "discount_bp": 0,
        "gst_bp": 1800,
        "other_charges_paise": 0,
        "items": [
            {"name": "Modular kitchen", "qty_milli": 1000, "rate_paise": 5000000},
        ],
    }
    payload.update(overrides)
    return payload


def _create_quotation(authed_client, client_id, **overrides):
    resp = authed_client.post(
        "/api/v1/quotations",
        json=_quotation_payload(client_id, **overrides),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 201, resp.get_data(as_text=True)
    return resp.get_json()["data"]["quotation"]


def _status(authed_client, quotation_id, action):
    return authed_client.post(
        f"/api/v1/quotations/{quotation_id}/status",
        json={"action": action},
        headers=_csrf(authed_client),
    )


def _approved_quotation(authed_client, client_id, **overrides):
    """A quotation walked all the way to `approved`, ready to convert."""
    q = _create_quotation(authed_client, client_id, **overrides)
    _status(authed_client, q["id"], "send")
    _status(authed_client, q["id"], "approve")
    return q


def _convert(authed_client, quotation_id, expect=201):
    resp = authed_client.post(
        f"/api/v1/quotations/{quotation_id}/invoice", headers=_csrf(authed_client)
    )
    assert resp.status_code == expect, resp.get_data(as_text=True)
    return resp


def _invoice_id(resp) -> int:
    return resp.get_json()["data"]["invoice"]["id"]


def _add_payment(app, invoice_id, amount_paise, method="upi"):
    """Insert a payment row directly. Recording payments is Phase 8's API."""
    with app.app_context():
        db.session.add(
            Payment(
                invoice_id=invoice_id,
                amount_paise=amount_paise,
                paid_on=date.today(),
                method=method,
            )
        )
        db.session.commit()


# -------------------------------------------------------------- auth guards


def test_invoice_endpoints_require_authentication(client):
    assert client.get("/api/v1/invoices").status_code == 401
    assert client.get("/api/v1/invoices/1").status_code == 401
    assert client.put("/api/v1/invoices/1", json={}).status_code in (401, 403)
    assert client.post("/api/v1/invoices/1/issue").status_code in (401, 403)
    assert client.post("/api/v1/invoices/1/cancel").status_code in (401, 403)


def test_invoices_cannot_be_created_directly(authed_client):
    """FR-I1: an invoice only ever exists by conversion. No POST /invoices."""
    resp = authed_client.post("/api/v1/invoices", json={}, headers=_csrf(authed_client))
    assert resp.status_code == 405


def test_mutation_requires_csrf_header(authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))
    # No X-CSRF-Token on the request.
    assert authed_client.post(f"/api/v1/invoices/{invoice_id}/issue").status_code == 403


# ------------------------------------------------------------ list + search


def test_list_invoices_paginates_and_defaults_to_newest(authed_client):
    c = _make_client(authed_client)
    ids = [_invoice_id(_convert(authed_client, _approved_quotation(authed_client, c["id"])["id"]))
           for _ in range(3)]

    body = authed_client.get("/api/v1/invoices").get_json()["data"]
    assert body["total"] == 3
    assert [row["id"] for row in body["items"]] == list(reversed(ids))

    page = authed_client.get("/api/v1/invoices?page=2&page_size=2").get_json()["data"]
    assert page["total"] == 3
    assert page["page"] == 2
    assert len(page["items"]) == 1


def test_list_search_matches_number_and_client_name(authed_client):
    c = _make_client(authed_client, name="Ananya Builders")
    invoice = _convert(authed_client, _approved_quotation(authed_client, c["id"])["id"]).get_json()["data"]["invoice"]

    by_number = authed_client.get(f"/api/v1/invoices?q={invoice['number']}").get_json()["data"]
    assert by_number["total"] == 1

    by_name = authed_client.get("/api/v1/invoices?q=ananya").get_json()["data"]
    assert by_name["total"] == 1

    assert authed_client.get("/api/v1/invoices?q=nobody").get_json()["data"]["total"] == 0


def test_list_rejects_unknown_sort_column(authed_client):
    assert authed_client.get("/api/v1/invoices?sort=drop%20table").status_code == 422


# ------------------------------------------------- computed money (§11, §12)


def test_invoice_computed_fields_start_unpaid(authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice = _convert(authed_client, q["id"]).get_json()["data"]["invoice"]

    # subtotal 5_000_000, gst 18% => 900_000, grand 5_900_000
    assert invoice["grand_total_paise"] == 5_900_000
    assert invoice["paid_paise"] == 0
    assert invoice["outstanding_paise"] == 5_900_000
    assert invoice["payment_status"] == "unpaid"
    assert invoice["allowed_actions"]
    assert "issue" in invoice["allowed_actions"]


def test_invoice_paid_and_outstanding_follow_the_ledger(app, authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    _add_payment(app, invoice_id, 2_000_000)
    body = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    assert body["paid_paise"] == 2_000_000
    assert body["outstanding_paise"] == 5_900_000 - 2_000_000
    assert body["payment_status"] == "partially_paid"

    _add_payment(app, invoice_id, 3_900_000)
    body = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    assert body["paid_paise"] == 5_900_000
    assert body["outstanding_paise"] == 0
    assert body["payment_status"] == "paid"


def test_invoice_payment_history_is_returned(app, authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))
    _add_payment(app, invoice_id, 1_000_000)

    invoice = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    assert len(invoice["payments"]) == 1
    payment = invoice["payments"][0]
    assert payment["amount_paise"] == 1_000_000
    assert payment["method"] == "upi"


# ------------------------------------------- payment_status filter in SQL


def test_payment_status_filter_separates_the_three_states(app, authed_client):
    """
    The filter must run in SQL against the payments aggregate, not in Python.

    Three invoices in one list, each funded differently, then the filter has to
    pick exactly one of them each time.
    """
    c = _make_client(authed_client)
    ids = [
        _invoice_id(_convert(authed_client, _approved_quotation(authed_client, c["id"])["id"]))
        for _ in range(3)
    ]
    # ids: 0 -> unpaid, 1 -> partially paid, 2 -> paid
    _add_payment(app, ids[1], 1_000_000)
    _add_payment(app, ids[2], 5_900_000)

    def filtered(status):
        body = authed_client.get(f"/api/v1/invoices?payment_status={status}").get_json()["data"]
        return {row["id"] for row in body["items"]}

    assert filtered("unpaid") == {ids[0]}
    assert filtered("partially_paid") == {ids[1]}
    assert filtered("paid") == {ids[2]}


def test_payment_status_filter_agrees_with_the_computed_field(app, authed_client):
    """The filter's SQL predicate and the Python definition must never diverge."""
    c = _make_client(authed_client)
    ids = [
        _invoice_id(_convert(authed_client, _approved_quotation(authed_client, c["id"])["id"]))
        for _ in range(3)
    ]
    _add_payment(app, ids[1], 2_500_000)
    _add_payment(app, ids[2], 5_900_000)

    for status in ("unpaid", "partially_paid", "paid"):
        body = authed_client.get(f"/api/v1/invoices?payment_status={status}").get_json()["data"]
        for row in body["items"]:
            assert row["payment_status"] == status


def test_payment_status_filter_rejects_unknown_value(authed_client):
    assert authed_client.get("/api/v1/invoices?payment_status=refunded").status_code == 422


# ------------------------------------------------- conversion snapshot (§8.4)


def test_conversion_copies_items_and_totals(authed_client):
    c = _make_client(authed_client)
    quotation = _approved_quotation(
        authed_client,
        c["id"],
        discount_type="percent",
        discount_bp=500,
        other_charges_label="Site Preparation",
        other_charges_paise=250_000,
    )
    invoice = _convert(authed_client, quotation["id"]).get_json()["data"]["invoice"]

    assert invoice["number"].startswith("INV-")
    assert invoice["quotation_id"] == quotation["id"]
    assert invoice["client_id"] == c["id"]
    assert invoice["status"] == "draft"
    assert len(invoice["items"]) == 1

    source = authed_client.get(f"/api/v1/quotations/{quotation['id']}").get_json()["data"]["quotation"]
    assert invoice["items"][0]["name"] == source["items"][0]["name"]
    assert invoice["items"][0]["line_total_paise"] == source["items"][0]["line_total_paise"]
    for field in ("subtotal_paise", "discount_paise", "gst_paise", "grand_total_paise"):
        assert invoice[field] == source[field], field


def test_conversion_snapshots_bank_and_signatory(authed_client):
    c = _make_client(authed_client)
    authed_client.put(
        "/api/v1/settings/company",
        json={
            "bank_account_name": "Ruchita Interiors LLP",
            "bank_account_number": "00123456789",
            "bank_name": "HDFC Bank",
            "bank_ifsc": "HDFC0001234",
            "bank_branch": "Vijay Nagar",
            "upi_id": "ruchita@hdfcbank",
            "signatory_name": "Ruchita Sharma",
        },
        headers=_csrf(authed_client),
    )
    q = _approved_quotation(authed_client, c["id"])
    invoice = _convert(authed_client, q["id"]).get_json()["data"]["invoice"]

    assert invoice["signatory_name"] == "Ruchita Sharma"
    assert invoice["bank_snapshot"]["bank_name"] == "HDFC Bank"
    assert invoice["bank_snapshot"]["upi_id"] == "ruchita@hdfcbank"


def test_payment_qr_is_not_snapshotted_onto_the_invoice(app, authed_client):
    """
    The UPI QR is deliberately EXCLUDED from the invoice snapshot.

    §8.4 snapshots bank details and the signatory so an issued invoice can be
    reproduced years later. The QR is the one exception: it is a live payment
    instruction, not a frozen document fact, because a stale QR could point a
    paying client at a closed or wrong account. It is read from Settings at render
    time instead.

    This test exists to make that a decision rather than an oversight. If someone
    later adds the QR to `bank_snapshot` "for consistency", it fails here.
    """
    from app.models import CompanySettings

    c = _make_client(authed_client)
    with app.app_context():
        row = CompanySettings.get_row()
        row.payment_qr_path = "payments/qr.png"
        db.session.commit()

    q = _approved_quotation(authed_client, c["id"])
    invoice = _convert(authed_client, q["id"]).get_json()["data"]["invoice"]

    # The snapshot carries the bank *text* and no QR reference at all.
    assert "payment_qr_path" not in invoice["bank_snapshot"]
    assert not any("qr" in key.lower() for key in invoice["bank_snapshot"])


def test_settings_change_after_conversion_does_not_alter_the_invoice(authed_client):
    """§8.4: Settings changes affect only future documents."""
    c = _make_client(authed_client)
    authed_client.put(
        "/api/v1/settings/company",
        json={"signatory_name": "Original Signatory", "bank_name": "Original Bank"},
        headers=_csrf(authed_client),
    )
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    authed_client.put(
        "/api/v1/settings/company",
        json={"signatory_name": "Changed Signatory", "bank_name": "Changed Bank"},
        headers=_csrf(authed_client),
    )

    invoice = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    assert invoice["signatory_name"] == "Original Signatory"
    assert invoice["bank_snapshot"]["bank_name"] == "Original Bank"


def test_invoice_number_sequence_is_independent_of_quotations(authed_client):
    c = _make_client(authed_client)
    first = _convert(authed_client, _approved_quotation(authed_client, c["id"])["id"])
    second = _convert(authed_client, _approved_quotation(authed_client, c["id"])["id"])

    numbers = [
        first.get_json()["data"]["invoice"]["number"],
        second.get_json()["data"]["invoice"]["number"],
    ]
    assert all(n.startswith("INV-") for n in numbers)
    assert numbers[0] != numbers[1]


# -------------------------------------- conversion safety assert (§11)


def test_conversion_aborts_when_stored_totals_disagree(app, authed_client):
    """
    A locked approved quotation cannot legitimately disagree with its own items.

    Corrupt the stored totals, then convert: §11 requires the conversion to abort
    and roll back rather than store an invoice whose money does not add up.
    """
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])

    from app.models import Quotation

    with app.app_context():
        quotation = db.session.get(Quotation, q["id"])
        quotation.grand_total_paise = 1  # deliberately wrong
        db.session.commit()
        with pytest.raises(ConversionSafetyError):
            convert_quotation(quotation)
        db.session.rollback()

    # Nothing persisted: no invoice, and the counter did not advance either.
    assert authed_client.get("/api/v1/invoices").get_json()["data"]["total"] == 0
    body = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert body["status"] == "approved"


def test_conversion_safety_failure_surfaces_as_500_in_the_api(app, authed_client):
    """
    The same corruption, driven through the HTTP endpoint this time.

    §11 requires the conversion to abort; §16 requires the client to get a generic
    message plus a loggable error id, never the internals.
    """
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])

    from app.models import Quotation

    with app.app_context():
        quotation = db.session.get(Quotation, q["id"])
        quotation.grand_total_paise = 1  # deliberately wrong
        db.session.commit()

    resp = authed_client.post(
        f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)
    )

    assert resp.status_code == 500
    body = resp.get_json()["error"]
    assert body["code"] == "INTERNAL"
    # §16: a generic message plus an error id; no internals leaked to the client.
    assert "grand_total" not in body["message"]
    assert body["details"][0]["field"] == "error_id"
    assert body["details"][0]["message"]

    # The failed conversion persisted nothing.
    assert authed_client.get("/api/v1/invoices").get_json()["data"]["total"] == 0


# ------------------------------------------------- issue / cancel lifecycle


def test_draft_fields_are_editable_and_locked_after_issue(authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    due = (date.today() + timedelta(days=30)).isoformat()
    resp = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"due_date": due, "notes": "Payable within 30 days.", "terms_text": "Net 30."},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200
    body = resp.get_json()["data"]["invoice"]
    assert body["due_date"] == due
    assert body["notes"] == "Payable within 30 days."
    assert body["terms_text"] == "Net 30."

    assert authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client)).status_code == 200

    locked = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"notes": "should not stick"},
        headers=_csrf(authed_client),
    )
    assert locked.status_code == 422
    assert locked.get_json()["error"]["code"] == "BUSINESS_RULE"


def test_invoice_items_are_not_editable_via_the_api(authed_client):
    """FR-I3/D7: items lock at conversion. Only dates, notes and terms are writable."""
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    before = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    # Item fields and financial fields are not part of InvoiceDraftSchema, so
    # they are unknown keys and are ignored rather than applied.
    authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"items": [{"name": "Injected", "qty_milli": 1, "rate_paise": 1}], "grand_total_paise": 1},
        headers=_csrf(authed_client),
    )
    after = authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]
    assert after["items"] == before["items"]
    assert after["grand_total_paise"] == before["grand_total_paise"]


def test_partial_invoice_put_leaves_untouched_fields_alone(authed_client):
    """A partial PUT must not clear the fields it does not mention.

    `InvoiceDraftSchema` used to give notes / terms_text / payment_method a
    `load_default`, so they were always in the loaded payload and every PUT
    rewrote them — a date-only edit silently erased the invoice's notes, its
    printed terms and its whole payment presentation.
    """
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    seeded = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={
            "notes": "Gate access needed on site.",
            "terms_text": "Net 30. Advance 50%.",
            "payment_method": "upi",
        },
        headers=_csrf(authed_client),
    )
    assert seeded.status_code == 200

    due = (date.today() + timedelta(days=45)).isoformat()
    resp = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"due_date": due},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200
    body = resp.get_json()["data"]["invoice"]
    assert body["due_date"] == due
    assert body["notes"] == "Gate access needed on site."
    assert body["terms_text"] == "Net 30. Advance 50%."
    assert body["payment_method"] == "upi"

    # An explicit null is still how a field is cleared.
    cleared = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"notes": None},
        headers=_csrf(authed_client),
    )
    assert cleared.status_code == 200
    after = cleared.get_json()["data"]["invoice"]
    assert after["notes"] is None
    assert after["terms_text"] == "Net 30. Advance 50%."
    assert after["payment_method"] == "upi"


def test_invoice_notes_and_terms_length_are_capped(authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    for field in ("notes", "terms_text"):
        resp = authed_client.put(
            f"/api/v1/invoices/{invoice_id}",
            json={field: "x" * 50_000},
            headers=_csrf(authed_client),
        )
        assert resp.status_code == 422, field


def test_issue_is_refused_for_an_invoice_with_no_valid_items(app, authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    from app.models import InvoiceItem

    with app.app_context():
        invoice = db.session.get(Invoice, invoice_id)
        invoice.items[0].name = ""
        invoice.items[0].qty_milli = 0
        invoice.items[0].rate_paise = 0
        db.session.commit()

    resp = authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client))
    assert resp.status_code == 422
    assert "items" in resp.get_json()["error"]["message"].lower()


def test_issue_twice_is_refused(authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))

    assert authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client)).status_code == 200
    assert authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client)).status_code == 422


def test_cancel_releases_the_quotation_and_allows_reinvoicing(authed_client):
    """§13.2: cancel → quotation back to `approved` → the work can be re-invoiced."""
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    first = _convert(authed_client, q["id"]).get_json()["data"]["invoice"]

    cancelled = authed_client.post(
        f"/api/v1/invoices/{first['id']}/cancel", headers=_csrf(authed_client)
    )
    assert cancelled.status_code == 200
    assert cancelled.get_json()["data"]["invoice"]["status"] == "cancelled"

    quotation = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert quotation["status"] == "approved"
    assert "create_invoice" in quotation["allowed_actions"]

    # Re-invoicing is permitted again, and gets a fresh number.
    second = _convert(authed_client, q["id"]).get_json()["data"]["invoice"]
    assert second["id"] != first["id"]
    assert second["number"] != first["number"]
    assert second["status"] == "draft"


def test_cancel_is_refused_once_a_payment_exists(app, authed_client):
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))
    authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client))
    _add_payment(app, invoice_id, 500_000)

    resp = authed_client.post(f"/api/v1/invoices/{invoice_id}/cancel", headers=_csrf(authed_client))
    assert resp.status_code == 422
    assert "payments" in resp.get_json()["error"]["message"].lower()

    # The quotation stays converted, because the invoice is still live.
    quotation = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert quotation["status"] == "converted"


def test_cancelled_invoice_excluded_from_money_metrics(app, authed_client):
    """§11: cancelled invoices never count toward the client's billed total."""
    c = _make_client(authed_client)
    q = _approved_quotation(authed_client, c["id"])
    invoice_id = _invoice_id(_convert(authed_client, q["id"]))
    authed_client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=_csrf(authed_client))
    authed_client.post(f"/api/v1/invoices/{invoice_id}/cancel", headers=_csrf(authed_client))

    summary = authed_client.get(f"/api/v1/clients/{c['id']}/summary").get_json()["data"]
    assert summary["invoices"] == []
    assert summary["totals"]["billed_paise"] == 0


# ------------------------------------------------------------- not found


def test_unknown_invoice_is_404(authed_client):
    resp = authed_client.get("/api/v1/invoices/999999")
    assert resp.status_code == 404
    assert resp.get_json()["error"]["code"] == "NOT_FOUND"
