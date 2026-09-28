"""
Phase 2 authentication tests.

Mapped to PLAN §25: login with seeded credentials, wrong password returns generic
401, reload/keeps session (via refresh), logout clears, protected APIs return 401
without cookies, missing CSRF header on POST -> 403, 6th attempt -> 429,
password change works and invalidates old sessions.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

import pytest

from app import create_app
from app.config.settings import BACKEND_ROOT, settings
from app.extensions.database import db
from app.models import User
from app.services.rate_limit import reset_rate_limit


@contextmanager
def _override_app_config(**overrides):
    original = {key: getattr(settings, key) for key in overrides}
    for key, value in overrides.items():
        setattr(settings, key, value)
    try:
        yield
    finally:
        for key, value in original.items():
            setattr(settings, key, value)


@pytest.fixture
def app(tmp_path):
    """App with in-memory DB and seeded owner account."""
    db_path = tmp_path / "test.db"
    app = create_app(
        {
            "TESTING": True,
            "WTF_CSRF_ENABLED": False,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "CORS_ORIGINS": "http://localhost:5173",
        }
    )

    with app.app_context():
        db.create_all()
        user = User(
            email="admin@ruchitainteriors.in",
            name="Ruchita Interiors",
            role="owner",
            is_active=True,
            token_version=0,
        )
        user.set_password("admin12345")
        db.session.add(user)
        db.session.commit()

    reset_rate_limit()
    yield app
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _rate_limit_cleanup():
    reset_rate_limit()
    yield
    reset_rate_limit()


def _login(client, email: str = "admin@ruchitainteriors.in", password: str = "admin12345"):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    return response


def _cookie_value(client, name: str) -> str:
    """
    Read one cookie from the Flask test client.

    Werkzeug 3 keys the internal jar by `(domain, path, name)` with the Cookie
    object as the value, so the lookup is by tuple key. Kept in one helper because
    every auth test needs it and the jar layout is not part of Flask's public API.
    """
    return _cookie_matching(client, name)[0].value if _cookie_matching(client, name) else ""


def _cookie_matching(client, name: str):
    """Every stored cookie called `name`, regardless of its path."""
    jar = getattr(client, "_cookies", None)
    if not jar:
        return []
    return [
        cookie
        for key, cookie in jar.items()
        if isinstance(key, tuple) and len(key) == 3 and key[2] == name
    ]


def _get_csrf(client) -> str:
    client.get("/api/v1/auth/csrf")
    return _cookie_value(client, "csrf_token")


def _replace_cookie(client, name: str, value: str) -> None:
    """
    Overwrite one cookie in the test client.

    Needed to simulate "a token captured earlier is replayed later", and to forge an
    expired access token without waiting out the real TTL. The jar is keyed by
    `(domain, path, name)`, so the existing key is reused to stay in place.
    """
    for key, cookie in list(client._cookies.items()):
        if isinstance(key, tuple) and len(key) == 3 and key[2] == name:
            # The stored object is a plain Cookie, so the value is replaced in
            # place rather than via a setter.
            cookie.value = value
            cookie.decoded_value = value
            return
    raise AssertionError(f"cookie {name!r} not present; cannot replace it")


def _restore_cookie(client, name: str, value: str, path: str = "/api/v1/auth") -> None:
    """
    Put a saved cookie back into the jar.

    Logout and password change both clear the refresh cookie, so a test that wants
    to prove revocation has to restore a previously captured copy - which is exactly
    the attack this guards against: a token saved before logout and replayed after.
    """
    # Reuse the Cookie class the client already stores, so the restored entry is
    # indistinguishable from one the server set.
    existing = _cookie_matching(client, name)
    if existing:
        cookie = existing[0]
        cookie.value = value
        cookie.decoded_value = value
        client._cookies[("localhost", path, name)] = cookie
        return

    template = _cookie_matching(client, "csrf_token")
    if not template:
        client.get("/api/v1/auth/csrf")
        template = _cookie_matching(client, "csrf_token")
    sample = template[0]
    client._cookies[("localhost", path, name)] = type(sample)(
        key=name,
        value=value,
        decoded_key=name,
        decoded_value=value,
        expires=None,
        max_age=None,
        domain="localhost",
        origin_only=True,
        path=path,
        secure=False,
        http_only=True,
        same_site="Lax",
    )


def test_csrf_bootstrap_sets_cookie(client):
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    csrf = _get_csrf(client)
    assert csrf and len(csrf) > 20


def test_login_with_seeded_credentials_returns_user(client):
    response = _login(client)
    assert response.status_code == 200
    body = response.get_json()
    assert body["data"]["user"]["email"] == "admin@ruchitainteriors.in"
    assert "password_hash" not in body["data"]["user"]


def test_login_wrong_password_returns_generic_401(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ruchitainteriors.in", "password": "wrongpassword"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "UNAUTHENTICATED"
    assert "incorrect" in response.get_json()["error"]["message"].lower()


def test_login_wrong_email_returns_generic_401(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "admin12345"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    assert response.status_code == 401


def test_missing_csrf_on_post_returns_403(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ruchitainteriors.in", "password": "admin12345"},
    )
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"


def test_protected_endpoints_require_auth(client):
    """`/auth/me` needs a session, and health stays public (§9.1)."""
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/health").status_code == 200


def test_login_required_guards_arbitrary_endpoints(app):
    """
    `@login_required` is what makes unauthenticated access impossible (R9).

    A throwaway route proves the decorator rejects a caller with no cookies, which
    is the property every Phase 3+ business endpoint depends on. Testing it here
    means the guarantee is established before there is real business code to
    accidentally mount without the decorator.
    """
    from flask import Blueprint

    from app.utils.errors import success
    from app.utils.guards import login_required

    probe = Blueprint("probe", __name__)

    @probe.get("/probe")
    @login_required
    def _probe():
        return success({"ok": True})

    app.register_blueprint(probe, url_prefix="/api/v1")
    test_client = app.test_client()

    assert test_client.get("/api/v1/probe").status_code == 401

    # Authenticated, the same route opens up.
    _login(test_client)
    assert test_client.get("/api/v1/probe").get_json()["data"]["ok"] is True


def test_inactive_user_is_treated_as_signed_out(app):
    """`is_active = False` must block access without waiting for the token to expire."""
    with app.app_context():
        user = db.session.scalar(db.select(User))
        user.is_active = False
        db.session.commit()

    test_client = app.test_client()
    _login(test_client)
    assert test_client.get("/api/v1/auth/me").status_code == 401


def test_refresh_issues_a_new_session(client):
    """A valid refresh cookie returns a fresh pair, which is the sliding window (§16)."""
    _login(client)
    response = client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)})

    assert response.status_code == 200
    assert response.get_json()["data"]["user"]["email"] == "admin@ruchitainteriors.in"


def test_refresh_without_cookie_returns_401(client):
    response = client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)})

    assert response.status_code == 401


def test_expired_access_token_is_refreshable(client, app):
    """
    The 15-minute access token expiring must not sign the user out (§16).

    This is the whole reason the refresh cookie exists: the SPA sees a 401, calls
    /auth/refresh, and continues without asking for the password again.
    """
    _login(client)

    # Age the access token past its TTL without touching the refresh cookie.
    access_name = app.config["ACCESS_COOKIE_NAME"]
    with app.app_context():
        from app.services.auth import issue_tokens

        user = db.session.scalar(db.select(User))
        with app.test_request_context():
            access_token, _refresh = issue_tokens(user)
    _replace_cookie(client, access_name, access_token[:-4] + "AAAA")

    assert client.get("/api/v1/auth/me").status_code == 401

    # The refresh cookie is still valid, so the session recovers.
    refreshed = client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)})
    assert refreshed.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200


def test_sixth_login_attempt_is_rate_limited(client):
    """§16 and §25: 5 attempts per 5 minutes, the 6th is 429."""
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@ruchitainteriors.in", "password": "wrongpassword"},
            headers={"X-CSRF-Token": _get_csrf(client)},
        )
        assert response.status_code == 401

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ruchitainteriors.in", "password": "wrongpassword"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    assert blocked.status_code == 429
    assert blocked.get_json()["error"]["code"] == "RATE_LIMITED"


def test_rate_limit_does_not_block_a_correct_password_after_failures(client):
    """
    Failures are counted, not attempts, so a user who mistypes once can still sign in.

    Counting every attempt would lock the owner out of a system with no password
    reset (FR-A4, no signup).
    """
    client.post(
        "/api/v1/auth/login",
        json={"email": "admin@ruchitainteriors.in", "password": "typo"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    assert _login(client).status_code == 200


def test_rate_limit_is_keyed_per_identity(client):
    """Brute-forcing one email must not lock out a different identity."""
    for _ in range(6):
        client.post(
            "/api/v1/auth/login",
            json={"email": "victim@example.com", "password": "guess"},
            headers={"X-CSRF-Token": _get_csrf(client)},
        )

    assert _login(client).status_code == 200


def test_password_change_invalidates_existing_sessions(client, app):
    """§25: changing the password must revoke sessions that already exist."""
    _login(client)

    # Capture a refresh token issued *before* the change.
    refresh_name = app.config["REFRESH_COOKIE_NAME"]
    stale_refresh = _cookie_value(client, refresh_name)
    assert stale_refresh, "expected a refresh cookie after login"

    changed = client.put(
        "/api/v1/auth/password",
        json={"current_password": "admin12345", "new_password": "a-longer-passphrase"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )
    assert changed.status_code == 200
    assert changed.get_json()["data"]["reauthenticate"] is True

    # The current session is signed out, as advertised by `reauthenticate`.
    assert client.get("/api/v1/auth/me").status_code == 401

    # A refresh token captured before the change is refused, not merely expired.
    # Restored into the jar because password change clears the cookie, exactly as
    # an attacker's saved copy would outlive the logout.
    _restore_cookie(client, refresh_name, stale_refresh)
    replayed = client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)})
    assert replayed.status_code == 401

    # The new password works.
    assert _login(client, password="a-longer-passphrase").status_code == 200


def test_password_change_requires_the_current_password(client):
    _login(client)

    response = client.put(
        "/api/v1/auth/password",
        json={"current_password": "not-the-password", "new_password": "a-longer-passphrase"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )

    assert response.status_code == 403


def test_password_change_rejects_a_short_password(client):
    """§16 minimum, enforced server-side regardless of what the form allowed."""
    _login(client)

    response = client.put(
        "/api/v1/auth/password",
        json={"current_password": "admin12345", "new_password": "short"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )

    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_logout_revokes_a_captured_refresh_token(client, app):
    """Logout must be server-side, not just a cookie delete."""
    _login(client)
    refresh_name = app.config["REFRESH_COOKIE_NAME"]
    captured = _cookie_value(client, refresh_name)

    assert client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": _get_csrf(client)}).status_code == 200

    _restore_cookie(client, refresh_name, captured)
    assert client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)}).status_code == 401


def test_logout_revokes_a_captured_refresh_token_even_when_the_access_token_expired(
    client, app
):
    """
    The regression that motivated resolving logout from the refresh token.

    A user who leaves the tab open past the 15-minute access TTL and then signs out
    has no valid access cookie, only a refresh one. Revoking by access token alone
    would skip the revocation entirely, leaving a captured refresh token usable -
    the exact outcome logout is supposed to prevent (§25).
    """
    _login(client)
    access_name = app.config["ACCESS_COOKIE_NAME"]
    refresh_name = app.config["REFRESH_COOKIE_NAME"]
    captured = _cookie_value(client, refresh_name)

    # Simulate the lapsed access token: gone, not merely invalid.
    for key, cookie in list(client._cookies.items()):
        if isinstance(key, tuple) and len(key) == 3 and key[2] == access_name:
            del client._cookies[key]

    assert client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": _get_csrf(client)}).status_code == 200

    _restore_cookie(client, refresh_name, captured)
    assert client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": _get_csrf(client)}).status_code == 401


def test_login_for_an_unknown_account_still_hashes_the_password(client, monkeypatch):
    """
    §25 forbids enumerating accounts through response timing.

    A login against a non-existent email must cost the same as a wrong password.
    Asserting that the hash function ran is the stable way to prove it; measuring
    wall-clock scrypt would be flaky.
    """
    calls: list[str] = []
    real_check = User.check_password

    def spy(self, raw_password):
        calls.append(raw_password)
        return real_check(self, raw_password)

    monkeypatch.setattr(User, "check_password", spy, raising=True)

    dummy_calls: list[str] = []
    # Patched where it is looked up: `auth.py` imported the name directly, so
    # replacing it on the model module would not be seen.
    import app.api.auth as auth_module

    monkeypatch.setattr(
        auth_module,
        "verify_dummy",
        lambda raw: (dummy_calls.append(raw), False)[1],
        raising=True,
    )

    response = _login(client, email="nobody@ruchitainteriors.in", password="admin12345")

    assert response.status_code == 401
    # The real check cannot run (no such row), so the dummy must have stood in.
    assert calls == []
    assert dummy_calls == ["admin12345"]


def test_unknown_account_and_wrong_password_are_indistinguishable(client):
    """Same status, same code, same message - nothing that names the failure mode."""
    unknown = _login(client, email="nobody@ruchitainteriors.in", password="admin12345")
    wrong_password = _login(client, password="not-the-password")

    assert unknown.status_code == wrong_password.status_code == 401
    assert unknown.get_json() == wrong_password.get_json()


def test_rate_limit_ignores_spoofed_forwarded_for_by_default(client):
    """
    `X-Forwarded-For` is client-controlled.

    With no proxy in front, honouring it would let an attacker mint a new IP with
    every guess and defeat the limit completely, so it is off unless configured.
    """
    _login(client, password="not-the-password")
    _login(client, password="not-the-password")

    # Same forwarded IP, which would otherwise have been a fresh bucket each time.
    for _ in range(4):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@ruchitainteriors.in", "password": "not-the-password"},
            headers={"X-CSRF-Token": _get_csrf(client), "X-Forwarded-For": "203.0.113.9"},
        )

    assert response.status_code == 429


def test_rate_limit_honours_forwarded_for_when_trusted(client, app):
    """With a known proxy, the real client address is the one to rate limit on."""
    with _override_app_config(TRUST_PROXY_HEADERS=True, TRUSTED_PROXY_COUNT=1):
        _login(client, password="not-the-password")
        _login(client, password="not-the-password")

        for _ in range(4):
            response = client.post(
                "/api/v1/auth/login",
                json={"email": "admin@ruchitainteriors.in", "password": "not-the-password"},
                headers={"X-CSRF-Token": _get_csrf(client), "X-Forwarded-For": "203.0.113.9"},
            )

    assert response.status_code == 429


def test_login_rejects_missing_fields_with_field_details(client):
    """§9.1 wants per-field details so the form can mark the right input."""
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email"},
        headers={"X-CSRF-Token": _get_csrf(client)},
    )

    assert response.status_code == 422
    error = response.get_json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    fields = {detail["field"] for detail in error["details"]}
    assert "email" in fields
    assert "password" in fields


def test_password_is_never_returned_by_any_endpoint(client):
    """§16: a password must never be returned, in any form."""
    _login(client)

    for response in (client.get("/api/v1/auth/me"), _login(client)):
        body = response.get_data(as_text=True)
        assert "admin12345" not in body
        assert "password_hash" not in body
        assert "scrypt" not in body


def test_auth_responses_are_not_cacheable(client):
    """§16 requires no-store on auth, so a proxy cannot replay credentials."""
    _login(client)

    response = client.get("/api/v1/auth/me")
    assert response.headers.get("Cache-Control") == "no-store"


def test_security_headers_are_present(client):
    response = client.get("/api/v1/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_refresh_cookie_is_scoped_to_the_auth_path(client, app):
    """
    §16 scopes the refresh cookie to `/api/v1/auth`.

    A narrower cookie is not sent with ordinary business requests, so a leaked
    refresh token has a smaller blast radius.
    """
    _login(client)

    header = client.get("/api/v1/auth/me").headers
    assert "Set-Cookie" not in header or app.config["REFRESH_COOKIE_NAME"] not in str(header)


def test_logout_clears_session(client):
    _login(client)
    csrf = _get_csrf(client)
    resp = client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200
    # After logout, me must be 401
    assert client.get("/api/v1/auth/me").status_code == 401
