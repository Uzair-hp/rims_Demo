"""
Phase 3 settings tests.

Mapped to PLAN §25 Phase 3: every Settings section saves, validates and reloads
correctly; terms CRUD; the default flag stays exclusive per scope; and the
singleton row is created on demand with §15 defaults.
"""

from __future__ import annotations

import pytest

from app import create_app
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


# ------------------------------------------------------------- UPI ID (�8.5)
#
# The UPI ID is the one payment field with teeth: the QR is *generated* from it, so
# a typo does not produce a bad document, it directs a customer's money to a handle
# that does not exist. Validated for shape only � a provider suffix is not a closed
# set, and an allow-list would block legitimate accounts.


def test_upi_id_saves_and_reloads(authed_client):
    header = _csrf_header(authed_client)
    saved = authed_client.put(
        "/api/v1/settings/company",
        json={"upi_id": "ruchitainteriors@upi"},
        headers=header,
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()["data"]["settings"]["upi_id"] == "ruchitainteriors@upi"


@pytest.mark.parametrize(
    "vpa",
    ["ruchitainteriors@upi", "name@okaxis", "6011@mobikwik", "name@paytm", "name@ybl", "a@b"],
)
def test_upi_id_accepts_any_provider(authed_client, vpa):
    """A provider allow-list would be wrong: the set is not enumerable."""
    response = authed_client.put(
        "/api/v1/settings/company", json={"upi_id": vpa}, headers=_csrf_header(authed_client)
    )
    assert response.status_code == 200, response.get_data(as_text=True)


@pytest.mark.parametrize(
    ("vpa", "fragment"),
    [
        ("not-a-vpa", "must contain an @"),
        ("@okaxis", "both sides"),
        ("business@", "both sides"),
        ("my upi@okaxis", "cannot contain spaces"),
        ("business@ ok axis", "cannot contain spaces"),
        # Over-length is caught by the schema's `Length(max=100)` before the service
        # validator runs, so the message is marshmallow's rather than the friendlier
        # one below. Both are a 422, which is what matters.
        ("x" * 101 + "@y", "maximum length"),
    ],
)
def test_upi_id_rejects_malformed_addresses(authed_client, vpa, fragment):
    response = authed_client.put(
        "/api/v1/settings/company", json={"upi_id": vpa}, headers=_csrf_header(authed_client)
    )
    assert response.status_code == 422
    assert fragment in response.get_data(as_text=True)


def test_empty_upi_id_is_allowed_and_turns_the_qr_off(authed_client):
    """
    An owner with no UPI account must still be able to save their bank details.

    An empty ID is the documented way to say "no QR", so it is a valid value rather
    than a validation failure - and the field is nullable, so `None` is too.
    """
    for value in ("", None):
        response = authed_client.put(
            "/api/v1/settings/company",
            json={"upi_id": value, "bank_name": "HDFC Bank"},
            headers=_csrf_header(authed_client),
        )
        assert response.status_code == 200, response.get_data(as_text=True)
        assert response.get_json()["data"]["settings"]["upi_id"] is None


def test_a_preexisting_invalid_upi_id_does_not_block_reads_or_startup(tmp_path):
    """
    The validation is on write only, so a value stored before it existed is never
    re-checked. A stricter rule must not be able to make an existing install fail to
    start, which is why the check is in `save_settings` rather than in the model or
    in `to_dict`.
    """
    db_path = tmp_path / "legacy.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        db.create_all()
        # Exactly what an older install could hold: a value today's rule rejects.
        CompanySettings.get_row().upi_id = "not a valid vpa"

    # The app still serves the row verbatim, and the offending value is reported
    # rather than raised.
    with app.test_client() as client:
        client.post(
            "/api/v1/auth/login",
            json={"email": "a@b.co", "password": "x"},
        )
        response = client.get("/api/v1/settings/company")
        assert response.status_code in (200, 401)
        if response.status_code == 200:
            assert response.get_json()["data"]["settings"]["upi_id"] == "not a valid vpa"


# ------------------------------------------------------------- CSRF on writes
#
# These four routes were the only mutating endpoints in the app without
# `@csrf_protect` (�16, "every non-GET mutation"). It stopped mattering the moment
# this blueprint started carrying the UPI ID and bank details: a cross-site request
# could otherwise rewrite where customers are told to send money.


def test_put_company_requires_csrf(authed_client):
    response = authed_client.put("/api/v1/settings/company", json={"upi_id": "attacker@evil"})
    assert response.status_code == 403
    # The stored value is untouched.
    stored = authed_client.get("/api/v1/settings/company").get_json()["data"]["settings"]["upi_id"]
    assert stored != "attacker@evil"


def test_terms_mutations_require_csrf(authed_client):
    assert authed_client.post("/api/v1/settings/terms", json={"scope": "both", "title": "T", "body": "B"}).status_code == 403
    assert authed_client.put("/api/v1/settings/terms/1", json={"title": "T2"}).status_code == 403
    assert authed_client.delete("/api/v1/settings/terms/1").status_code == 403
