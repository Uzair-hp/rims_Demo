"""
Shared fixtures.

Every test gets an isolated app backed by its own temporary SQLite file, so no test
can touch the developer's database and tests cannot leak state into one another.

`app` and `client` are the base pair. Auth tests that need a seeded owner account
build their own app (see `test_auth.py`) because the seeding is specific to that
suite.
"""

from __future__ import annotations

import pytest

from app import create_app
from app.extensions.database import db
from app.services.rate_limit import reset_rate_limit


@pytest.fixture()
def app(tmp_path):
    """
    A fresh app on a throwaway database file.

    A file rather than `:memory:` because Phase 2 enables `PRAGMA foreign_keys=ON`
    and WAL (§8.5); an in-memory database silently ignores the journal mode, and a
    file exercises the same connection settings as production.
    """
    db_path = tmp_path / "ruchita_test.db"
    application = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
        }
    )

    with application.app_context():
        db.create_all()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _reset_login_rate_limit():
    """
    The rate limiter is process-wide (§16 in-memory, single process), so a test that
    exhausts the budget would otherwise block unrelated tests that run afterwards.
    """
    reset_rate_limit()
    yield
    reset_rate_limit()


def _csrf_token(client) -> str:
    """Read the CSRF cookie the test client carries after a request sets it."""
    return next(
        (c.value for k, c in getattr(client, "_cookies", {}).items() if isinstance(k, tuple) and k[2] == "csrf_token"),
        "",
    )


def _csrf(client) -> dict:
    """Drop a fresh CSRF header onto the cookie the `client` fixture holds."""
    client.get("/api/v1/auth/csrf")
    return {"X-CSRF-Token": _csrf_token(client)}


@pytest.fixture()
def authed_client(client):
    """A test client carrying a valid access cookie (login is Phase 2 behaviour)."""
    from app.models import User

    with client.application.app_context():
        user = User(email="owner@test.local", name="Owner", role="owner", is_active=True)
        user.set_password("password-123456")
        db.session.add(user)
        db.session.commit()

    # GET /auth/csrf sets the csrf cookie; read it *after* so it matches the cookie
    # the browser will send on the login POST (double-submit, §16).
    client.get("/api/v1/auth/csrf")
    token = _csrf_token(client) or client.get("/api/v1/auth/csrf").get_json().get("csrf_token", "")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@test.local", "password": "password-123456"},
        headers={"X-CSRF-Token": token},
    )
    assert login.status_code == 200, login.get_data(as_text=True)
    return client
