"""
Ruchita Interiors — seed CLI commands.

`flask seed-admin` creates the single owner account from environment variables
(FR-A4). There is no signup and no password reset, so this is the only way the
account comes into existence.

Run `migrations` first: the command refuses to run against a database with no
schema, because silently creating the table here would bypass Alembic (§8.1).
"""

from __future__ import annotations

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import inspect

from app.extensions.database import db
from app.models import User


def validate_password_strength(password: str) -> str | None:
    """
    Enforce §16's minimum length. Returns an error message, or None if acceptable.
    """
    minimum = current_app.config["PASSWORD_MIN_LENGTH"]
    if not password:
        return f"ADMIN_PASSWORD is not set. Set it in backend/.env (min {minimum} characters)."
    if len(password) < minimum:
        return f"ADMIN_PASSWORD must be at least {minimum} characters (got {len(password)})."
    return None


@click.command("seed-admin")
@with_appcontext
def seed_admin():
    """Create the owner account from ADMIN_EMAIL / ADMIN_PASSWORD."""
    email = (current_app.config["ADMIN_EMAIL"] or "").strip().lower()
    password = current_app.config["ADMIN_PASSWORD"] or ""
    name = (current_app.config["ADMIN_NAME"] or "").strip() or "Ruchita Interiors"

    if not email:
        raise click.ClickException("ADMIN_EMAIL is not set. Add it to backend/.env and retry.")

    problem = validate_password_strength(password)
    if problem:
        raise click.ClickException(problem)

    inspector = inspect(db.engine)
    if "users" not in inspector.get_table_names():
        raise click.ClickException(
            "The `users` table does not exist yet. Run `flask db upgrade` first."
        )

    existing = db.session.scalar(db.select(User).where(User.email == email))
    if existing is not None:
        # Updating the password here would be a silent credential reset; make the
        # operator say so explicitly.
        if click.confirm(f"{email} already exists. Reset its password?", default=False):
            existing.set_password(password)
            existing.name = name
            existing.revoke_sessions()
            db.session.commit()
            click.echo(f"Password reset and existing sessions revoked for {email}.")
        else:
            click.echo("Nothing changed.")
        return

    user = User(email=email, name=name, role="owner", is_active=True, token_version=0)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    click.echo(f"Created owner account {email} (id={user.id}).")
