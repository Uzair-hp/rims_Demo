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
    resp = authed_client.post(
        "/api/v1/clients", json={"name": name}, headers=_csrf(authed_client)
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
