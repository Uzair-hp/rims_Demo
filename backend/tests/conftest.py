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
