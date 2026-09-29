"""
Phase 4 client tests (PLAN §9.2, §4.2, §25 Phase 4).

Covers the acceptance bullets: auth + CSRF guards, validation, create/read/update,
search (including LIKE-wildcard escaping), archive/restore idempotency and
restoration, and the relationship summary (empty-safe and with seeded rows).

Per §11, only issued invoices count toward money totals, so the summary test
seeds an issued invoice, a draft invoice (excluded) and a payment and asserts the
hand-computed paise totals.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.extensions.database import db
from app.models import Client, Invoice, Payment, Quotation


def _csrf(client):
    """Ensure a CSRF cookie is issued and read it back as a request header."""
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
    response = authed_client.post(
        "/api/v1/clients", json=payload, headers=_csrf(authed_client)
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()["data"]["client"]


def _client_id_from(response):
    return response.get_json()["data"]["client"]["id"]


# ------------------------------------------------------------------- auth guards


def test_clients_endpoint_requires_authentication(client):
    assert client.get("/api/v1/clients").status_code == 401


def test_create_requires_csrf_header(authed_client):
    response = authed_client.post("/api/v1/clients", json={"name": "No CSRF"})
    assert response.status_code == 403


# ------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "payload",
    [{}, {"name": ""}, {"name": "   "}],
)
def test_name_is_required(authed_client, payload):
    response = authed_client.post(
        "/api/v1/clients", json=payload, headers=_csrf(authed_client)
    )
    assert response.status_code == 422
    details = response.get_json()["error"]["details"]
    assert any(d["field"] == "name" for d in details)


def test_blank_optional_fields_clear_to_null(authed_client):
    response = authed_client.post(
        "/api/v1/clients",
        json={"name": "Clear Fields", "email": "", "phone": ""},
        headers=_csrf(authed_client),
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    client_data = response.get_json()["data"]["client"]
    assert client_data["email"] is None
    assert client_data["phone"] is None


def test_unknown_fields_are_ignored(authed_client):
    response = authed_client.post(
        "/api/v1/clients",
        json={"name": "Ignore Me", "archived_at": "2024-01-01T00:00:00"},
        headers=_csrf(authed_client),
    )
    assert response.status_code == 201
    assert response.get_json()["data"]["client"]["is_archived"] is False


# ------------------------------------------------------------------- crud


def test_create_and_retrieve(authed_client):
    created = _make_client(
        authed_client, "Acme Decorators", phone="+91 99999 99999", email="a@b.in"
    )
    fetched = authed_client.get(f"/api/v1/clients/{created['id']}").get_json()["data"]["client"]
    assert fetched["name"] == "Acme Decorators"
    assert fetched["phone"] == "+91 99999 99999"
    assert fetched["email"] == "a@b.in"


def test_list_returns_items_and_total(authed_client):
    _make_client(authed_client, "Alpha")
    _make_client(authed_client, "Beta")
    data = authed_client.get("/api/v1/clients").get_json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2


def test_update_edits_fields_and_clears_blank(authed_client):
    created = _make_client(authed_client, "Gamma")
    response = authed_client.put(
        f"/api/v1/clients/{created['id']}",
        json={"name": "Gamma Ltd", "email": "gamma@example.com"},
        headers=_csrf(authed_client),
    )
    assert response.status_code == 200
    updated = response.get_json()["data"]["client"]
    assert updated["name"] == "Gamma Ltd"
    assert updated["email"] == "gamma@example.com"

    # Blanking a field clears it to None rather than 422-ing.
    response = authed_client.put(
        f"/api/v1/clients/{created['id']}",
        json={"name": "Gamma Ltd", "email": ""},
        headers=_csrf(authed_client),
    )
    assert response.status_code == 200
    assert response.get_json()["data"]["client"]["email"] is None


def test_get_unknown_client_returns_404(authed_client):
    assert authed_client.get("/api/v1/clients/999999").status_code == 404


# ------------------------------------------------------------------- search


def test_search_matches_name_phone_email(authed_client):
    _make_client(authed_client, "Acme Decorators", phone="+91 99999 99999", email="acme@example.com")
    _make_client(authed_client, "Beta Interiors", phone="+91 88888 88888", email="beta@example.com")

    names = [i["name"] for i in authed_client.get("/api/v1/clients?q=acme").get_json()["data"]["items"]]
    assert names == ["Acme Decorators"]

    names = [i["name"] for i in authed_client.get("/api/v1/clients?q=99999").get_json()["data"]["items"]]
    assert names == ["Acme Decorators"]

    names = [i["name"] for i in authed_client.get("/api/v1/clients?q=beta%40example.com").get_json()["data"]["items"]]
    assert names == ["Beta Interiors"]


def test_search_escapes_like_wildcards(authed_client):
    """A literal `%` or `_` typed by the user must not become a wildcard (§16)."""
    _make_client(authed_client, "50% Off")
    _make_client(authed_client, "Normal Client")
    _make_client(authed_client, "abc_def")

    names = [
        i["name"]
        for i in authed_client.get("/api/v1/clients", query_string={"q": "%"}).get_json()["data"]["items"]
    ]
    assert names == ["50% Off"]

    names = [
        i["name"]
        for i in authed_client.get("/api/v1/clients", query_string={"q": "_"}).get_json()["data"]["items"]
    ]
    assert names == ["abc_def"]


# ------------------------------------------------------------------- pagination


def test_pagination_splits_results(authed_client):
    for name in ("C1", "C2", "C3"):
        _make_client(authed_client, name)

    first = authed_client.get("/api/v1/clients?page=1&page_size=2").get_json()["data"]
    assert first["total"] == 3
    assert first["page"] == 1
    assert first["page_size"] == 2
    assert len(first["items"]) == 2

    second = authed_client.get("/api/v1/clients?page=2&page_size=2").get_json()["data"]
    assert second["page"] == 2
    assert len(second["items"]) == 1


# ------------------------------------------------------------------- archive / restore


def test_archive_hides_from_list_but_detail_resolves(authed_client):
    created = _make_client(authed_client, "Soon Archived")
    client_id = created["id"]

    archive = authed_client.delete(f"/api/v1/clients/{client_id}", headers=_csrf(authed_client))
    assert archive.status_code == 200
    assert archive.get_json()["data"]["client"]["is_archived"] is True

    # Gone from the default list...
    default = authed_client.get("/api/v1/clients").get_json()["data"]
    assert all(i["id"] != client_id for i in default["items"])

    # ...but the detail URL still works (FR-C4).
    detail = authed_client.get(f"/api/v1/clients/{client_id}").get_json()["data"]["client"]
    assert detail["is_archived"] is True

    # ...and surfaces with include_archived=true.
    with_archived = authed_client.get("/api/v1/clients?include_archived=true").get_json()["data"]
    assert any(i["id"] == client_id for i in with_archived["items"])


def test_archive_is_idempotent(authed_client):
    created = _make_client(authed_client, "Twice")
    client_id = created["id"]

    first = authed_client.delete(f"/api/v1/clients/{client_id}", headers=_csrf(authed_client))
    second = authed_client.delete(f"/api/v1/clients/{client_id}", headers=_csrf(authed_client))
    assert first.status_code == 200
    assert second.status_code == 200


def test_restore_returns_client_to_lists(authed_client):
    created = _make_client(authed_client, "Restored")
    client_id = created["id"]
    headers = _csrf(authed_client)

    authed_client.delete(f"/api/v1/clients/{client_id}", headers=headers)
    assert authed_client.get("/api/v1/clients?include_archived=true").get_json()["data"]["total"] >= 1

    restored = authed_client.post(
        f"/api/v1/clients/{client_id}/restore", headers=headers
    )
    assert restored.status_code == 200
    assert restored.get_json()["data"]["client"]["is_archived"] is False

    default = authed_client.get("/api/v1/clients").get_json()["data"]
    assert any(i["id"] == client_id for i in default["items"])


def test_restore_active_client_conflicts(authed_client):
    created = _make_client(authed_client, "Already Active")
    client_id = created["id"]
    response = authed_client.post(
        f"/api/v1/clients/{client_id}/restore", headers=_csrf(authed_client)
    )
    assert response.status_code == 409


def test_restore_unknown_client_404s(authed_client):
    response = authed_client.post(
        "/api/v1/clients/999999/restore", headers=_csrf(authed_client)
    )
    assert response.status_code == 404


# ------------------------------------------------------------------- summary


def test_summary_empty_is_zero_safe(authed_client):
    created = _make_client(authed_client, "Lonely")
    summary = authed_client.get(f"/api/v1/clients/{created['id']}/summary").get_json()["data"]
    assert summary["client"]["id"] == created["id"]
    assert summary["quotations"] == []
    assert summary["invoices"] == []
    assert summary["payments"] == []
    assert summary["totals"] == {
        "billed_paise": 0,
        "received_paise": 0,
        "outstanding_paise": 0,
    }


def test_summary_totals_with_seeded_rows(authed_client):
    created = _make_client(authed_client, "With History", phone="+91 77777 77777")
    client_id = created["id"]

    with authed_client.application.app_context():
        client_row = db.session.get(Client, client_id)
        issued = Invoice(
            number="INV-TEST-0001",
            year=2026,
            client_id=client_row.id,
            status="issued",
            grand_total_paise=50000,
            issue_date=date(2026, 1, 10),
            due_date=date(2026, 2, 9),
        )
        draft = Invoice(
            number="INV-TEST-0002",
            year=2026,
            client_id=client_row.id,
            status="draft",
            grand_total_paise=9999,
            issue_date=date(2026, 2, 1),
            due_date=date(2026, 3, 3),
        )
        quotation = Quotation(
            number="QTN-TEST-0001",
            year=2026,
            client_id=client_row.id,
            quotation_date=date(2026, 1, 1),
            status="draft",
            grand_total_paise=10000,
        )
        db.session.add_all([issued, draft, quotation])
        db.session.commit()

        payment = Payment(
            invoice_id=issued.id,
            amount_paise=20000,
            paid_on=date(2026, 1, 20),
            method="upi",
            reference="UPI-REF-1",
        )
        db.session.add(payment)
        db.session.commit()

    data = authed_client.get(f"/api/v1/clients/{client_id}/summary").get_json()["data"]

    # Quotations are shown regardless of status.
    assert len(data["quotations"]) == 1
    assert data["quotations"][0]["number"] == "QTN-TEST-0001"

    # Only the issued invoice is billed (§11); the draft is excluded.
    assert len(data["invoices"]) == 1
    assert data["invoices"][0]["number"] == "INV-TEST-0001"
    assert data["invoices"][0]["grand_total_paise"] == 50000
    assert data["invoices"][0]["paid_paise"] == 20000
    assert data["invoices"][0]["outstanding_paise"] == 30000
    assert data["invoices"][0]["payment_status"] == "partially_paid"

    assert len(data["payments"]) == 1
    assert data["payments"][0]["amount_paise"] == 20000

    # Hand-computed totals: billed=50000, received=20000, outstanding=30000.
    assert data["totals"] == {
        "billed_paise": 50000,
        "received_paise": 20000,
        "outstanding_paise": 30000,
    }
