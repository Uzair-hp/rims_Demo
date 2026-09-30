"""
Ruchita Interiors — first-boot database preparation (deployment only).

Alembic owns every DDL change and `create_all()` is deliberately never called, so
an application started against an empty database cannot serve a single request.
Locally that is handled by running `flask db upgrade` and `flask seed-admin`
yourself. On Render's Free web service there is no way to: Free instances have no
shell access and no pre-deploy command, and their filesystem is ephemeral, so every
cold start is a first boot.

`ensure_database_ready` closes that gap at start-up. It is the deployment
equivalent of the two commands in the Quick Start, and it is deliberately narrow:

- **It is not a signup path.** Nothing over HTTP reaches it, and it only ever
  creates the single `role="owner"` account from environment variables that
  Render holds as secrets. There is no default password, no generated credential
  and no route that can add a second user.
- **It is idempotent.** Migrations are skipped when the schema is present, the
  default seed is skipped when its rows exist, and the owner is skipped when any
  user exists. Restarting is safe and cheap.
- **It refuses rather than guesses.** With no `ADMIN_PASSWORD`, or one that fails
  the §16 length policy, it logs an error and creates no account. A visible
  misconfiguration beats a weak credential, and the app still boots and serves, so
  the error is in the logs instead of in a crash loop.

Ordering matters: Alembic's runner reads `current_app.extensions['migrate']`, so
this must be called after `Migrate(app, db)` in the application factory. It is
called with an application context active, which `validate_password_strength`
requires.
"""

from __future__ import annotations

from flask import Flask, current_app
from sqlalchemy import inspect, select

from app.extensions.database import db
from app.models import User

# The schema marker. `users` is the first table the first migration creates, so its
# absence means the database has never been migrated - and checking for one table
# is cheaper and simpler than reading `alembic_version`.
_SCHEMA_MARKER_TABLE = "users"


def ensure_database_ready(app: Flask) -> None:
    """
    Migrate, seed defaults and create the owner account, once, if asked to.

    A no-op unless `AUTO_SEED_ADMIN` is set, which keeps the local workflow and the
    test suite exactly as they were.
    """
    if not app.config.get("AUTO_SEED_ADMIN"):
        return

    with app.app_context():
        _migrate_if_needed()
        _seed_defaults()
        _create_owner_account()


def _migrate_if_needed() -> None:
    """
    Bring the schema to head, but only when it is missing.

    The import is local because Alembic is only needed on a deployment boot, which
    keeps an install without a migrations directory starting cleanly - it just
    skips this step.
    """
    from flask_migrate import upgrade

    if _schema_is_present():
        _log("Schema already present; skipping migrations.")
        return

    _log("No schema found. Running migrations to head.")
    # `directory` is resolved relative to the working directory, which is why
    # Render's root directory is `backend` and not the repository root.
    upgrade()


def _schema_is_present() -> bool:
    return _SCHEMA_MARKER_TABLE in inspect(db.engine).get_table_names()


def _seed_defaults() -> None:
    """
    Insert the settings row, starter terms and catalogue lists.

    Delegates to the CLI command's own function rather than repeating the rules, so
    the documented `flask seed-defaults` and this path cannot drift. The command is
    already idempotent, which the existing seeding tests pin.
    """
    import click

    from app.seed.seed_defaults import seed_defaults

    # The command is wrapped in `@with_appcontext`, which resolves the app through
    # the *active click context*. There is no CLI invocation here, so a context is
    # pushed explicitly; the wrapper then finds the app context we already have and
    # does not try to build a second one. Calling the command's own body this way -
    # rather than copying its rules - is what keeps this path and `flask
    # seed-defaults` from drifting apart.
    with click.Context(seed_defaults):
        seed_defaults.callback()


def _create_owner_account() -> None:
    """
    Create the owner account from the environment, if there is not one already.

    The "any user exists" check is the safety property: this can never add a user to
    a database that already has one, however many times the process restarts.
    """
    if _any_user_exists():
        return

    email = (current_app.config.get("ADMIN_EMAIL") or "").strip().lower()
    password = current_app.config.get("ADMIN_PASSWORD") or ""
    name = (current_app.config.get("ADMIN_NAME") or "").strip() or "Ruchita Interiors"

    if not email:
        _error(
            "AUTO_SEED_ADMIN is on but ADMIN_EMAIL is not set, so no owner account "
            "was created. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart."
        )
        return

    # The §16 policy, reused rather than restated: a rejected password must fail the
    # same way here as it does in the CLI.
    from app.seed.seed_admin import validate_password_strength

    problem = validate_password_strength(password)
    if problem:
        _error(f"No owner account was created. {problem}")
        return

    user = User(email=email, name=name, role="owner", is_active=True, token_version=0)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    # The email only. The password is never logged, in any form.
    _log(f"Created owner account {email} (id={user.id}).")


def _any_user_exists() -> bool:
    return db.session.scalar(select(User.id).limit(1)) is not None


def _log(message: str) -> None:
    current_app.logger.info("[bootstrap] %s", message)


def _error(message: str) -> None:
    current_app.logger.error("[bootstrap] %s", message)
