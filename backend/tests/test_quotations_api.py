"""
Phase 5 quotation endpoint tests (PLAN §9.2, §10, §13).

Covers auth + CSRF guards, validation, create/read/update/delete, the full
status machine (send → approve/reject → reopen), duplicate, and conversion to an
invoice (including the one-active-invoice 409). Totals are asserted against the
hand-computed integer math so the API and the calculation service can't drift.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.extensions.database import db


def _csrf(client) -> dict:
    client.get("/api/v1/auth/csrf")
    token = next(
        (
            c.value
            for k, c in getattr(client, "_cookies", {}).items()
            if isinstance(k, tuple) and k[2] == "csrf_token"
        ),
        "",
    )
    return {"X-CSRF-Token": token}


def _make_client(authed_client, name="Acme Decorators", **overrides):
    payload = {"name": name}
    payload.update(overrides)
    resp = authed_client.post("/api/v1/clients", json=payload, headers=_csrf(authed_client))
    assert resp.status_code == 201, resp.get_data(as_text=True)
    return resp.get_json()["data"]["client"]


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


# ------------------------------------------------------------------- auth guards


def test_list_requires_authentication(client):
    assert client.get("/api/v1/quotations").status_code == 401


def test_create_requires_csrf(authed_client):
    created_client = _make_client(authed_client)
    resp = authed_client.post(
        "/api/v1/quotations", json=_quotation_payload(created_client["id"])
    )
    assert resp.status_code == 403


# ------------------------------------------------------------------- create + totals


def test_create_allocates_number_and_computes_totals(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])

    assert q["status"] == "draft"
    assert q["number"].startswith("QTN-")
    # subtotal = qty(1.000) * rate(50000.00) = 50000.00 = 5_000_000 paise
    assert q["subtotal_paise"] == 5_000_000
    assert q["discount_paise"] == 0
    # gst = 18% of 5_000_000 = 900_000
    assert q["gst_paise"] == 900_000
    assert q["grand_total_paise"] == 5_900_000
    assert q["items"][0]["line_total_paise"] == 5_000_000


def test_create_number_increments(authed_client):
    c = _make_client(authed_client)
    first = _create_quotation(authed_client, c["id"])
    second = _create_quotation(authed_client, c["id"])
    assert first["number"] != second["number"]


def test_percent_discount_applied_before_gst(authed_client):
    c = _make_client(authed_client)
    # 10% discount on 5_000_000 → discount 500_000, taxable 4_500_000, gst 810_000
    q = _create_quotation(authed_client, c["id"], discount_type="percent", discount_bp=1000)
    assert q["discount_paise"] == 500_000
    assert q["gst_paise"] == 810_000
    assert q["grand_total_paise"] == 5_310_000


def test_fixed_discount_and_other_charges(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(
        authed_client,
        c["id"],
        discount_type="fixed",
        discount_bp=0,
        discount_fixed_paise=1_000_000,
        other_charges_paise=25_000,
    )
    # taxable 4_000_000, gst 720_000, + other 25_000
    assert q["discount_paise"] == 1_000_000
    assert q["gst_paise"] == 720_000
    assert q["grand_total_paise"] == 4_745_000


def test_fixed_discount_exceeding_subtotal_is_422(authed_client):
    # Subtotal is 5_000_000 paise (see _quotation_payload). A fixed discount
    # larger than that is a validation error (§10.3) — it must return
    # 422 VALIDATION_ERROR, not a 500 from an unhandled ValueError.
    c = _make_client(authed_client)
    resp = authed_client.post(
        "/api/v1/quotations",
        json=_quotation_payload(
            c["id"],
            discount_type="fixed",
            discount_bp=0,
            discount_fixed_paise=6_000_000,
        ),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422, resp.get_data(as_text=True)
    body = resp.get_json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "exceed" in body["error"]["message"].lower()


# ------------------------------------------------------------------- validation


def test_create_rejects_unknown_client(authed_client):
    resp = authed_client.post(
        "/api/v1/quotations",
        json=_quotation_payload(999999),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422
    details = resp.get_json()["error"]["details"]
    assert any(d["field"] == "client_id" for d in details)


def test_create_rejects_empty_items(authed_client):
    c = _make_client(authed_client)
    resp = authed_client.post(
        "/api/v1/quotations",
        json=_quotation_payload(c["id"], items=[{"name": "x", "qty_milli": 0, "rate_paise": 0}]),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


def test_create_rejects_gst_over_cap(authed_client):
    c = _make_client(authed_client)
    resp = authed_client.post(
        "/api/v1/quotations",
        json=_quotation_payload(c["id"], gst_bp=3000),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------- read + list


def test_get_returns_allowed_actions(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    detail = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert "send" in detail["allowed_actions"]
    assert "duplicate" in detail["allowed_actions"]
    assert detail["is_expired"] is False


def test_get_unknown_returns_404(authed_client):
    assert authed_client.get("/api/v1/quotations/999999").status_code == 404


def test_list_filters_by_status(authed_client):
    c = _make_client(authed_client)
    q1 = _create_quotation(authed_client, c["id"])
    _create_quotation(authed_client, c["id"])
    assert _status(authed_client, q1["id"], "send").status_code == 200

    sent = authed_client.get("/api/v1/quotations?status=sent").get_json()["data"]
    assert sent["total"] == 1
    assert sent["items"][0]["id"] == q1["id"]


def test_list_search_by_number(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    found = authed_client.get(
        "/api/v1/quotations", query_string={"q": q["number"]}
    ).get_json()["data"]
    assert found["total"] == 1


# ------------------------------------------------------------------- update


def test_update_recomputes_totals(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    resp = authed_client.put(
        f"/api/v1/quotations/{q['id']}",
        json=_quotation_payload(
            c["id"], items=[{"name": "Wardrobe", "qty_milli": 2000, "rate_paise": 1000000}]
        ),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200
    updated = resp.get_json()["data"]["quotation"]
    # 2.000 * 10000.00 = 20000.00 = 2_000_000 paise
    assert updated["subtotal_paise"] == 2_000_000
    assert len(updated["items"]) == 1
    assert updated["items"][0]["name"] == "Wardrobe"


def test_update_blocked_after_approval(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    _status(authed_client, q["id"], "approve")

    resp = authed_client.put(
        f"/api/v1/quotations/{q['id']}",
        json=_quotation_payload(c["id"]),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------- lifecycle


def test_send_approve_flow(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])

    sent = _status(authed_client, q["id"], "send")
    assert sent.status_code == 200
    assert sent.get_json()["data"]["quotation"]["status"] == "sent"

    approved = _status(authed_client, q["id"], "approve")
    assert approved.status_code == 200
    assert approved.get_json()["data"]["quotation"]["status"] == "approved"


def test_reject_then_reopen_not_allowed(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    _status(authed_client, q["id"], "reject")

    # Reopen only applies to sent, not rejected.
    resp = _status(authed_client, q["id"], "reopen")
    assert resp.status_code == 422


def test_reopen_sent_returns_to_draft(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    reopened = _status(authed_client, q["id"], "reopen")
    assert reopened.status_code == 200
    assert reopened.get_json()["data"]["quotation"]["status"] == "draft"


def test_cannot_approve_from_draft(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    assert _status(authed_client, q["id"], "approve").status_code == 422


# ------------------------------------------------------------------- delete


def test_delete_draft(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    resp = authed_client.delete(
        f"/api/v1/quotations/{q['id']}", headers=_csrf(authed_client)
    )
    assert resp.status_code == 200
    assert authed_client.get(f"/api/v1/quotations/{q['id']}").status_code == 404


def test_delete_sent_blocked(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    resp = authed_client.delete(
        f"/api/v1/quotations/{q['id']}", headers=_csrf(authed_client)
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------- duplicate


def test_duplicate_creates_new_draft(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")

    resp = authed_client.post(
        f"/api/v1/quotations/{q['id']}/duplicate", headers=_csrf(authed_client)
    )
    assert resp.status_code == 201
    dup = resp.get_json()["data"]["quotation"]
    assert dup["status"] == "draft"
    assert dup["number"] != q["number"]
    assert dup["grand_total_paise"] == q["grand_total_paise"]


# ------------------------------------------------------------------- convert


def test_convert_requires_approved(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    resp = authed_client.post(
        f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)
    )
    assert resp.status_code == 422


def test_convert_approved_creates_invoice_and_marks_converted(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    _status(authed_client, q["id"], "approve")

    resp = authed_client.post(
        f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)
    )
    assert resp.status_code == 201, resp.get_data(as_text=True)
    invoice = resp.get_json()["data"]["invoice"]
    assert invoice["number"].startswith("INV-")

    detail = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert detail["status"] == "converted"


def test_convert_twice_conflicts(authed_client):
    c = _make_client(authed_client)
    q = _create_quotation(authed_client, c["id"])
    _status(authed_client, q["id"], "send")
    _status(authed_client, q["id"], "approve")

    first = authed_client.post(
        f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)
    )
    assert first.status_code == 201
    # Quotation is now converted; a second attempt is a business-rule 422.
    second = authed_client.post(
        f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)
    )
    assert second.status_code == 422
