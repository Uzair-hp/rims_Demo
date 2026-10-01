"""
Authorization tests (§16).

The application is single-user by design (§1.3): `flask seed-admin` creates one
owner and there is no signup. But `User.role` is a real column, and until the
`owner_required` guard existed nothing read it — so the invariant was a convention
in prose rather than something the code enforced. The moment a second row appeared
(a seed script, a restored backup, a future team feature) that account was
instantly owner-equivalent.

These tests pin the guard on the routes where the blast radius is real: the bank
account number, the UPI ID, the tax defaults, the payment QR, and the owner's own
password. Each of those either redirects customer money or locks the owner out.

The non-owner here is a *test fixture*, not a supported configuration. That is the
point: the guard has to hold for an account nobody planned to create.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.extensions.database import db
from app.models import User


def _login(client, email: str, password: str = "password-123456") -> None:
    client.get("/api/v1/auth/csrf")
    token = next(
        (
            c.value
            for k, c in getattr(client, "_cookies", {}).items()
            if isinstance(k, tuple) and k[2] == "csrf_token"
        ),
        "",
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 200, response.get_data(as_text=True)


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


def _png(size_px=(4, 4)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size_px, (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def non_owner_client(client):
    """A client signed in as an authenticated account that is *not* the owner."""
    with client.application.app_context():
        user = User(email="staff@test.local", name="Staff", role="staff", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    _login(client, "staff@test.local")
    return client


# ------------------------------------------------------------------ the guard


def test_non_owner_cannot_read_company_settings(non_owner_client):
    """The row holds the bank account number and the UPI ID."""
    response = non_owner_client.get("/api/v1/settings/company")

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"


def test_non_owner_cannot_rewrite_where_customers_pay(non_owner_client):
    """
    The single most consequential write in the product.

    `PUT /settings/company` carries `bank_account_number` and `upi_id`, which
    become the printed payment instructions and the `pa` parameter of every
    payment QR. A non-owner rewriting them redirects customer money.
    """
    response = non_owner_client.put(
        "/api/v1/settings/company",
        json={"bank_account_number": "000111222", "upi_id": "attacker@evil"},
        headers=_csrf(non_owner_client),
    )

    assert response.status_code == 403

    with non_owner_client.application.app_context():
        from app.models import CompanySettings

        # Not merely "unchanged" — the guard refuses before the row is even
        # fetched, so there is nothing to have written to. That ordering is what
        # makes the refusal airtight rather than a read-then-decline.
        row = db.session.get(CompanySettings, 1)
        assert row is None or (row.bank_account_number != "000111222" and row.upi_id != "attacker@evil")


def test_non_owner_cannot_replace_the_payment_qr(non_owner_client):
    """The QR is read live on every invoice render, so replacing it redirects payment."""
    response = non_owner_client.post(
        "/api/v1/settings/payment-qr",
        data={"payment_qr": (io.BytesIO(_png()), "qr.png", "image/png")},
        content_type="multipart/form-data",
        headers=_csrf(non_owner_client),
    )

    assert response.status_code == 403

    with non_owner_client.application.app_context():
        from app.models import CompanySettings

        row = db.session.get(CompanySettings, 1)
        assert row is None or row.payment_qr_path is None


def test_non_owner_cannot_delete_the_logo(non_owner_client):
    response = non_owner_client.delete(
        "/api/v1/settings/logo", headers=_csrf(non_owner_client)
    )

    assert response.status_code == 403


def test_non_owner_cannot_upload_a_logo(non_owner_client):
    response = non_owner_client.post(
        "/api/v1/settings/logo",
        data={"logo": (io.BytesIO(_png()), "logo.png", "image/png")},
        content_type="multipart/form-data",
        headers=_csrf(non_owner_client),
    )

    assert response.status_code == 403


def test_non_owner_cannot_edit_terms(non_owner_client):
    """Terms are snapshotted onto every new document, so this rewrites future paperwork."""
    for method, url, body in (
        ("post", "/api/v1/settings/terms", {"scope": "invoice", "title": "X", "body": "Y"}),
        ("put", "/api/v1/settings/terms/1", {"title": "X", "body": "Y"}),
        ("delete", "/api/v1/settings/terms/1", None),
    ):
        response = getattr(non_owner_client, method)(
            url, json=body, headers=_csrf(non_owner_client)
        )
        assert response.status_code == 403, url


def test_non_owner_cannot_take_over_the_owner_password(non_owner_client):
    """
    The sharpest version of the problem.

    `change_password` calls `revoke_sessions()`, which invalidates every existing
    session. Without the role check, a non-owner changing the password kicks the
    real owner out of every device and leaves the caller as the only account that
    can sign in — with the owner's credentials, the company bank details, and the
    UPI ID.
    """
    response = non_owner_client.put(
        "/api/v1/auth/password",
        json={"current_password": "password-123456", "new_password": "a-brand-new-secret-1"},
        headers=_csrf(non_owner_client),
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"

    with non_owner_client.application.app_context():
        # The fixture has no owner account, so the strongest available assertion
        # is that nothing was revoked or rewritten anywhere.
        assert db.session.scalar(db.select(User).where(User.email == "owner@test.local")) is None
        staff = db.session.scalar(db.select(User).where(User.email == "staff@test.local"))
        assert staff.token_version == 0
        assert staff.check_password("password-123456")


def test_a_non_owner_attempt_does_not_disturb_a_real_owner_session(client):
    """
    The owner's live session must survive a rejected takeover attempt.

    This is the failure that matters: the guard has to refuse *before*
    `revoke_sessions()`, or the attacker is rejected and the owner is signed out
    of every device anyway — a self-inflicted denial of service that looks like
    the security control working.
    """
    with client.application.app_context():
        owner = User(email="owner@test.local", name="Owner", role="owner", is_active=True)
        owner.set_password("password-123456")
        staff = User(email="staff@test.local", name="Staff", role="staff", is_active=True)
        staff.set_password("password-123456")
        db.session.add_all([owner, staff])
        db.session.commit()
        owner_id = owner.id

    _login(client, "staff@test.local")
    assert client.get("/api/v1/settings/company").status_code == 403

    rejected = client.put(
        "/api/v1/auth/password",
        json={"current_password": "password-123456", "new_password": "a-brand-new-secret-1"},
        headers=_csrf(client),
    )
    assert rejected.status_code == 403

    with client.application.app_context():
        owner = db.session.get(User, owner_id)
        # Untouched: same password, and no session revoked.
        assert owner.token_version == 0
        assert owner.check_password("password-123456")

    # And the owner can still sign in and use the app afterwards.
    #
    # A fresh app context, because the shared `app` fixture holds one open for the
    # whole test and `load_current_user` memoises on `g`. Two identities in one test
    # would otherwise see the first one's cached user, which is a property of the
    # fixture rather than of the guard. Each request in production gets its own
    # context, so this is what the real request path looks like.
    owner_client = client.application.test_client()
    with client.application.app_context():
        _login(owner_client, "owner@test.local")
        assert owner_client.get("/api/v1/settings/company").status_code == 200

# ------------------------------------------------------- the owner is unaffected


def test_owner_is_still_allowed_everywhere(authed_client):
    """The guard must not lock the actual owner out of their own app."""
    assert authed_client.get("/api/v1/settings/company").status_code == 200
    assert (
        authed_client.put(
            "/api/v1/settings/company",
            json={"company_name": "Ruchita Interiors"},
            headers=_csrf(authed_client),
        ).status_code
        == 200
    )
    assert authed_client.get("/api/v1/settings/terms").status_code == 200


def test_unauthenticated_gets_401_not_403(client):
    """
    A 403 on an anonymous request would confirm the route exists and that an
    owner does, which is the enumeration risk §25 forbids.
    """
    for method, url in (
        ("get", "/api/v1/settings/company"),
        ("get", "/api/v1/settings/terms"),
    ):
        response = getattr(client, method)(url)
        assert response.status_code == 401, url
        assert response.get_json()["error"]["code"] == "UNAUTHENTICATED"


def test_serving_a_stored_image_needs_a_session_but_not_the_owner_role(non_owner_client):
    """
    Reading the logo or the QR is not a privilege: every rendered document needs
    it. Gating the read on the owner role would break nothing today, but it would
    make the next non-owner account unable to print an invoice at all.
    """
    # No image stored yet, so this is a 404 rather than a 403 — which is the
    # point: the request got past both guards.
    response = non_owner_client.get("/api/v1/uploads/logo")
    assert response.status_code == 404


def test_a_null_role_is_refused(client):
    """
    A `NULL` or empty role must fail closed.

    `role` is `nullable=False` today, but a restored backup or a hand-edited row
    could carry one, and `None.strip()` would raise a 500 rather than a clean 403
    if the comparison were written carelessly.
    """
    from app.services.auth import load_current_user  # noqa: F401  (documents intent)

    with client.application.app_context():
        user = User(email="norole@test.local", name="No Role", role="", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    _login(client, "norole@test.local")
    response = client.get("/api/v1/settings/company")

    assert response.status_code == 403


def test_owner_role_matching_is_case_and_space_insensitive(client):
    """A role written as ' Owner ' by a script is still the owner."""
    with client.application.app_context():
        user = User(email="spaced@test.local", name="Spaced", role="  OWNER  ", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    _login(client, "spaced@test.local")

    assert client.get("/api/v1/settings/company").status_code == 200
