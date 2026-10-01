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
        # Phase 9A (SERVICES_PLAN §4): the catalog table exists, the item columns
        # arrived on both item tables, and the partial unique index came with them.
        assert "services" in inspector.get_table_names()
        for table in ("quotation_items", "invoice_items"):
            columns = {col["name"] for col in inspector.get_columns(table)}
            assert {"service_id", "catalog_rate_paise"}.issubset(columns)
        indexes = {ix["name"] for ix in inspector.get_indexes("services")}
        assert "ix_services_archived_category_name" in indexes
        # The partial unique index on lower(name) is expression-based, which
        # SQLite's inspector cannot reflect ("unsupported reflection"), so its
        # existence is read from the DDL directly.
        service_ddl = db.session.execute(
            db.text("SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_services_active_name'")
        ).scalar_one_or_none()
        assert service_ddl is not None
        assert "lower(name)" in (service_ddl or "")
        assert "archived_at IS NULL" in (service_ddl or "")

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
        # The catalog must come back too — the downgrade is a full undo, not a
        # one-way street that leaves Phase 9A behind.
        assert "services" in inspector.get_table_names()
        assert "service_id" in {col["name"] for col in inspector.get_columns("quotation_items")}


def _ddl(app, kind: str, name: str) -> str | None:
    with app.app_context():
        return db.session.execute(
            db.text("SELECT sql FROM sqlite_master WHERE type=:t AND name=:n"),
            {"t": kind, "n": name},
        ).scalar_one_or_none()


def test_migrations_create_every_named_check_constraint(tmp_path):
    """The model and the migration history must agree on every CHECK.

    `tests/conftest.py` builds its schema with `db.create_all()`, which reads the
    *models*. So a CHECK declared on a model but never written by a migration is
    present in every test database and absent from every real one - invisible to
    the whole suite. This test runs the real Alembic runner and reads the
    resulting DDL, which is the only place that drift can be seen.
    """
    from flask_migrate import upgrade

    app = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'checks.db').as_posix()}"}
    )
    with app.app_context():
        upgrade()

    # Every CHECK the models declare must be in the database the migrations built.
    from app import models as models_module

    for table in models_module.db.metadata.sorted_tables:
        for constraint in table.constraints:
            if constraint.__class__.__name__ != "CheckConstraint":
                continue
            assert constraint.name, f"{table.name} has an unnamed CHECK: {constraint.sqltext}"
            ddl = _ddl(app, "table", table.name)
            assert ddl is not None, table.name
            assert constraint.name in ddl, f"{constraint.name} missing from {table.name} after upgrade()"

    # The two the audit found missing from the history, called out explicitly so
    # a regression here names itself.
    settings_ddl = _ddl(app, "table", "company_settings")
    assert "ck_company_settings_default_gst_bp" in settings_ddl
    assert "ck_company_settings_default_validity_days" in settings_ddl


def test_company_settings_checks_are_enforced_by_the_database(tmp_path):
    """The two CHECKs are real constraints, not decoration on the model."""
    from flask_migrate import upgrade

    app = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{(tmp_path / 'enforce.db').as_posix()}"}
    )
    with app.app_context():
        upgrade()
        db.session.execute(
            db.text("INSERT INTO company_settings (id, company_name, default_gst_bp, "
                    "default_validity_days, created_at, updated_at) "
                    "VALUES (1, 'Ruchita Interiors', 1800, 15, '2026-01-01', '2026-01-01')")
        )
        db.session.commit()

        import sqlalchemy as sa

        for column, bad in (("default_gst_bp", 2801), ("default_validity_days", 366)):
            with pytest.raises(sa.exc.IntegrityError):
                db.session.execute(
                    db.text(f"UPDATE company_settings SET {column} = :v WHERE id = 1"), {"v": bad}
                )
            db.session.rollback()


def test_invoice_payment_method_downgrade_survives_data(tmp_path):
    """`b8d5f0e2c7a1.downgrade()` must work on a database that has rows.

    It used to call `batch_alter_table`, which recreates `invoices` via
    `DROP TABLE invoices`. `invoice_items` and `payments` both hold foreign keys
    into it and `extensions/database.py` sets `PRAGMA foreign_keys=ON`, so on a
    database with data that raises:

        sqlite3.IntegrityError: FOREIGN KEY constraint failure

    The existing cycle test downgraded an *empty* database, so it never saw it.
    """
    from flask_migrate import downgrade, upgrade

    db_path = tmp_path / "withdata.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        upgrade()
        # A user to own the quotation, a client, an approved quotation, an invoice
        # with a line item and a payment against it - so every table that FKs
        # into `invoices` has a live row.
        db.session.execute(
            db.text("INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) "
                    "VALUES (1, 'o@example.com', 'Owner', 'x', 'owner', '2026-01-01', '2026-01-01')")
        )
        db.session.execute(
            db.text("INSERT INTO clients (id, name, phone, created_at, updated_at) "
                    "VALUES (1, 'Acme', '9999999999', '2026-01-01', '2026-01-01')")
        )
        db.session.execute(
            db.text("INSERT INTO quotations (id, number, year, client_id, quotation_date, status, "
                    "created_at, updated_at) VALUES "
                    "(1, 'QTN-2026-0001', 2026, 1, '2026-01-01', 'converted', '2026-01-01', '2026-01-01')")
        )
        db.session.execute(
            db.text("INSERT INTO invoices (id, number, year, quotation_id, client_id, status, "
                    "grand_total_paise, payment_method, created_at, updated_at) VALUES "
                    "(1, 'INV-2026-0001', 2026, 1, 1, 'draft', 100000, 'upi', '2026-01-01', '2026-01-01')")
        )
        db.session.execute(
            db.text("INSERT INTO invoice_items (id, invoice_id, position, name, qty_milli, rate_paise) "
                    "VALUES (1, 1, 0, 'Kitchen', 1000, 100000)")
        )
        db.session.execute(
            db.text("INSERT INTO payments (id, invoice_id, amount_paise, paid_on, method, "
                    "created_at) VALUES (1, 1, 50000, '2026-01-02', 'upi', '2026-01-02')")
        )
        db.session.commit()

        # Down to b8d5f0e2c7a1's parent drops the payment_method column. With
        # batch mode and data present, this is where the FK failure fires.
        downgrade(revision="a7c4e19b2d80")

        inspector = inspect(db.engine)
        assert "payment_method" not in {
            col["name"] for col in inspector.get_columns("invoices")
        }
        # The rows the recreate could have destroyed are still there.
        assert db.session.execute(db.text("SELECT COUNT(*) FROM invoices")).scalar_one() == 1
        assert db.session.execute(db.text("SELECT COUNT(*) FROM invoice_items")).scalar_one() == 1
        assert db.session.execute(db.text("SELECT COUNT(*) FROM payments")).scalar_one() == 1
        assert db.session.execute(db.text("PRAGMA foreign_key_check")).fetchall() == []

        # And the column comes back on the way up, which is what makes the cycle
        # a cycle rather than a one-way trip. Its *value* does not: the downgrade
        # is destructive by design, and the re-added column is nullable, so the
        # row reads back as NULL — "Not Selected", a legal state.
        upgrade()
        inspector = inspect(db.engine)
        assert "payment_method" in {col["name"] for col in inspector.get_columns("invoices")}
        assert (
            db.session.execute(db.text("SELECT payment_method FROM invoices WHERE id = 1")).scalar_one()
            is None
        )
        # The indexes the rebuild had to carry across are back too, or the
        # recreated table would silently be unindexed.
        indexes = {ix["name"] for ix in inspector.get_indexes("invoices")}
        assert "ix_invoices_client_id" in indexes
        assert "ix_invoices_quotation_id" in indexes


def test_invoices_rebuild_rolls_back_when_it_fails_midway(tmp_path):
    """A failure inside the `invoices` recreate must not leave the table gone.

    `c3d7e9f1a2b4` renames `invoices` to `invoices_old` and only *then* creates
    its replacement, so between those two statements there is a point where the
    table does not exist at all. Under autocommit that window is permanent: a
    failure anywhere inside it leaves a database whose `alembic_version` still
    claims the revision while the schema it describes has been dropped.

    That is not theoretical. It is how the development database was lost -
    every application table gone except a leftover temporary one, `alembic_version`
    reading `b1f2a3c4d5e6` anyway, and every page 500ing on "no such table".

    So the rebuild runs inside an explicit transaction, and this test is what
    holds it to that: it deliberately breaks the `CREATE` that follows the
    rename - the exact position the real failure occupied - and then asserts
    the database came back untouched rather than half-applied.
    """
    from flask_migrate import upgrade

    db_path = tmp_path / "rollback.db"
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}"})

    with app.app_context():
        upgrade(revision="b1f2a3c4d5e6")

        db.session.execute(
            db.text("INSERT INTO clients (id, name, phone, created_at, updated_at) "
                    "VALUES (1, 'Acme', '9999999999', '2026-01-01', '2026-01-01')")
        )
        db.session.execute(
            db.text("INSERT INTO invoices (id, number, year, client_id, status, "
                    "grand_total_paise, payment_method, created_at, updated_at) VALUES "
                    "(1, 'INV-2026-0001', 2026, 1, 'draft', 100000, 'upi', "
                    "'2026-01-01', '2026-01-01')")
        )
        db.session.commit()

        ddl_before = db.session.execute(
            db.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'")
        ).scalar_one()
        indexes_before = {ix["name"] for ix in inspect(db.engine).get_indexes("invoices")}

        # Break the CREATE that replaces the rename. `append_table_constraint` is
        # what produces it, so sabotaging that makes statement 4 fail while
        # statement 3 - the rename - has already run.
        import app.utils.ddl as ddl_module

        original = ddl_module.append_table_constraint
        ddl_module.append_table_constraint = (
            lambda ddl, definition: "CREATE TABLE invoices ( this is not sql"
        )
        db.session.rollback()
        try:
            with pytest.raises(Exception):
                upgrade(revision="c3d7e9f1a2b4")
        finally:
            ddl_module.append_table_constraint = original

        db.session.rollback()
        inspector = inspect(db.engine)
        tables = set(inspector.get_table_names())

        # The table is still there, under its own name, byte-for-byte as it was.
        assert "invoices" in tables
        assert "invoices_old" not in tables
        assert not [t for t in tables if t.startswith("_alembic")]
        ddl_after = db.session.execute(
            db.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'")
        ).scalar_one()
        assert ddl_after == ddl_before

        # Data, indexes and referential integrity all survived the failed swap.
        assert db.session.execute(db.text("SELECT COUNT(*) FROM invoices")).scalar_one() == 1
        assert db.session.execute(
            db.text("SELECT payment_method FROM invoices WHERE id = 1")
        ).scalar_one() == "upi"
        assert db.session.execute(db.text("SELECT COUNT(*) FROM clients")).scalar_one() == 1
        assert {ix["name"] for ix in inspector.get_indexes("invoices")} == indexes_before
        assert db.session.execute(db.text("PRAGMA foreign_key_check")).fetchall() == []

        # And the migration did not stamp itself: a half-applied revision that
        # claims success is the other half of the original failure.
        assert db.session.execute(db.text("SELECT version_num FROM alembic_version")).scalar_one() == (
            "b1f2a3c4d5e6"
        )

        # The constraint is therefore still unnamed, i.e. the migration really
        # did not half-succeed - and a retry now succeeds normally.
        assert "ck_invoices_payment_method" not in ddl_after
        upgrade(revision="c3d7e9f1a2b4")
        ddl_final = db.session.execute(
            db.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'")
        ).scalar_one()
        assert "ck_invoices_payment_method" in ddl_final
        assert db.session.execute(db.text("SELECT COUNT(*) FROM invoices")).scalar_one() == 1
