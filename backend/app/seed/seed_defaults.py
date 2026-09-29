"""
Ruchita Interiors — default seeding CLI (§15, §24 Phase 3).

`flask seed-defaults` inserts the `company_settings` row, the starter terms and
the catalogue lists. The schema must exist first (Alembic owns DDL, §8.1), so
the command refuses to run against an un-migrated database — the same rule
`seed-admin` applies.

Everything here is idempotent: run it again and nothing changes, which is what
makes it safe to include in the README runbook.
"""

from __future__ import annotations

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import inspect, select

from app.extensions.database import db
from app.models import CompanySettings, TermsConditions

STARTER_TERMS = [
    {
        "scope": "both",
        "title": "Standard terms",
        "body": (
            "1. 50% advance is required to begin work.\n"
            "2. Prices are valid for the stated validity period.\n"
            "3. Delivery timelines start from advance receipt and material confirmation.\n"
            "4. Any design change after approval may affect cost and schedule.\n"
            "5. Warranty covers workmanship as agreed in the work order."
        ),
        "is_default": True,
    },
    {
        "scope": "invoice",
        "title": "Payment terms",
        "body": (
            "1. Payment is due within 15 days of the invoice date.\n"
            "2. Cheques are payable to Ruchita Interiors.\n"
            "3. Interest at 1.5% per month applies to overdue amounts."
        ),
        "is_default": False,
    },
]


@click.command("seed-defaults")
@with_appcontext
def seed_defaults():
    """Create the settings row, starter terms and catalogue defaults."""
    inspector = inspect(db.engine)
    missing = [t for t in ("company_settings", "terms_conditions") if t not in inspector.get_table_names()]
    if missing:
        raise click.ClickException(
            "Tables missing ({}). Run `flask db upgrade` first.".format(", ".join(missing))
        )

    # The row itself: get_row() inserts with §8.3 defaults when absent.
    settings_row = CompanySettings.get_row()

    if not settings_row.item_categories:
        settings_row.item_categories = list(CompanySettings.DEFAULT_ITEM_CATEGORIES)
    if not settings_row.units:
        settings_row.units = list(CompanySettings.DEFAULT_UNITS)
    db.session.commit()

    # Starter terms: only when the table is empty, so a user's own edits are
    # never clobbered by a re-run.
    existing_terms = db.session.scalar(select(TermsConditions).limit(1))
    created_terms = 0
    if existing_terms is None:
        for entry in STARTER_TERMS:
            db.session.add(TermsConditions(**entry))
            created_terms += 1
        db.session.commit()

    click.echo(
        "Seed complete: settings row id={0}, {1} starter terms present.".format(
            settings_row.id, created_terms or "starter"
        )
    )
