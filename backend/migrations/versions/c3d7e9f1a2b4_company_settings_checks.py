"""company settings check constraints

Revision ID: c3d7e9f1a2b4
Revises: b1f2a3c4d5e6
Create Date: 2026-10-01 12:10:00.000000

Closes two model-to-migration drifts found by the end-to-end audit, and the
one unnamed CHECK the test suite was already warning about.

1. `app/models/company_settings.py` has always declared two CHECK constraints:

       default_gst_bp        >= 0 AND <= 2800
       default_validity_days >= 0 AND <= 365

   `4cb5324d6e1e` created both columns with a server default and no CHECK, so a
   real deployment never had them. The constraints were visible only in test
   databases, because `tests/conftest.py` builds its schema with
   `db.create_all()` (reading the models) rather than by running migrations. The
   service layer validates both ranges on write, so this was never exploitable
   through the API - but the point of a CHECK is to be the backstop for the
   write path that *forgot* to validate, and the backstop was not in the
   database where it belongs.

2. `b8d5f0e2c7a1` added `invoices.payment_method` with its CHECK written inline
   in the ADD COLUMN, so SQLite stored it anonymously. SQLAlchemy cannot reflect
   an unnamed constraint, so every batch recreate of `invoices` drops it
   silently - that is the "Unnamed CHECK constraint on reflected table
   'invoices' is being omitted from the table recreate" warning the suite was
   already emitting, i.e. a real constraint quietly disappearing from a
   migrated database.

`company_settings` is a standalone single-row table: no table holds a foreign key
into it, so `batch_alter_table` recreates it without touching anyone's
references. `invoices` is the opposite case - `invoice_items` and `payments` both
foreign-key into it and `extensions/database.py` sets `PRAGMA foreign_keys=ON` on
every connection, so it is rebuilt by hand (see `_rebuild_invoices_named_check`).
"""
from alembic import op

from app.utils.ddl import append_table_constraint, index_ddl_for, strip_column_constraint


# revision identifiers, used by Alembic.
revision = 'c3d7e9f1a2b4'
down_revision = 'b1f2a3c4d5e6'
branch_labels = None
depends_on = None


_PAYMENT_METHOD_CHECK_SQL = (
    "payment_method IS NULL OR payment_method IN ('upi','bank_transfer','cash')"
)


def upgrade():
    # SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so the only way to add a
    # table-level CHECK is a table recreate - which is what batch mode does.
    with op.batch_alter_table('company_settings', schema=None) as batch_op:
        batch_op.create_check_constraint(
            'ck_company_settings_default_gst_bp',
            'default_gst_bp >= 0 AND default_gst_bp <= 2800',
        )
        batch_op.create_check_constraint(
            'ck_company_settings_default_validity_days',
            'default_validity_days >= 0 AND default_validity_days <= 365',
        )

    _rebuild_invoices_named_check()


def _rebuild_invoices_named_check() -> None:
    """Give `invoices.payment_method` a named CHECK, keeping every row.

    `invoices` is the one table batch mode cannot touch: `invoice_items` and
    `payments` both foreign-key into it, so the recreate is done by hand here.

    The two pragmas below are both load-bearing, and neither is guesswork -
    both behaviours were verified directly against this project's SQLite (3.50):

    - `foreign_keys=OFF` is required, because `DROP TABLE invoices_old` is an
      implicit `DELETE FROM` of every row and is refused while enforcement is on
      (`extensions/database.py` sets it on for every connection, §8.5).
    - `legacy_alter_table=ON` is required *because* of that: with FK enforcement
      on, SQLite rewrites the `REFERENCES` clause of every child table on
      `ALTER TABLE ... RENAME`, ignoring `legacy_alter_table` entirely - the
      children's DDL becomes `REFERENCES "invoices_old"(id)` and
      `PRAGMA foreign_key_check` then reports every child as orphaned. With
      enforcement off, `legacy_alter_table=ON` leaves the children's DDL alone
      and the rename is invisible to them.

    The pragmas are toggled on Alembic's *own* connection, not a second one:
    `PRAGMA foreign_keys` is a no-op inside a transaction, so this needs
    autocommit, and opening a separate connection to get it deadlocks against
    Alembic's transaction ("database is locked"). Both are restored in a
    `finally`, so a failure cannot leave the connection with FK enforcement off.
    """
    dbapi = op.get_bind().connection.driver_connection

    isolation = dbapi.isolation_level
    dbapi.isolation_level = None  # autocommit: the pragmas need this
    try:
        cursor = dbapi.cursor()
        try:
            # The pragmas are set first, outside any transaction, because
            # `PRAGMA foreign_keys` is a no-op once one is open.
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("PRAGMA legacy_alter_table=ON")

            # Everything from here to COMMIT is one transaction, and that is the
            # property this rebuild actually depends on. The statements cannot
            # all succeed, and the one that makes the table *disappear*
            # (`ALTER TABLE ... RENAME`) is not the last: between the rename and
            # the `CREATE` that replaces it there is a window in which `invoices`
            # does not exist at all. Under autocommit that window is permanent -
            # a failure anywhere after the rename leaves a database with the
            # constraints half applied and no table to apply them to.
            #
            # It is not a hypothetical. Alembic logs "Will assume non-transactional
            # DDL" for SQLite, so nothing above this function supplies the
            # transaction, and on a real database this exact window is what left
            # `alembic_version` claiming a revision whose schema had been dropped.
            # `BEGIN` here makes the rename, the create, the copy, the drop and
            # every index replay roll back together, so the table is either the
            # old one or the new one and never neither.
            cursor.execute("BEGIN")
            try:
                _swap_invoices_table(cursor)

                # Prove the rebuild orphaned nothing, while enforcement is still
                # off and `foreign_key_check` is the only thing that would notice.
                # This is the invariant the whole pragma dance exists to protect,
                # and it has to be checked before COMMIT - afterwards the
                # violations would be somebody else's problem.
                violations = cursor.execute("PRAGMA foreign_key_check").fetchall()
                if violations:
                    raise RuntimeError(
                        f"c3d7e9f1a2b4: rebuilding invoices left {len(violations)} "
                        f"foreign key violation(s): {violations[:5]}"
                    )
                cursor.execute("COMMIT")
            except BaseException:
                # ROLLBACK before re-raising, and the rename with it: the table
                # goes back to being called `invoices` with its original
                # definition, indexes and rows. Best-effort, because a failure
                # here must not mask the error that caused it.
                try:
                    cursor.execute("ROLLBACK")
                except Exception:
                    pass
                raise
        finally:
            cursor.close()
    finally:
        dbapi.isolation_level = isolation
        cursor = dbapi.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA legacy_alter_table=OFF")
        finally:
            cursor.close()


def _swap_invoices_table(cursor) -> None:
    """Replace `invoices` with a copy carrying the named CHECK.

    Runs entirely inside the transaction opened by the caller. Every statement
    here is individually reversible by SQLite, which is what makes the
    surrounding ROLLBACK sufficient: if any of them fails, the rename is undone
    along with the rest.
    """
    old_ddl = cursor.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'"
    ).fetchone()[0]

    # The DDL is transformed, not retyped. Spelling out the whole CREATE
    # TABLE here would mean restating every column, default and FK, and
    # any column a *later* migration adds would be silently dropped by
    # this one. Moving the constraint from the column definition to a
    # named table-level one - keeping the column and its type - is the
    # entire change wanted.
    new_ddl = strip_column_constraint(old_ddl, "payment_method")
    if new_ddl == old_ddl:
        raise RuntimeError(
            "c3d7e9f1a2b4: could not find the inline payment_method CHECK "
            "in the invoices DDL; the table shape has changed since this "
            "migration was written."
        )
    new_ddl = append_table_constraint(
        new_ddl,
        f"CONSTRAINT ck_invoices_payment_method CHECK ({_PAYMENT_METHOD_CHECK_SQL})",
    )

    # Captured before the rename, which moves every index onto
    # `invoices_old` for `DROP TABLE` to take with it.
    index_ddl = index_ddl_for(cursor, "invoices")

    cursor.execute("ALTER TABLE invoices RENAME TO invoices_old")
    cursor.execute(new_ddl)
    cursor.execute("INSERT INTO invoices SELECT * FROM invoices_old")
    cursor.execute("DROP TABLE invoices_old")
    for statement in index_ddl:
        cursor.execute(statement)


def downgrade():
    # company_settings: SQLite cannot drop a constraint, so this is a recreate
    # that reflects the table without the two CHECKs. Row data is preserved by
    # batch mode; only the constraints go.
    with op.batch_alter_table('company_settings', schema=None) as batch_op:
        batch_op.drop_constraint('ck_company_settings_default_gst_bp', type_='check')
        batch_op.drop_constraint('ck_company_settings_default_validity_days', type_='check')
