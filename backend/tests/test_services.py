"""
Phase 9A services catalog tests (SERVICES_PLAN §9).

Covers the acceptance bullets: auth + CSRF guards, CRUD validation (rate must be
> 0), the partial unique name among active services (archived names reusable,
restore collision 409), search/category filter/pagination, archive/restore, and
the snapshot rules — editing a catalog rate never changes an existing quotation
or invoice, and conversion + duplicate carry `service_id` / `catalog_rate_paise`
through. `test_calculations.py` is untouched and still green, which is what
proves S7 (service metadata never enters the calculation core).
"""

from __future__ import annotations

from datetime import date

import pytest

from app.extensions.database import db
from app.models import Quotation


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


def _service_payload(name="Modular kitchen", rate_paise=500000, **overrides):
    payload = {
        "name": name,
        "category": "Kitchen",
        "description": "Full modular kitchen with soft-close hardware.",
        "unit": "job",
        "default_qty_milli": 1000,
        "rate_paise": rate_paise,
    }
    payload.update(overrides)
    return payload


def _make_service(authed_client, name="Modular kitchen", **overrides):
    response = authed_client.post(
        "/api/v1/services", json=_service_payload(name, **overrides), headers=_csrf(authed_client)
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()["data"]["service"]


# ------------------------------------------------------------------- auth guards


def test_services_require_authentication(client):
    assert client.get("/api/v1/services").status_code == 401


def test_create_requires_csrf_header(authed_client):
    response = authed_client.post("/api/v1/services", json=_service_payload("No CSRF"))
    assert response.status_code == 403


# ------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "payload",
    [
        {},  # no name, no rate
        {"name": "Only name"},  # rate missing
        {"name": "Free", "rate_paise": 0},  # S3: zero rate
        {"name": "Pays us", "rate_paise": -500},  # S3: negative rate
        {"name": "", "rate_paise": 500000},  # empty name
        {"name": "   ", "rate_paise": 500000},  # whitespace name
        {"name": "Overflow", "rate_paise": 10**12 + 1},  # §10.3 cap
        {"name": "Qty below zero", "rate_paise": 500000, "default_qty_milli": -1},
    ],
)
def test_invalid_payloads_are_422(authed_client, payload):
    response = authed_client.post("/api/v1/services", json=payload, headers=_csrf(authed_client))
    assert response.status_code == 422


def test_malformed_json_is_422_envelope(authed_client):
    response = authed_client.post(
        "/api/v1/services",
        data="not json",
        content_type="application/json",
        headers=_csrf(authed_client),
    )
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_create_applies_defaults_and_strips_optional_text(authed_client):
    created = _make_service(authed_client, "Wardrobe", unit=None, category="", description="")
    assert created["unit"] == "job"  # FR-SV1 default
    assert created["default_qty_milli"] == 1000
    assert created["category"] is None  # "" clears to null
    assert created["description"] is None
    assert created["is_archived"] is False


def test_unknown_fields_are_ignored(authed_client):
    response = authed_client.post(
        "/api/v1/services",
        json=_service_payload("Ignore Me", archived_at="2024-01-01T00:00:00"),
        headers=_csrf(authed_client),
    )
    assert response.status_code == 201
    assert response.get_json()["data"]["service"]["is_archived"] is False


# ------------------------------------------------------------------- duplicate names (FR-SV3)


def test_duplicate_active_name_conflicts_case_insensitively(authed_client):
    _make_service(authed_client, "False Ceiling")
    for variant in ("false ceiling", "FALSE CEILING", "False Ceiling"):
        response = authed_client.post(
            "/api/v1/services", json=_service_payload(variant), headers=_csrf(authed_client)
        )
        assert response.status_code == 409


def test_archived_name_is_reusable(authed_client):
    first = _make_service(authed_client, "Painting")
    authed_client.delete(f"/api/v1/services/{first['id']}", headers=_csrf(authed_client))

    second = _make_service(authed_client, "painting")  # even case-insensitively
    assert second["id"] != first["id"]


def test_rename_onto_own_name_is_allowed(authed_client):
    created = _make_service(authed_client, "Wall Panel")
    response = authed_client.put(
        f"/api/v1/services/{created['id']}",
        json=_service_payload("wall panel"),
        headers=_csrf(authed_client),
    )
    assert response.status_code == 200
    assert response.get_json()["data"]["service"]["name"] == "wall panel"


# ------------------------------------------------------------------- crud


def test_get_unknown_service_returns_404(authed_client):
    assert authed_client.get("/api/v1/services/999999").status_code == 404


def test_update_edits_fields(authed_client):
    created = _make_service(authed_client, "Wall Panel")
    response = authed_client.put(
        f"/api/v1/services/{created['id']}",
        json=_service_payload("Wall Panel XL", category="Panels", rate_paise=750000),
        headers=_csrf(authed_client),
    )
    updated = response.get_json()["data"]["service"]
    assert updated["name"] == "Wall Panel XL"
    assert updated["category"] == "Panels"
    assert updated["rate_paise"] == 750000


# ------------------------------------------------------------------- search / filter / pagination


def test_search_matches_name_category_and_description(authed_client):
    _make_service(authed_client, "False Ceiling", category="Ceiling", description="Gypsum board work")
    _make_service(authed_client, "Wardrobe", category="Storage", description="Loft unit")

    names = [i["name"] for i in authed_client.get("/api/v1/services?q=ceiling").get_json()["data"]["items"]]
    # "ceiling" matches the name *and* the category of the first service only.
    assert names == ["False Ceiling"]

    names = [i["name"] for i in authed_client.get("/api/v1/services?q=gypsum").get_json()["data"]["items"]]
    assert names == ["False Ceiling"]  # matches by description


def test_search_escapes_like_wildcards(authed_client):
    _make_service(authed_client, "50% Work")
    _make_service(authed_client, "Normal Service")
    _make_service(authed_client, "a_b Service")

    names = [
        i["name"]
        for i in authed_client.get("/api/v1/services", query_string={"q": "%"}).get_json()["data"]["items"]
    ]
    assert names == ["50% Work"]

    names = [
        i["name"]
        for i in authed_client.get("/api/v1/services", query_string={"q": "_"}).get_json()["data"]["items"]
    ]
    assert names == ["a_b Service"]


def test_category_filter_is_exact(authed_client):
    _make_service(authed_client, "False Ceiling", category="Ceiling")
    _make_service(authed_client, "Wardrobe", category="Storage")

    names = [
        i["name"]
        for i in authed_client.get("/api/v1/services", query_string={"category": "Storage"}).get_json()["data"]["items"]
    ]
    assert names == ["Wardrobe"]


def test_list_sorts_category_then_name(authed_client):
    _make_service(authed_client, "Beta", category="Kitchen")
    _make_service(authed_client, "Alpha", category="Kitchen")
    _make_service(authed_client, "Adam", category="Ceiling")

    rows = authed_client.get("/api/v1/services").get_json()["data"]["items"]
    assert [(r["category"], r["name"]) for r in rows] == [
        ("Ceiling", "Adam"),
        ("Kitchen", "Alpha"),
        ("Kitchen", "Beta"),
    ]


def test_pagination_splits_results(authed_client):
    for i in range(3):
        _make_service(authed_client, f"Service {i}", category=f"Cat {i}")

    first = authed_client.get("/api/v1/services?page=1&page_size=2").get_json()["data"]
    assert first["total"] == 3
    assert first["page"] == 1
    assert first["page_size"] == 2
    assert len(first["items"]) == 2

    second = authed_client.get("/api/v1/services?page=2&page_size=2").get_json()["data"]
    assert second["page"] == 2
    assert len(second["items"]) == 1


# ------------------------------------------------------------------- archive / restore


def test_archive_hides_from_list_but_detail_resolves(authed_client):
    created = _make_service(authed_client, "Soon Archived")
    service_id = created["id"]

    archive = authed_client.delete(f"/api/v1/services/{service_id}", headers=_csrf(authed_client))
    assert archive.status_code == 200
    assert archive.get_json()["data"]["service"]["is_archived"] is True

    default = authed_client.get("/api/v1/services").get_json()["data"]
    assert all(i["id"] != service_id for i in default["items"])

    detail = authed_client.get(f"/api/v1/services/{service_id}").get_json()["data"]["service"]
    assert detail["is_archived"] is True

    with_archived = authed_client.get("/api/v1/services?include_archived=true").get_json()["data"]
    assert any(i["id"] == service_id for i in with_archived["items"])


def test_archive_is_idempotent(authed_client):
    created = _make_service(authed_client, "Twice")
    service_id = created["id"]
    headers = _csrf(authed_client)

    first = authed_client.delete(f"/api/v1/services/{service_id}", headers=headers)
    second = authed_client.delete(f"/api/v1/services/{service_id}", headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200


def test_restore_returns_service_to_lists(authed_client):
    created = _make_service(authed_client, "Restored")
    service_id = created["id"]
    headers = _csrf(authed_client)

    authed_client.delete(f"/api/v1/services/{service_id}", headers=headers)
    assert authed_client.get("/api/v1/services?include_archived=true").get_json()["data"]["total"] >= 1

    restored = authed_client.post(f"/api/v1/services/{service_id}/restore", headers=headers)
    assert restored.status_code == 200
    assert restored.get_json()["data"]["service"]["is_archived"] is False

    default = authed_client.get("/api/v1/services").get_json()["data"]
    assert any(i["id"] == service_id for i in default["items"])


def test_restore_active_service_conflicts(authed_client):
    created = _make_service(authed_client, "Already Active")
    response = authed_client.post(
        f"/api/v1/services/{created['id']}/restore", headers=_csrf(authed_client)
    )
    assert response.status_code == 409


def test_restore_colliding_with_active_name_conflicts(authed_client):
    """Edge case 6: an active service took the name while this one was archived."""
    original = _make_service(authed_client, "Collision")
    authed_client.delete(f"/api/v1/services/{original['id']}", headers=_csrf(authed_client))

    _make_service(authed_client, "collision")

    response = authed_client.post(
        f"/api/v1/services/{original['id']}/restore", headers=_csrf(authed_client)
    )
    assert response.status_code == 409


def test_restore_unknown_service_404s(authed_client):
    response = authed_client.post("/api/v1/services/999999/restore", headers=_csrf(authed_client))
    assert response.status_code == 404


# ------------------------------------------------------------------- snapshot rules (S2, S7, FR-SV8)


def _make_quotation_with_service(authed_client, service):
    """Create a client + draft quotation with one line taken from the catalog."""
    client_resp = authed_client.post(
        "/api/v1/clients", json={"name": "Snapshot Client"}, headers=_csrf(authed_client)
    )
    client_id = client_resp.get_json()["data"]["client"]["id"]

    payload = {
        "client_id": client_id,
        "quotation_date": date.today().isoformat(),
        "gst_bp": 1800,
        "items": [
            {
                "name": service["name"],
                "qty_milli": service["default_qty_milli"],
                "rate_paise": service["rate_paise"],
                "service_id": service["id"],
                "catalog_rate_paise": service["rate_paise"],
            }
        ],
    }
    resp = authed_client.post("/api/v1/quotations", json=payload, headers=_csrf(authed_client))
    assert resp.status_code == 201, resp.get_data(as_text=True)
    return resp.get_json()["data"]["quotation"]


def test_quotation_item_carries_service_fields(authed_client):
    service = _make_service(authed_client, "Catalog Line", rate_paise=123456)
    q = _make_quotation_with_service(authed_client, service)

    assert q["items"][0]["service_id"] == service["id"]
    assert q["items"][0]["catalog_rate_paise"] == 123456
    # S7: the metadata did not change the money — 1.000 × ₹1,234.56 = 123456 paise.
    assert q["items"][0]["line_total_paise"] == 123456
    assert q["subtotal_paise"] == 123456


def test_quotation_item_without_service_has_null_fields(authed_client):
    client_resp = authed_client.post(
        "/api/v1/clients", json={"name": "Plain Client"}, headers=_csrf(authed_client)
    )
    client_id = client_resp.get_json()["data"]["client"]["id"]
    resp = authed_client.post(
        "/api/v1/quotations",
        json={
            "client_id": client_id,
            "quotation_date": date.today().isoformat(),
            "gst_bp": 0,
            "items": [{"name": "Hand typed", "qty_milli": 1000, "rate_paise": 100000}],
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 201
    item = resp.get_json()["data"]["quotation"]["items"][0]
    assert item["service_id"] is None
    assert item["catalog_rate_paise"] is None


def test_unknown_service_id_in_quotation_put_is_422(authed_client):
    client_resp = authed_client.post(
        "/api/v1/clients", json={"name": "Unknown Ref"}, headers=_csrf(authed_client)
    )
    client_id = client_resp.get_json()["data"]["client"]["id"]
    resp = authed_client.post(
        "/api/v1/quotations",
        json={
            "client_id": client_id,
            "quotation_date": date.today().isoformat(),
            "gst_bp": 0,
            "items": [
                {"name": "Ghost", "qty_milli": 1000, "rate_paise": 100000, "service_id": 999999}
            ],
        },
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 422


def test_archived_service_id_is_still_saveable(authed_client):
    """Edge case 2: a draft holding a since-archived service can still be saved."""
    service = _make_service(authed_client, "Will Vanish")
    q = _make_quotation_with_service(authed_client, service)
    authed_client.delete(f"/api/v1/services/{service['id']}", headers=_csrf(authed_client))

    payload = {
        "client_id": q["client_id"],
        "quotation_date": q["quotation_date"],
        "gst_bp": q["gst_bp"],
        "items": [
            {
                "name": q["items"][0]["name"],
                "qty_milli": q["items"][0]["qty_milli"],
                "rate_paise": q["items"][0]["rate_paise"],
                "service_id": service["id"],
                "catalog_rate_paise": service["rate_paise"],
            }
        ],
    }
    resp = authed_client.put(f"/api/v1/quotations/{q['id']}", json=payload, headers=_csrf(authed_client))
    assert resp.status_code == 200
    assert resp.get_json()["data"]["quotation"]["items"][0]["service_id"] == service["id"]


def test_editing_catalog_rate_never_changes_existing_documents(authed_client):
    """S2: the line stores the agreed rate; the catalog edit affects new lines only."""
    service = _make_service(authed_client, "Rising Rate", rate_paise=500000)
    q = _make_quotation_with_service(authed_client, service)
    assert q["items"][0]["rate_paise"] == 500000

    resp = authed_client.put(
        f"/api/v1/services/{service['id']}",
        json=_service_payload("Rising Rate", rate_paise=900000),
        headers=_csrf(authed_client),
    )
    assert resp.status_code == 200

    refetched = authed_client.get(f"/api/v1/quotations/{q['id']}").get_json()["data"]["quotation"]
    assert refetched["items"][0]["rate_paise"] == 500000  # line unchanged
    assert refetched["items"][0]["catalog_rate_paise"] == 500000  # snapshot unchanged
    assert refetched["grand_total_paise"] == q["grand_total_paise"]


def test_duplicate_quotation_copies_service_fields(authed_client):
    """FR-SV8: duplicate copies `service_id` / `catalog_rate_paise` as-is."""
    service = _make_service(authed_client, "Duplicated", rate_paise=77777)
    q = _make_quotation_with_service(authed_client, service)

    resp = authed_client.post(
        f"/api/v1/quotations/{q['id']}/duplicate", headers=_csrf(authed_client)
    )
    assert resp.status_code == 201
    duplicated = resp.get_json()["data"]["quotation"]
    assert duplicated["items"][0]["service_id"] == service["id"]
    assert duplicated["items"][0]["catalog_rate_paise"] == 77777


def test_conversion_copies_service_fields_onto_invoice(authed_client):
    """FR-SV8: conversion carries both fields onto `invoice_items`."""
    service = _make_service(authed_client, "Converted", rate_paise=222222)
    q = _make_quotation_with_service(authed_client, service)

    approved = authed_client.post(
        f"/api/v1/quotations/{q['id']}/status", json={"action": "send"}, headers=_csrf(authed_client)
    )
    assert approved.status_code == 200
    approved = authed_client.post(
        f"/api/v1/quotations/{q['id']}/status", json={"action": "approve"}, headers=_csrf(authed_client)
    )
    assert approved.status_code == 200

    resp = authed_client.post(f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client))
    assert resp.status_code == 201, resp.get_data(as_text=True)
    invoice = resp.get_json()["data"]["invoice"]
    assert invoice["items"][0]["service_id"] == service["id"]
    assert invoice["items"][0]["catalog_rate_paise"] == 222222
    assert invoice["items"][0]["rate_paise"] == 222222


def test_editing_catalog_rate_never_changes_a_converted_invoice(authed_client):
    """The full §9 acceptance flow, end to end."""
    service = _make_service(authed_client, "Frozen After Convert", rate_paise=300000)
    q = _make_quotation_with_service(authed_client, service)

    for action in ("send", "approve"):
        resp = authed_client.post(
            f"/api/v1/quotations/{q['id']}/status", json={"action": action}, headers=_csrf(authed_client)
        )
        assert resp.status_code == 200

    invoice = authed_client.post(f"/api/v1/quotations/{q['id']}/invoice", headers=_csrf(authed_client)).get_json()["data"]["invoice"]

    # Change the catalog after conversion.
    authed_client.put(
        f"/api/v1/services/{service['id']}",
        json=_service_payload("Frozen After Convert", rate_paise=999999),
        headers=_csrf(authed_client),
    )

    fetched = authed_client.get(f"/api/v1/invoices/{invoice['id']}").get_json()["data"]["invoice"]
    assert fetched["items"][0]["rate_paise"] == 300000
    assert fetched["items"][0]["catalog_rate_paise"] == 300000
    assert fetched["grand_total_paise"] == invoice["grand_total_paise"]


def test_saved_quotation_rows_persist_service_fields(authed_client):
    """The DB columns are written, not just echoed: read the raw row."""
    service = _make_service(authed_client, "Raw Row", rate_paise=111111)
    q = _make_quotation_with_service(authed_client, service)

    with authed_client.application.app_context():
        row = db.session.get(Quotation, q["id"])
        assert row.items[0].service_id == service["id"]
        assert row.items[0].catalog_rate_paise == 111111
