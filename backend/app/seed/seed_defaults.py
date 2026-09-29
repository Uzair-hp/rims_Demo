"""
Ruchita Interiors — default data seeder (placeholder).

`flask seed-defaults` will (Phase 3) insert the singleton settings row, starter
terms and the catalogue lists. That data model does not exist yet, so this
command is a no-op stub: it keeps the CLI registration in the app factory valid
and, like `seed-admin`, refuses to run before the schema exists (§8.1 — Alembic
owns DDL).

When the Phase 3 models land, replace the body below with the real inserts.
"""

from __future__ import annotations

import click
from flask.cli import with_appcontext
from sqlalchemy import inspect

from app.extensions.database import db


@click.command("seed-defaults")
@with_appcontext
def seed_defaults():
    """Insert default settings, terms and catalogue lists (not yet implemented)."""
    inspector = inspect(db.engine)
    if not inspector.get_table_names():
        raise click.ClickException(
            "The database has no schema yet. Run `flask db upgrade` first."
        )

    click.echo("seed-defaults: nothing to seed yet — default data lands in a later phase.")
