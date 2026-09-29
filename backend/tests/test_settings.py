"""
Phase 3 settings tests.

Mapped to PLAN §25 Phase 3: every Settings section saves, validates and reloads
correctly; terms CRUD; the default flag stays exclusive per scope; and the
singleton row is created on demand with §15 defaults.
"""

from __future__ import annotations

import pytest

from app.extensions.database import db
from app.models import CompanySettings, TermsConditions


@pytest.fixture
def authed_client(client):
    """A test client carrying a valid access cookie (login is Phase 2 behaviour)."""
    from app.models import User

    with client.application.app_context():
        user = User(email="owner@test.local", name="Owner", role="owner", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    csrf = client.get("/api/v1/auth/csrf").get_json()
    token = next(
        (c.value for k, c in getattr(client, "_cookies", {}).items() if isinstance(k, tuple) and k[2] == "csrf_token"),
        "",
    )
    # The csrf GET above set the cookie; grab the header value from it.
    token = token or csrf.get("csrf_token", "")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@test.local", "password": "password-123456"},
        headers={"X-CSRF-Token": token},
    )
    assert login.status_code == 200, login.get_data(as_text=True)
    return client


def _csrf_header(client) -> dict:
    client.get("/api/v1/auth/csrf")
    token = next(
        (c.value for k, c in getattr(client, "_cookies", {}).items() if isinstance(k, tuple) and k[2] == "csrf_token"),
        "",
    )
    return {"X-CSRF-Token": token}


# --------------------------------------------------------------- company row


def test_get_settings_creates_row_with_defaults(authed_client):
    response = authed_client.get("/api/v1/settings/company")

    assert response.status_code == 200
    data = response.get_json()["data"]["settings"]
    assert data["company_name"] == "Ruchita Interiors"
    assert data["default_gst_bp"] == 1800
    assert data["default_validity_days"] == 15
    assert data["quotation_prefix"] == "QTN"
    assert data["invoice_prefix"] == "INV"
    assert "Living Room" in data["item_categories"]
    assert "sq.ft" in data["units"]


def test_put_settings_saves_and_reloads(authed_client):
    header = _csrf_header(authed_client)
    payload = {
        "company_name": "Ruchita Interiors Pvt Ltd",
        "phone": "+91 98765 43210",
        "city": "Surat",
        "default_gst_bp": 1800,
        "default_validity_days": 21,
        "quotation_prefix": "RIQ",
        "invoice_prefix": "RII",
        "item_categories": ["Living Room", "Custom Work"],
    }

    saved = authed_client.put("/api/v1/settings/company", json=payload, headers=header)
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()["data"]["settings"]["company_name"] == "Ruchita Interiors Pvt Ltd"

    reloaded = authed_client.get("/api/v1/settings/company")
    data = reloaded.get_json()["data"]["settings"]
    for key, expected in payload.items():
        assert data[key] == expected, key


def test_put_settings_rejects_out_of_range_gst(authed_client):
    header = _csrf_header(authed_client)
    response = authed_client.put(
        "/api/v1/settings/company", json={"default_gst_bp": 5000}, headers=header
    )

    assert response.status_code == 422
    error = response.get_json()["error"]
    assert error["code"] == "VALIDATION_ERROR"


def test_put_settings_rejects_bad_prefix(authed_client):
    header = _csrf_header(authed_client)
    response = authed_client.put(
        "/api/v1/settings/company", json={"quotation_prefix": "not a prefix!"}, headers=header
    )

    assert response.status_code == 422
    fields = {detail.get("field") for detail in response.get_json()["error"]["details"]}
    assert "quotation_prefix" in fields


def test_put_settings_ignores_logo_path(authed_client):
    """`logo_path` changes only via the upload endpoints (§15 Branding)."""
    header = _csrf_header(authed_client)
    response = authed_client.put(
        "/api/v1/settings/company", json={"logo_path": "../../etc/passwd"}, headers=header
    )

    assert response.status_code == 200
    row = CompanySettings.get_row()
    assert row.logo_path is None


def test_put_settings_clears_a_field_with_null_or_empty(authed_client):
    """Nullable columns accept both `null` and `""` as "clear this field"."""
    header = _csrf_header(authed_client)
    authed_client.put(
        "/api/v1/settings/company", json={"city": "Surat", "tagline": "Tag"}, headers=header
    )

    cleared = authed_client.put(
        "/api/v1/settings/company", json={"city": None, "tagline": ""}, headers=header
    )
    assert cleared.status_code == 200
    settings = cleared.get_json()["data"]["settings"]
    assert settings["city"] is None
    assert settings["tagline"] is None


def test_put_settings_rejects_empty_company_name(authed_client):
    """company_name is NOT NULL — an empty save must 422, not 500."""
    header = _csrf_header(authed_client)
    response = authed_client.put(
        "/api/v1/settings/company", json={"company_name": ""}, headers=header
    )

    assert response.status_code == 422
    details = {detail.get("field") for detail in response.get_json()["error"]["details"]}
    assert "company_name" in details


def test_put_settings_rejects_short_ifsc(authed_client):
    header = _csrf_header(authed_client)
    response = authed_client.put(
        "/api/v1/settings/company", json={"bank_ifsc": "SHORT"}, headers=header
    )

    assert response.status_code == 422
    details = {detail.get("field") for detail in response.get_json()["error"]["details"]}
    assert "bank_ifsc" in details


def test_settings_require_authentication(client):
    assert client.get("/api/v1/settings/company").status_code == 401
    assert client.put("/api/v1/settings/company", json={}).status_code in (401, 403)


# --------------------------------------------------------------------- terms


def test_terms_crud_roundtrip(authed_client):
    header = _csrf_header(authed_client)

    created = authed_client.post(
        "/api/v1/settings/terms",
        json={"scope": "quotation", "title": "Quote terms", "body": "1. Advance required.", "is_default": False},
        headers=header,
    )
    assert created.status_code == 201
    term_id = created.get_json()["data"]["term"]["id"]

    updated = authed_client.put(
        f"/api/v1/settings/terms/{term_id}",
        json={"title": "Quote terms v2", "is_default": True},
        headers=header,
    )
    assert updated.status_code == 200
    assert updated.get_json()["data"]["term"]["title"] == "Quote terms v2"
    assert updated.get_json()["data"]["term"]["is_default"] is True

    listed = authed_client.get("/api/v1/settings/terms")
    assert any(t["id"] == term_id for t in listed.get_json()["data"]["terms"])

    deleted = authed_client.delete(f"/api/v1/settings/terms/{term_id}", headers=header)
    assert deleted.status_code == 200

    after = authed_client.get("/api/v1/settings/terms")
    assert not any(t["id"] == term_id for t in after.get_json()["data"]["terms"])


def test_terms_default_is_exclusive_per_scope(authed_client):
    header = _csrf_header(authed_client)

    first = authed_client.post(
        "/api/v1/settings/terms",
        json={"scope": "both", "title": "First", "body": "Body one.", "is_default": True},
        headers=header,
    )
    second = authed_client.post(
        "/api/v1/settings/terms",
        json={"scope": "both", "title": "Second", "body": "Body two.", "is_default": True},
        headers=header,
    )
    first_id = first.get_json()["data"]["term"]["id"]

    row = db.session.get(TermsConditions, first_id)
    assert row.is_default is False, "promoting the second default must demote the first"


def test_terms_rejects_invalid_scope(authed_client):
    header = _csrf_header(authed_client)
    response = authed_client.post(
        "/api/v1/settings/terms",
        json={"scope": " sideways", "title": "T", "body": "B"},
        headers=header,
    )
    assert response.status_code == 422
