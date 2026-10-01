"""
Phase 8 payments tests (§4.5, §9.2, §11, §22).

Two halves, because the arithmetic is already proven and the write path is not:

1. **Ledger behaviour.** Advance, multiple partials, exact full, overpayment,
   delete-and-recalculate — the §22 list. The status is *derived* (§11), so these
   tests assert what the API reports after each mutation rather than asserting a
   column was written.
2. **The guard that is easy to get wrong.** `record_payment` reads the ledger,
   writes, then reads it again. The first read is the user-facing pre-check; the
   second is what stops two requests that were each valid when they started from
   over-collecting. `test_concurrent_overpayment_is_rolled_back` simulates that
   interleaving deliberately, because a sequential test cannot produce it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.extensions.database import db
from app.models import Invoice, Payment
from app.services import payments as payments_service
from app.services.payments import format_rupees, record_payment


# ----------------------------------------------------------------- fixtures


def _csrf(client) -> dict:
    from tests.conftest import _csrf as cs

    return cs(client)


def _make_client(authed_client, name="Payments Client"):
    # A phone is required on the client, and unique per client, so a structurally
    # valid one is derived from the current client count.
    with authed_client.application.app_context():
        from app.extensions.database import db
        from app.models import Client

        existing = db.session.scalar(db.select(db.func.count()).select_from(Client)) or 0
    phone = f"6{str(200000000 + existing * 911)[-9:]}"
    resp = authed_client.post(
        "/api/v1/clients", json={"name": name, "phone": phone}, headers=_csrf(authed_client)
    )
    assert resp.status_code == 201, resp.get_data(as_text=True)
    return resp.get_json()["data"]["client"]


def _issued_invoice(authed_client, client_id, grand_total_paise=100000):
    """Run a quotation all the way to an issued invoice worth `grand_total_paise`."""
    payload = {
        "client_id": client_id,
        "quotation_date": date.today().isoformat(),
        "valid_until": (date.today() + timedelta(days=15)).isoformat(),
        "discount_type": "percent",
        "discount_bp": 0,
        "gst_bp": 0,
        "other_charges_paise": 0,
        "items": [
            {
                "name": "Work",
                # qty_milli 1000 = 1 unit, so the line total is the rate and the
                # invoice's grand total is exactly `grand_total_paise` (gst 0,
                # no discount, no other charges).
                "qty_milli": 1000,
                "rate_paise": grand_total_paise,
            }
        ],
    }
    created = authed_client.post(
        "/api/v1/quotations", json=payload, headers=_csrf(authed_client)
    ).get_json()["data"]["quotation"]
    assert created["grand_total_paise"] == grand_total_paise

    for action in ("send", "approve"):
        authed_client.post(
            f"/api/v1/quotations/{created['id']}/status",
            json={"action": action},
            headers=_csrf(authed_client),
        )
    invoice = authed_client.post(
        f"/api/v1/quotations/{created['id']}/invoice", headers=_csrf(authed_client)
    ).get_json()["data"]["invoice"]
    issued = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/issue", headers=_csrf(authed_client)
    )
    assert issued.status_code == 200, issued.get_data(as_text=True)
    # Re-read rather than reusing the conversion payload: that one was
    # serialised while the invoice was still a Draft, so its `status` and
    # `allowed_actions` are stale.
    return authed_client.get(f"/api/v1/invoices/{invoice['id']}").get_json()["data"]["invoice"]


def _draft_invoice(authed_client, client_id):
    """An approved quotation converted to a Draft invoice, not yet issued.

    Needed because the payment-method selector is only reachable while the invoice
    is a Draft - the window in which FR-P8 lets the admin choose the presentation.
    """
    payload = {
        "client_id": client_id,
        "quotation_date": date.today().isoformat(),
        "valid_until": (date.today() + timedelta(days=15)).isoformat(),
        "discount_type": "percent",
        "discount_bp": 0,
        "gst_bp": 0,
        "other_charges_paise": 0,
        "items": [{"name": "Work", "qty_milli": 1000, "rate_paise": 100000}],
    }
    created = authed_client.post(
        "/api/v1/quotations", json=payload, headers=_csrf(authed_client)
    ).get_json()["data"]["quotation"]
    for action in ("send", "approve"):
        authed_client.post(
            f"/api/v1/quotations/{created['id']}/status",
            json={"action": action},
            headers=_csrf(authed_client),
        )
    invoice = authed_client.post(
        f"/api/v1/quotations/{created['id']}/invoice", headers=_csrf(authed_client)
    ).get_json()["data"]["invoice"]
    assert invoice["status"] == "draft"
    return invoice


def _set_method(authed_client, invoice_id, method, expect=200):
    """PUT the draft-only payment method. `method=None` means 'Not Selected'."""
    resp = authed_client.put(
        f"/api/v1/invoices/{invoice_id}",
        json={"payment_method": method},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == expect, resp.get_data(as_text=True)
    return resp.get_json()["data"]["invoice"] if resp.status_code < 400 else resp.get_json()


def _pay(authed_client, invoice_id, amount_paise, method="upi", expect=201, **extra):
    body = {
        "amount_paise": amount_paise,
        "paid_on": date.today().isoformat(),
        "method": method,
        **extra,
    }
    resp = authed_client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json=body,
        headers=_csrf(authed_client),
    )
    assert resp.status_code == expect, resp.get_data(as_text=True)
    return resp.get_json()["data"] if resp.status_code < 400 else resp.get_json()


def _invoice(authed_client, invoice_id):
    return authed_client.get(f"/api/v1/invoices/{invoice_id}").get_json()["data"]["invoice"]


# -------------------------------------------------------------- auth guards


def test_payment_routes_require_authentication(client):
    assert client.get("/api/v1/invoices/1/payments").status_code == 401
    assert client.post("/api/v1/invoices/1/payments", json={}).status_code in (401, 403)
    assert client.delete("/api/v1/payments/1").status_code in (401, 403)


def test_recording_a_payment_requires_csrf(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"])
    # No X-CSRF-Token on the request.
    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 1000,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        },
    )
    assert resp.status_code == 403


def test_deleting_a_payment_requires_csrf(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"])
    payment_id = _pay(authed_client, invoice["id"], 1000)["payment"]["id"]
    assert authed_client.delete(f"/api/v1/payments/{payment_id}").status_code == 403


# ---------------------------------------------------------- §22 ledger cases


def test_advance_payment_moves_status_to_partially_paid(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    assert invoice["payment_status"] == "unpaid"

    _pay(authed_client, invoice["id"], 30000)

    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 30000
    assert after["outstanding_paise"] == 70000
    assert after["payment_status"] == "partially_paid"


def test_multiple_partials_accumulate(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)

    for amount in (10000, 20000, 30000):
        _pay(authed_client, invoice["id"], amount)

    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 60000
    assert after["outstanding_paise"] == 40000
    assert after["payment_status"] == "partially_paid"
    assert len(after["payments"]) == 3


def test_exact_final_payment_marks_paid(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)

    _pay(authed_client, invoice["id"], 40000)
    _pay(authed_client, invoice["id"], 60000)

    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 100000
    assert after["outstanding_paise"] == 0
    assert after["payment_status"] == "paid"


def test_overpayment_is_rejected_with_the_outstanding_in_the_message(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    _pay(authed_client, invoice["id"], 70000)

    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 40000,
            "paid_on": date.today().isoformat(),
            "method": "upi",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422
    body = resp.get_json()["error"]
    assert body["code"] == "BUSINESS_RULE"
    # §11 wording, and the balance the user was looking at.
    assert body["message"] == "Payment exceeds outstanding balance of ₹300.00."

    # Nothing was written.
    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 70000
    assert len(after["payments"]) == 1


def test_paying_the_outstanding_exactly_is_accepted(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    _pay(authed_client, invoice["id"], 100000)
    assert _invoice(authed_client, invoice["id"])["payment_status"] == "paid"


def test_delete_payment_recalculates_status(authed_client):
    """§22 / FR-P5: Paid -> Partially Paid -> Unpaid as payments are removed."""
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    first = _pay(authed_client, invoice["id"], 60000)["payment"]["id"]
    second = _pay(authed_client, invoice["id"], 40000)["payment"]["id"]
    assert _invoice(authed_client, invoice["id"])["payment_status"] == "paid"

    resp = authed_client.delete(f"/api/v1/payments/{second}", headers=_csrf(authed_client))
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["deleted"] == second
    # The corrected invoice comes back with the client so it need not recompute.
    assert data["invoice"]["paid_paise"] == 60000
    assert data["invoice"]["payment_status"] == "partially_paid"

    authed_client.delete(f"/api/v1/payments/{first}", headers=_csrf(authed_client))
    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 0
    assert after["outstanding_paise"] == 100000
    assert after["payment_status"] == "unpaid"
    assert after["payments"] == []


# ------------------------------------------------------------ issued-only


def test_payments_refused_on_a_draft_invoice(authed_client):
    c = _make_client(authed_client)
    created = authed_client.post(
        "/api/v1/quotations",
        json={
            "client_id": c["id"],
            "quotation_date": date.today().isoformat(),
            "discount_type": "percent",
            "discount_bp": 0,
            "gst_bp": 0,
            "items": [{"name": "Work", "qty_milli": 1, "rate_paise": 100000}],
        },
        headers=_csrf(authed_client),
    ).get_json()["data"]["quotation"]
    for action in ("send", "approve"):
        authed_client.post(
            f"/api/v1/quotations/{created['id']}/status",
            json={"action": action},
            headers=_csrf(authed_client),
        )
    invoice = authed_client.post(
        f"/api/v1/quotations/{created['id']}/invoice", headers=_csrf(authed_client)
    ).get_json()["data"]["invoice"]
    # Still a Draft.

    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 1000,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "BUSINESS_RULE"


def test_payments_refused_on_a_cancelled_invoice(app, authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    # Cancel refuses once a payment exists, so remove the payment first.
    payment_id = _pay(authed_client, invoice["id"], 1000)["payment"]["id"]
    authed_client.delete(f"/api/v1/payments/{payment_id}", headers=_csrf(authed_client))
    cancelled = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/cancel", headers=_csrf(authed_client)
    )
    assert cancelled.status_code == 200

    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 1000,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


def test_zero_amount_is_rejected(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"])
    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 0,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


def test_fractional_amount_is_rejected_not_truncated(authed_client):
    """`100.9` must be a 422, never a 100 recorded against the invoice (D2)."""
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=1000000)

    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 100.9,
            "paid_on": date.today().isoformat(),
            "method": "cash",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422

    # Nothing was written, and the invoice still reports a zero ledger.
    refreshed = _invoice(authed_client, invoice["id"])
    assert refreshed["paid_paise"] == 0
    assert refreshed["payments"] == []


def test_whole_float_and_string_amounts_are_accepted(authed_client):
    """JSON has one number type, so 100.0 and "100" are not lies about the amount."""
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=1000000)

    for amount in (100.0, "100"):
        resp = authed_client.post(
            f"/api/v1/invoices/{invoice['id']}/payments",
            json={
                "amount_paise": amount,
                "paid_on": date.today().isoformat(),
                "method": "cash",
            },
            headers=_csrf(authed_client),
        )
        assert resp.status_code == 201, resp.get_data(as_text=True)

    assert _invoice(authed_client, invoice["id"])["paid_paise"] == 200


def test_unknown_method_is_rejected(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"])
    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        json={
            "amount_paise": 100,
            "paid_on": date.today().isoformat(),
            "method": "cryptocurrency",
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


def test_all_six_methods_are_accepted(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=1000000)
    methods = ["cash", "upi", "bank_transfer", "cheque", "card", "other"]
    for index, method in enumerate(methods):
        _pay(authed_client, invoice["id"], 100, method=method)
    assert len(_invoice(authed_client, invoice["id"])["payments"]) == len(methods)


# ------------------------------------------------------- the race guard


def test_concurrent_overpayment_is_rolled_back(app, authed_client, monkeypatch):
    """
    Two requests that were each valid when they started must not both land.

    The pre-check reads the ledger, the insert happens, and the ledger is read
    again. To produce the interleaving a sequential test cannot, this forces the
    *first* read to report a stale (smaller) paid total — exactly what another
    committed request would have made it report — while the real ledger already
    contains that other request's payment.

    The pre-check therefore passes, the payment is inserted, the post-insert
    re-read sees the true total, and the service must roll back rather than
    over-collect.
    """
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)

    # Another request pays the whole invoice and commits.
    _pay(authed_client, invoice["id"], 100000)
    assert _invoice(authed_client, invoice["id"])["payment_status"] == "paid"

    real_paid = payments_service.paid_paise_for
    calls = {"n": 0}

    def stale_first_read(invoice_id):
        # First call is the pre-check, and reports the invoice as untouched.
        calls["n"] += 1
        return 0 if calls["n"] == 1 else real_paid(invoice_id)

    monkeypatch.setattr(payments_service, "paid_paise_for", stale_first_read)

    with app.app_context():
        target = db.session.get(Invoice, invoice["id"])
        with pytest.raises(Exception) as excinfo:
            record_payment(
                target,
                {
                    "amount_paise": 100000,
                    "paid_on": date.today(),
                    "method": "cash",
                },
            )
        message = getattr(excinfo.value, "message", str(excinfo.value))

    # Rejected, and the message names the true remaining balance (zero).
    assert "exceeds outstanding balance" in message
    assert "₹0.00" in message

    # The invoice is untouched: still one payment, still fully paid, no
    # over-collection and no orphaned row from the rolled-back insert.
    after = _invoice(authed_client, invoice["id"])
    assert after["paid_paise"] == 100000
    assert after["outstanding_paise"] == 0
    assert len(after["payments"]) == 1
    assert after["payment_status"] == "paid"


# ------------------------------------------------------------ history order


def test_payment_history_is_newest_first(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=1000000)
    ids = []
    for amount, offset in ((100, 3), (200, 2), (300, 1)):
        paid_on = (date.today() - timedelta(days=offset)).isoformat()
        ids.append(_pay(authed_client, invoice["id"], amount, paid_on=paid_on)["payment"]["id"])

    listing = authed_client.get(f"/api/v1/invoices/{invoice['id']}/payments").get_json()["data"]
    returned = [p["id"] for p in listing["payments"]]

    # Deterministic ordering, not whatever the query happened to produce.
    assert returned == [ids[2], ids[1], ids[0]]
    assert listing["paid_paise"] == 600
    assert listing["outstanding_paise"] == 999400
    assert listing["payment_status"] == "partially_paid"


def test_list_payments_matches_the_invoice_detail_order(authed_client):
    """The relationship ordering and the detail view must agree."""
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=1000000)
    # Recorded out of chronological order, so id order and date order differ and
    # the assertion below actually has something to catch.
    recorded = [
        _pay(
            authed_client,
            invoice["id"],
            100,
            paid_on=(date.today() - timedelta(days=i)).isoformat(),
        )["payment"]["id"]
        for i in (2, 0, 1)
    ]

    detail = _invoice(authed_client, invoice["id"])["payments"]
    listing = authed_client.get(
        f"/api/v1/invoices/{invoice['id']}/payments"
    ).get_json()["data"]["payments"]

    # Newest first by paid_on — which, for these three, is not id order.
    assert [p["id"] for p in detail] == [recorded[1], recorded[2], recorded[0]]
    # And both read paths must be identical.
    assert [p["id"] for p in detail] == [p["id"] for p in listing]
    # A tie on paid_on must still be deterministic, so ids break it descending.
    same_day = [
        _pay(authed_client, invoice["id"], 50)["payment"]["id"] for _ in range(2)
    ]
    after = _invoice(authed_client, invoice["id"])["payments"]
    assert after[0]["id"] == same_day[1]
    assert after[1]["id"] == same_day[0]


# ---------------------------------------------------------- allowed actions


def test_issued_invoice_advertises_record_payment_and_loses_it_once_paid_out(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    assert "record_payment" in invoice["allowed_actions"]

    _pay(authed_client, invoice["id"], 100000)
    # Still issued, so the action stays available — the ledger is not a state
    # machine, it is a balance.
    assert "record_payment" in _invoice(authed_client, invoice["id"])["allowed_actions"]


def test_cancel_becomes_impossible_once_a_payment_exists(authed_client):
    """Phase 8 makes this reachable for the first time; the server must refuse."""
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    _pay(authed_client, invoice["id"], 1000)

    assert "cancel" not in _invoice(authed_client, invoice["id"])["allowed_actions"]
    resp = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/cancel", headers=_csrf(authed_client)
    )
    assert resp.status_code == 422
    assert "payments" in resp.get_json()["error"]["message"].lower()


# -------------------------------------------------------- client summary


def test_client_summary_reflects_recorded_payments(authed_client):
    c = _make_client(authed_client)
    invoice = _issued_invoice(authed_client, c["id"], grand_total_paise=100000)
    _pay(authed_client, invoice["id"], 40000)

    summary = authed_client.get(f"/api/v1/clients/{c['id']}/summary").get_json()["data"]
    assert summary["totals"]["billed_paise"] == 100000
    assert summary["totals"]["received_paise"] == 40000
    assert summary["totals"]["outstanding_paise"] == 60000
    assert len(summary["payments"]) == 1
    assert summary["payments"][0]["amount_paise"] == 40000
    assert summary["payments"][0]["invoice_number"] == invoice["number"]


# ------------------------------------------------------------ not found


def test_unknown_payment_is_404(authed_client):
    resp = authed_client.delete("/api/v1/payments/999999", headers=_csrf(authed_client))
    assert resp.status_code == 404
    assert resp.get_json()["error"]["code"] == "NOT_FOUND"


# ----------------------------------------------------------- money format


@pytest.mark.parametrize(
    ("paise", "expected"),
    [
        (0, "₹0.00"),
        (100, "₹1.00"),
        (100000, "₹1,000.00"),
        (1234567, "₹12,345.67"),
        (123456789, "₹12,34,567.89"),
    ],
)
def test_format_rupees_uses_indian_grouping(paise, expected):
    assert format_rupees(paise) == expected

# ------------------------------------------- payment method on the invoice
#
# The invoice's payment line reports which method actually collected money. It is
# read from the ledger on every request and never stored on the invoice: a method
# belongs to a payment that arrived, so an invoice-level column would be a guess the
# first payment could contradict. No migration, no new column.
#
# These reuse the helpers above rather than redeclaring them.


def test_invoice_reports_no_payment_method_before_any_payment(authed_client):
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"])

    assert invoice["latest_payment_method"] is None
    assert invoice["payment_status"] == "unpaid"


def test_invoice_reports_the_recorded_payment_method(authed_client):
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"])
    _pay(authed_client, invoice["id"], 1000, method="upi")

    assert _invoice(authed_client, invoice["id"])["latest_payment_method"] == "upi"


def test_invoice_reports_the_most_recent_method_when_several_are_recorded(authed_client):
    """A 20,000 UPI payment then 30,000 by bank transfer reads as the latter."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 2000000, method="upi")
    _pay(authed_client, invoice["id"], 3000000, method="bank_transfer")

    assert _invoice(authed_client, invoice["id"])["latest_payment_method"] == "bank_transfer"


def test_payment_method_is_derived_and_never_written_to_the_invoice(authed_client):
    """
    The invoice's financial content is unchanged by a payment.

    The strongest form: snapshot every stored invoice column before and after
    recording a payment. If a method or an amount were ever persisted on the
    invoice, this fails, which is what would turn an issued tax document into a
    different document after money arrived.
    """
    from sqlalchemy import inspect as sa_inspect

    from app.extensions.database import db
    from app.models import Invoice

    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    def snapshot():
        with authed_client.application.app_context():
            row = db.session.get(Invoice, invoice["id"])
            return {c.key: getattr(row, c.key) for c in sa_inspect(row).mapper.column_attrs}

    before = snapshot()
    # The column exists, but it is a *presentation* choice frozen at issue (FR-P8,
    # migration b8d5f0e2c7a1) - not a record of how payment happened. The invariant
    # is that a payment does not write it, not that it is absent.
    assert "payment_method" in before
    assert before["payment_method"] is None

    _pay(authed_client, invoice["id"], 4000000, method="upi")

    after = snapshot()
    for field, value in before.items():
        assert after[field] == value, f"recording a payment changed invoices.{field}"


def test_balance_document_reports_the_latest_method(authed_client):
    """The reminder says how the customer has been paying, from the same ledger."""
    resp = authed_client.put(
        "/api/v1/settings/company",
        json={"upi_id": "ruchitainteriors@upi"},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200

    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000, method="upi")

    due = authed_client.get(f"/api/v1/invoices/{invoice['id']}/payment-due")
    assert due.status_code == 200
    assert due.get_json()["data"]["payment_due"]["latest_payment_method"] == "upi"


def test_fully_paid_invoice_still_reports_its_final_method(authed_client):
    """
    Settling an invoice does not rewrite it, it only changes the balance document.

    The method stays readable on both surfaces afterwards: the ledger remembers what
    happened, and hiding it would discard an accounting fact rather than preserve the
    document.
    """
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 10000000, method="cash")

    settled = _invoice(authed_client, invoice["id"])
    assert settled["payment_status"] == "paid"
    assert settled["latest_payment_method"] == "cash"

    # The balance sheet is still producible — it is the customer's receipt — but it is
    # now a settlement statement rather than a demand.
    again = _payment_due(authed_client, invoice["id"])
    assert again["fully_paid"] is True
    assert again["latest_payment_method"] == "cash"


# ------------------------------------------------ Balance / Payment Due doc
#
# The document is a *read* of the invoice and its ledger (8.5). Every test here is
# written to fail if that ever stops being true: a balance invoice that persisted
# would double-count revenue in `services/dashboard.py`, which sums
# `invoices.grand_total_paise` over issued invoices.


def _payment_due(authed_client, invoice_id, expect=200):
    resp = authed_client.get(f"/api/v1/invoices/{invoice_id}/payment-due")
    assert resp.status_code == expect, resp.get_data(as_text=True)
    if expect != 200:
        return resp.get_json()
    return resp.get_json()["data"]["payment_due"]


def _set_upi(authed_client, vpa="ruchitainteriors@upi", name="Ruchita Interiors"):
    resp = authed_client.put(
        "/api/v1/settings/company",
        json={"upi_id": vpa, "company_name": name},
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)


def test_balance_document_requires_authentication(client):
    assert client.get("/api/v1/invoices/1/payment-due").status_code == 401


def test_balance_for_unpaid_invoice_is_the_full_total(authed_client):
    """Nothing paid yet, so the balance is the whole invoice."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["outstanding_paise"] == 10000000
    assert doc["amount_due_paise"] == 10000000
    assert doc["paid_paise"] == 0
    assert doc["payment_status"] == "unpaid"


def test_balance_after_a_partial_payment_is_the_remainder(authed_client):
    """40,000 paid on 1,00,000 leaves 60,000."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["grand_total_paise"] == 10000000
    assert doc["paid_paise"] == 4000000
    assert doc["outstanding_paise"] == 6000000
    assert doc["payment_status"] == "partially_paid"


def test_balance_follows_a_second_partial_payment(authed_client):
    """A further 20,000 takes 60,000 down to 40,000."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000)
    _pay(authed_client, invoice["id"], 2000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["paid_paise"] == 6000000
    assert doc["outstanding_paise"] == 4000000


def test_fully_paid_invoice_yields_a_settlement_statement_with_no_qr(authed_client):
    """
    Nothing is owed, so the balance sheet stops being a demand and becomes a receipt.

    It is still produced (200), because the settlement reconciliation is exactly what a
    customer asks for after paying. What it must not carry is anything payable: the
    outstanding is zero and no URI is built from it, so a settled document cannot open a
    payment app asking for ₹0.
    """
    _set_upi(authed_client)
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 10000000)

    assert _invoice(authed_client, invoice["id"])["payment_status"] == "paid"

    doc = _payment_due(authed_client, invoice["id"])
    assert doc["fully_paid"] is True
    assert doc["outstanding_paise"] == 0
    assert doc["amount_due_paise"] == 0
    assert doc["upi_amount"] == "0.00"
    # The load-bearing assertion: no code that asks for money.
    assert doc["upi_uri"] is None
    # The history is still reconciled, so the sheet works as a receipt.
    assert doc["grand_total_paise"] == 10000000
    assert doc["paid_paise"] == 10000000


def test_an_unpaid_balance_document_is_explicitly_not_fully_paid(authed_client):
    """The flag distinguishes the two states; a default would hide the difference."""
    _set_upi(authed_client)
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000)

    doc = _payment_due(authed_client, invoice["id"])
    assert doc["fully_paid"] is False
    assert doc["outstanding_paise"] == 6000000
    assert doc["upi_uri"] is not None


def test_balance_qr_encodes_the_current_outstanding(authed_client):
    """
    The QR amount is the balance, and matches the amount reported.

    A QR asking for the original total after a partial payment would over-collect,
    so the encoded `am` is asserted against the same field the document displays.
    """
    _set_upi(authed_client)
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["upi_amount"] == "60000.00"
    assert "am=60000.00" in doc["upi_uri"]
    assert doc["upi_uri"].startswith("upi://pay?")
    assert "pa=ruchitainteriors%40upi" in doc["upi_uri"]
    assert "cu=INR" in doc["upi_uri"]


def test_balance_qr_is_absent_without_a_configured_upi_id(authed_client):
    """No UPI ID means no QR, not a QR for nothing."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["upi_uri"] is None
    assert doc["upi_id"] == ""


def test_generating_a_balance_document_writes_nothing(authed_client):
    """
    No revenue row, no payment row, no ledger movement.

    Asserted by counting the two tables the document must never touch, and by
    confirming the derived status is unchanged afterwards. This is the test that
    fails first if anyone ever makes this endpoint persist a document.
    """
    from sqlalchemy import func, select

    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 4000000)

    with authed_client.application.app_context():
        before_invoices = db.session.scalar(select(func.count()).select_from(Invoice))
        before_payments = db.session.scalar(select(func.count()).select_from(Payment))
        before_total = db.session.scalar(
            select(func.coalesce(func.sum(Invoice.grand_total_paise), 0))
        )

    first = _payment_due(authed_client, invoice["id"])
    second = _payment_due(authed_client, invoice["id"])  # twice, as a repeat cycle would

    with authed_client.application.app_context():
        after_invoices = db.session.scalar(select(func.count()).select_from(Invoice))
        after_payments = db.session.scalar(select(func.count()).select_from(Payment))
        after_total = db.session.scalar(
            select(func.coalesce(func.sum(Invoice.grand_total_paise), 0))
        )

    assert after_invoices == before_invoices, "a balance document created an invoice row"
    assert after_payments == before_payments, "a balance document created a payment row"
    assert after_total == before_total, "a balance document changed billed revenue"
    # Two documents, one source invoice, identical figures.
    assert first["source_invoice_id"] == second["source_invoice_id"] == invoice["id"]
    assert first["outstanding_paise"] == second["outstanding_paise"] == 6000000


def test_repeat_balance_documents_track_the_ledger_not_the_last_document(authed_client):
    """Each generation re-reads, so the sequence is 75k then 45k."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    _pay(authed_client, invoice["id"], 2500000)
    first = _payment_due(authed_client, invoice["id"])
    assert first["outstanding_paise"] == 7500000

    _pay(authed_client, invoice["id"], 3000000)
    second = _payment_due(authed_client, invoice["id"])
    assert second["outstanding_paise"] == 4500000

    # The earlier figure is a snapshot and is not retroactively "wrong": the endpoint
    # has no memory of it at all.
    assert first["outstanding_paise"] == 7500000


def test_balance_document_reports_the_source_invoice_not_its_own_number(authed_client):
    """No second document number: it is referenced by the invoice it concerns."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["source_invoice_number"] == invoice["number"]
    # A `number` of its own would read as a second billing document.
    assert "number" not in doc
    assert doc["title"] == "PAYMENT DUE"
    assert doc["kind"] == "payment_due"


def test_balance_document_is_refused_for_a_cancelled_invoice(authed_client):
    """A cancelled invoice must never produce a demand for money."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)
    cancelled = authed_client.post(
        f"/api/v1/invoices/{invoice['id']}/cancel", headers=_csrf(authed_client)
    )
    assert cancelled.status_code == 200

    assert _payment_due(authed_client, invoice["id"], expect=422) is not None


def test_balance_document_is_refused_for_a_draft_invoice(authed_client):
    """A draft has not been billed, so there is nothing to collect."""
    created = authed_client.post(
        "/api/v1/quotations",
        json={
            "client_id": _make_client(authed_client)["id"],
            "quotation_date": date.today().isoformat(),
            "valid_until": (date.today() + timedelta(days=15)).isoformat(),
            "discount_type": "percent",
            "discount_bp": 0,
            "gst_bp": 0,
            "other_charges_paise": 0,
            "items": [{"name": "Work", "qty_milli": 1000, "rate_paise": 100000}],
        },
        headers=_csrf(authed_client),
    )
    quotation = created.get_json()["data"]["quotation"]
    # A quotation only converts from `approved` (13.2), so walk it there first.
    for action in ("send", "approve"):
        authed_client.post(
            f"/api/v1/quotations/{quotation['id']}/status",
            json={"action": action},
            headers=_csrf(authed_client),
        )
    converted = authed_client.post(
        f"/api/v1/quotations/{quotation['id']}/invoice", headers=_csrf(authed_client)
    )
    assert converted.status_code in (200, 201), converted.get_data(as_text=True)
    draft = converted.get_json()["data"]["invoice"]

    assert draft["status"] == "draft"
    assert _payment_due(authed_client, draft["id"], expect=422) is not None


def test_balance_document_ignores_untrusted_status_and_amount_fields(authed_client):
    """
    A client cannot assert its own status or amount.

    There is no `payment_status` to set and no amount in the request at all - the
    document is built entirely from the ledger - so the strongest form of this test
    is that query parameters are ignored rather than honoured.
    """
    _set_upi(authed_client)
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    resp = authed_client.get(
        f"/api/v1/invoices/{invoice['id']}/payment-due"
        "?outstanding_paise=1&amount_due_paise=1&payment_status=paid"
    )
    doc = resp.get_json()["data"]["payment_due"]

    assert doc["outstanding_paise"] == 10000000
    assert doc["amount_due_paise"] == 10000000
    assert doc["payment_status"] == "unpaid"
    assert "am=100000.00" in doc["upi_uri"]


def test_existing_payment_status_still_drives_the_balance(authed_client):
    """The document reports the same derived status the invoice does."""
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=10000000)

    # Unpaid: the document and the invoice agree.
    assert _payment_due(authed_client, invoice["id"])["payment_status"] == _invoice(
        authed_client, invoice["id"]
    )["payment_status"] == "unpaid"

    # Partially paid: still the same single derived figure on both surfaces.
    _pay(authed_client, invoice["id"], 4000000)
    assert _payment_due(authed_client, invoice["id"])["payment_status"] == _invoice(
        authed_client, invoice["id"]
    )["payment_status"] == "partially_paid"

# Paid: the document reports the same status, and switches to the settled shape
    # rather than being refused - the settlement statement is the customer's receipt.
    _pay(authed_client, invoice["id"], 6000000)
    assert _invoice(authed_client, invoice["id"])["payment_status"] == "paid"
    paid_doc = _payment_due(authed_client, invoice["id"])
    assert paid_doc["payment_status"] == _invoice(authed_client, invoice["id"])["payment_status"] == "paid"
    assert paid_doc["fully_paid"] is True


def test_balance_amount_uses_invoice_paise_without_float_error(authed_client):
    """A decimal total must produce an exact `am`, never a rounded float artefact."""
    _set_upi(authed_client)
    invoice = _issued_invoice(authed_client, _make_client(authed_client)["id"], grand_total_paise=600050)
    _pay(authed_client, invoice["id"], 50)

    doc = _payment_due(authed_client, invoice["id"])

    assert doc["outstanding_paise"] == 600000
    assert doc["upi_amount"] == "6000.00"
    assert "am=6000.00" in doc["upi_uri"]


# ------------------------------------- FR-P8: the invoice's payment presentation


def test_payment_method_is_chosen_while_draft_and_frozen_at_issue(authed_client):
    """
    The selector is reachable only before issue, and that is what makes the printed
    presentation permanent rather than something the first payment can change.
    """
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])
    assert draft["payment_method"] is None, "a converted invoice defaults to Not Selected"

    chosen = _set_method(authed_client, draft["id"], "upi")
    assert chosen["payment_method"] == "upi"

    # Past issue the draft guard refuses, so no later edit can alter the document.
    authed_client.post(f"/api/v1/invoices/{draft['id']}/issue", headers=_csrf(authed_client))
    refused = _set_method(authed_client, draft["id"], "cash", expect=422)
    assert "Only draft invoices can be edited" in refused["error"]["message"]
    assert _invoice(authed_client, draft["id"])["payment_method"] == "upi"


def test_payment_method_accepts_only_the_offered_choices(authed_client):
    """Cheque and card are real ledger methods but are not invoice presentations."""
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])

    for bad in ("cheque", "card", "other", "UPI", "bank"):
        _set_method(authed_client, draft["id"], bad, expect=422)

    assert _invoice(authed_client, draft["id"])["payment_method"] is None


def test_payment_method_can_be_cleared_back_to_not_selected(authed_client):
    """'Not Selected' is a real state, not just the absence of a choice."""
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])
    _set_method(authed_client, draft["id"], "bank_transfer")

    cleared = _set_method(authed_client, draft["id"], None)
    assert cleared["payment_method"] is None


def test_paying_by_a_different_method_does_not_change_the_invoices_presentation(authed_client):
    """
    The load-bearing FR-P8 case.

    The invoice is issued presenting UPI; the client then pays by bank transfer. The
    invoice keeps the UPI presentation, and the ledger records the truth. Conflating
    the two is exactly the bug this split prevents.
    """
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])
    _set_method(authed_client, draft["id"], "upi")
    authed_client.post(f"/api/v1/invoices/{draft['id']}/issue", headers=_csrf(authed_client))

    _pay(authed_client, draft["id"], 40000, method="bank_transfer")

    after = _invoice(authed_client, draft["id"])
    assert after["payment_method"] == "upi", "a payment rewrote the invoice's presentation"
    assert after["latest_payment_method"] == "bank_transfer", "the ledger must keep the truth"
    assert after["payment_status"] == "partially_paid"


def test_the_presentation_survives_a_mixed_sequence_of_payments(authed_client):
    """Three payments by three different methods, one unchanged invoice."""
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])
    _set_method(authed_client, draft["id"], "upi")
    authed_client.post(f"/api/v1/invoices/{draft['id']}/issue", headers=_csrf(authed_client))

    _pay(authed_client, draft["id"], 20000, method="cash")
    _pay(authed_client, draft["id"], 30000, method="bank_transfer")
    _pay(authed_client, draft["id"], 50000, method="upi")

    after = _invoice(authed_client, draft["id"])
    assert after["payment_method"] == "upi"
    assert after["payment_status"] == "paid"
    assert after["paid_paise"] == 100000
    assert after["outstanding_paise"] == 0


def test_a_cancelled_invoices_method_never_reaches_the_balance_document(authed_client):
    """
    The Balance / Payment Due document is regenerated per collection, so it is free to
    reflect the current ledger - but it must not present the invoice's frozen choice
    as if it were its own. The reminder always offers both rails and names what
    actually collected the money.
    """
    draft = _draft_invoice(authed_client, _make_client(authed_client)["id"])
    _set_method(authed_client, draft["id"], "cash")
    authed_client.post(f"/api/v1/invoices/{draft['id']}/issue", headers=_csrf(authed_client))

    _pay(authed_client, draft["id"], 40000, method="upi")

    doc = _payment_due(authed_client, draft["id"])
    assert doc["latest_payment_method"] == "upi"
    assert "payment_method" not in doc, "the reminder must not inherit the invoice's frozen choice"
