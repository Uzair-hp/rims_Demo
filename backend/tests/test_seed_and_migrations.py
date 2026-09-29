"""
Phase 3 seeding and migration tests.

Mapped to PLAN §25 Phase 3: starter terms + categories seeded; migration
downgrade/upgrade cycle succeeds. The CLI itself is exercised through Flask's
test runner so the command registration is proven too.
"""

from __future__ import annotations

import pytest
from click.testing import CliRunner
from flask.cli import ScriptInfo
from sqlalchemy import inspect

from app import create_app
from app.extensions.database import db
from app.models import CompanySettings, TermsConditions
from app.seed.seed_defaults import seed_defaults


def test_seed_defaults_creates_settings_terms_and_catalogue(tmp_path):
    db_path = tmp_path / "seed.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        db.create_all()
        # Sanity: the tables the command needs exist (Alembic in production).
        inspector = inspect(db.engine)
        assert "company_settings" in inspector.get_table_names()

    runner = CliRunner()
    result = runner.invoke(app.cli, ["seed-defaults"], obj=ScriptInfo(create_app=lambda: app))
    assert result.exit_code == 0, result.output

    with app.app_context():
        row = db.session.get(CompanySettings, 1)
        assert row is not None
        assert "Living Room" in row.item_categories
        assert len(row.units) >= 5

        terms = db.session.scalars(TermsConditions.__table__.select()).all()
        assert len(terms) >= 2


def test_seed_defaults_is_idempotent(tmp_path):
    db_path = tmp_path / "seed2.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        db.create_all()

    runner = CliRunner()
    first = runner.invoke(app.cli, ["seed-defaults"], obj=ScriptInfo(create_app=lambda: app))
    second = runner.invoke(app.cli, ["seed-defaults"], obj=ScriptInfo(create_app=lambda: app))
    assert first.exit_code == 0 and second.exit_code == 0, (first.output, second.output)

    with app.app_context():
        terms = db.session.scalars(TermsConditions.__table__.select()).all()
        # A second run must not duplicate the starter terms.
        assert len(terms) == 2


def test_seed_defaults_requires_schema(tmp_path):
    """The command refuses to run before migrations (§8.1)."""
    db_path = tmp_path / "empty.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    runner = CliRunner()
    result = runner.invoke(app.cli, ["seed-defaults"], obj=ScriptInfo(create_app=lambda: app))
    assert result.exit_code != 0
    assert "flask db upgrade" in result.output


def test_migration_downgrade_upgrade_cycle(tmp_path):
    """
    §25 Phase 3: `alembic downgrade base` then `upgrade head` succeeds.

    Runs the real Alembic runner against a scratch database rather than mocking,
    because a broken migration is exactly what this criterion exists to catch.
    """
    from flask_migrate import downgrade, upgrade

    db_path = tmp_path / "cycle.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        upgrade()
        inspector = inspect(db.engine)
        expected = {
            "users",
            "clients",
            "quotations",
            "quotation_items",
            "invoices",
            "invoice_items",
            "payments",
            "terms_conditions",
            "numbering_counters",
            "company_settings",
        }
        assert expected.issubset(set(inspector.get_table_names()))
        # Phase 8: the column the new migration adds must be present, or the
        # table-name subset above would still pass with a migration that did
        # nothing.
        assert "payment_qr_path" in {
            col["name"] for col in inspector.get_columns("company_settings")
        }

        downgrade(revision="base")
        inspector = inspect(db.engine)
        assert not expected & set(inspector.get_table_names())

        upgrade()
        inspector = inspect(db.engine)
        assert expected.issubset(set(inspector.get_table_names()))
        # The column must come back on the way up again, or the cycle is lossy.
        assert "payment_qr_path" in {
            col["name"] for col in inspector.get_columns("company_settings")
        }
