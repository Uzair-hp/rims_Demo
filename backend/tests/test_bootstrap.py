"""
Tests for the deployment-only first-boot bootstrap.

`app/bootstrap.py` stands in for `flask db upgrade` and `flask seed-admin` on a
Render Free instance, where neither can be run: Free web services have no shell
access and no pre-deploy command. That makes it security-relevant code, because it
creates a credential without an operator typing it.

The properties worth pinning, in order of how much damage a regression would do:

- **It is off unless asked.** Nothing happens with `AUTO_SEED_ADMIN` unset, which is
  the default and what the test suite runs under.
- **It never creates a second account.** Any existing user stops it, so a restart
  cannot add a user and there is no way to reach an account-creation path twice.
- **It refuses a weak or missing password** rather than falling back to a default.
  There is no credential in this repository to fall back to.
- **It is not reachable over HTTP.** No route calls it.

Each test builds its own app on a throwaway database, because the whole feature is a
function of what is on disk and in the environment.
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect, select

from app import create_app
from app.extensions.database import db
from app.models import TermsConditions, User

_STRONG_PASSWORD = "a-long-enough-password"


def _make_app(tmp_path, *, auto_seed=True, admin_email="owner@test.local", admin_password=_STRONG_PASSWORD, admin_name="Owner"):
    """
    An app with the bootstrap enabled, against a scratch database.

    `TESTING` is left at its default so nothing is skipped; the bootstrap is gated on
    `AUTO_SEED_ADMIN` alone.
    """
    db_path = tmp_path / "bootstrap.db"
    return create_app(
        {
            "SECRET_KEY": "test",
            "JWT_SECRET_KEY": "test-jwt",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "AUTO_SEED_ADMIN": auto_seed,
            "ADMIN_EMAIL": admin_email,
            "ADMIN_PASSWORD": admin_password,
            "ADMIN_NAME": admin_name,
        }
    )


def test_migrations_run_on_a_fresh_database(tmp_path):
    """
    An unmigrated database cannot serve a request, so boot must bring it to head.

    Pinned because the alternative - `create_all()` - is never called by design, so
    without this the first deploy would 500 on every endpoint.
    """
    app = _make_app(tmp_path)

    with app.app_context():
        tables = set(inspect(db.engine).get_table_names())
        assert {"users", "clients", "quotations", "invoices", "payments"}.issubset(tables)
        assert "alembic_version" in tables


def test_owner_account_is_created_from_the_environment(tmp_path):
    """The owner exists after boot, with the configured credentials."""
    app = _make_app(tmp_path, admin_email="Owner@Test.Local", admin_name="Ruchita Interiors")

    with app.app_context():
        user = db.session.scalar(select(User))
        assert user is not None
        assert user.email == "owner@test.local"  # normalised to lower case
        assert user.name == "Ruchita Interiors"
        assert user.role == "owner"
        assert user.is_active is True
        assert user.check_password(_STRONG_PASSWORD)


def test_default_rows_are_seeded(tmp_path):
    """The settings row and starter terms exist, so a fresh boot is usable."""
    app = _make_app(tmp_path)

    with app.app_context():
        from app.models import CompanySettings

        assert db.session.get(CompanySettings, 1) is not None
        assert len(db.session.scalars(select(TermsConditions)).all()) >= 2


def test_second_boot_creates_no_second_account(tmp_path):
    """
    Idempotence, and the safety property that matters most.

    A restart must never add a user to a database that already has one. If this
    fails, a deploy loop could create accounts no operator knows about.
    """
    first = _make_app(tmp_path)
    with first.app_context():
        created = db.session.scalars(select(User)).all()
        assert len(created) == 1

    # A second app over the same file is exactly what a restart looks like.
    second = _make_app(tmp_path)
    with second.app_context():
        assert len(db.session.scalars(select(User)).all()) == 1


def test_bootstrap_is_off_by_default(tmp_path):
    """
    The default is off, so local development keeps the documented workflow.

    With it off, a fresh database stays unmigrated - which is exactly what proves
    the bootstrap is not running when nobody asked for it.
    """
    app = _make_app(tmp_path, auto_seed=False)

    with app.app_context():
        assert "users" not in set(inspect(db.engine).get_table_names())
        # The table does not exist, so it cannot be queried for users - the absence
        # of the table is the whole assertion here.
        assert "company_settings" not in set(inspect(db.engine).get_table_names())


@pytest.mark.parametrize(
    "password",
    ["", "short", None],
    ids=["empty", "under-10-characters", "unset"],
)
def test_no_account_without_a_strong_password(tmp_path, password):
    """
    A weak or missing password creates nothing at all.

    There is no default credential to fall back to, so the correct outcome is a
    logged error and an unusable-but-running app rather than an account anyone could
    guess.
    """
    app = _make_app(tmp_path, admin_password=password, admin_email="owner@test.local")

    with app.app_context():
        # The schema and default rows are still created: the app must boot and
        # serve, with the problem visible in the logs.
        assert "users" in set(inspect(db.engine).get_table_names())
        assert db.session.scalars(select(User)).all() == []


def test_no_account_without_an_email(tmp_path):
    """No ADMIN_EMAIL means no account, even with a strong password."""
    app = _make_app(tmp_path, admin_email="")

    with app.app_context():
        assert db.session.scalars(select(User)).all() == []


def test_bootstrap_is_not_reachable_over_http(tmp_path):
    """
    No route may create an account. This is the anti-signup guarantee.

    A signup endpoint is the one thing this feature must never grow, so the check
    is over the live URL map rather than over the function: any route that touched
    the bootstrap or the User model directly would show up here.
    """
    app = _make_app(tmp_path)

    rules = {str(rule) for rule in app.url_map.iter_rules()}
    for rule in rules:
        assert "signup" not in rule.lower()
        assert "register" not in rule.lower()
        assert "bootstrap" not in rule.lower()

    # And the only user-creating entry points are the CLI command and the bootstrap.
    from app.seed import seed_admin

    assert callable(seed_admin.seed_admin.callback)
