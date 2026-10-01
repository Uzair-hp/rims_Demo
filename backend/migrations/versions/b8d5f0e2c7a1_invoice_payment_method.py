"""invoice payment method

Revision ID: b8d5f0e2c7a1
Revises: a7c4e19b2d80
Create Date: 2026-09-30 09:40:00.000000

Adds `invoices.payment_method`, the admin's choice of how payment options are
presented on the invoice, chosen while the invoice is still a draft.

This is deliberately NOT the same thing as `payments.method`. The column here is a
property of the document — it decides which payment instructions get printed and it
is frozen at issue by the draft-only edit guard in `update_invoice_draft`. The
ledger's method records how the client actually paid and is free to differ. Keeping
them in separate columns is what allows an invoice issued as `upi` to still print
UPI details after being settled by bank transfer.

The column is nullable, not defaulted: `NULL` is the first-class "Not Selected"
state, in which the document presents both UPI and bank transfer. Existing rows
therefore need no backfill, and the migration is purely additive.

Note the contrast with `a7c4e19b2d80`: the *address* the method points at (UPI ID,
bank details) is still resolved from `bank_snapshot`/Settings at render time, so a
closed account cannot stay live on issued documents. Only the *presentation
choice* is frozen here.
"""
from alembic import op

from app.utils.ddl import (
    index_ddl_for,
    strip_inline_column,
    strip_table_constraint,
    table_column_names,
)


# revision identifiers, used by Alembic.
revision = 'b8d5f0e2c7a1'
down_revision = 'a7c4e19b2d80'
branch_labels = None
depends_on = None


CHECK_SQL = (
    "payment_method IS NULL OR payment_method IN ('upi','bank_transfer','cash')"
)


def upgrade():
    # A plain `ALTER TABLE ... ADD COLUMN` with the CHECK written inline, NOT
    # `batch_alter_table`.
    #
    # The batch mode used by `a7c4e19b2d80` is the wrong tool on this table, and
    # reaches for it here fails outright:
    #
    #   sqlite3.IntegrityError: FOREIGN KEY constraint failed
    #   [SQL: DROP TABLE invoices]
    #
    # Batch mode implements a constraint change by creating a new table, copying
    # every row, then dropping and renaming. The DROP is what SQLite refuses, because
    # `invoice_items` and `payments` both hold a foreign key into `invoices` and
    # `extensions/database.py` sets `PRAGMA foreign_keys=ON` on every connection
    # (§8.5). So the one table that most needs a constraint is the one batch mode
    # cannot touch.
    #
    # SQLite has supported column-level CHECK constraints in ADD COLUMN since 3.37
    # (this project runs 3.50), and a column constraint needs no rewrite at all. The
    # rewrite is avoided entirely, which is what keeps this additive: no table
    # recreation, no row copy, and no window where the invoices table is missing.
    #
    # `NOT NULL` is deliberately absent, and the `IS NULL` arm of the CHECK is
    # deliberate: NULL is the "Not Selected" state, so existing rows need no
    # backfill. Note SQLite's type affinity means an empty string stays `''` and is
    # *rejected* by the CHECK - the API must send `null`, not `''`, to clear the
    # selector, which the frontend does.
    op.execute(
        "ALTER TABLE invoices ADD COLUMN payment_method VARCHAR(16) "
        f"CHECK ({CHECK_SQL})"
    )


def downgrade():
    # Destructive by nature: it discards the admin's payment presentation choice
    # for every invoice. Alembic's downgrade order guarantees the later revision
    # that names this constraint (`c3d7e9f1a2b4`) has already been undone.
    _rebuild_invoices_without_payment_method()


def _rebuild_invoices_without_payment_method() -> None:
    """
    Remove `invoices.payment_method` by recreating the table, keeping every row.

    Two things rule out the obvious tools, and both are properties of this
    schema rather than of Alembic:

    - `op.batch_alter_table` implements a column drop by creating a new table,
      copying the rows, then `DROP TABLE invoices`. `invoice_items` and `payments`
      both hold a foreign key into `invoices` and `extensions/database.py` sets
      `PRAGMA foreign_keys=ON` on every connection (§8.5), so the drop is refused:

          sqlite3.IntegrityError: FOREIGN KEY constraint failure
          [SQL: DROP TABLE invoices]

      This is the failure the module's own docstring documents for the upgrade
      side; using batch mode here would reintroduce it on the way down. The
      existing cycle test downgraded an empty database, so it never saw it.

    - Native `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+; this project runs 3.50)
      avoids the recreate entirely, but refuses a column that a table-level CHECK
      names. `c3d7e9f1a2b4` gives the constraint the name
      `ck_invoices_payment_method`, which is exactly such a reference, so the
      native form is refused too:

          sqlite3.OperationalError: error in table invoices after drop column:
          no such column: payment_method

    So the table is rebuilt by hand from its own DDL with the column def removed.
    The DDL is transformed rather than retyped, so no other column, default or
    FK can be dropped by accident, and a column added by any other revision
    survives this one.

    The two pragmas are both load-bearing, and both were verified directly
    against this project's SQLite (3.50):

    - `foreign_keys=OFF` is needed for the `DROP TABLE`, as above.
    - `legacy_alter_table=ON` is needed *because* of that: with FK enforcement
      on, SQLite rewrites the `REFERENCES` clause of every child table on
      `ALTER TABLE ... RENAME`, ignoring `legacy_alter_table`, leaving
      `invoice_items` and `payments` permanently pointing at `invoices_old`.

    They are toggled on Alembic's own connection rather than a second one:
    `PRAGMA foreign_keys` is a no-op inside a transaction, so autocommit is
    required, and a separate connection deadlocks against Alembic's transaction.
    Both are restored in a `finally`, and `PRAGMA foreign_key_check` runs while
    enforcement is still off so a botched rebuild fails loudly here rather than
    surfacing as corrupt data later.
    """
    dbapi = op.get_bind().connection.driver_connection

    isolation = dbapi.isolation_level
    dbapi.isolation_level = None  # autocommit: the pragmas need this
    try:
        cursor = dbapi.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("PRAGMA legacy_alter_table=ON")

            old_ddl = cursor.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'"
            ).fetchone()[0]

            # Remove the column definition *and* any CHECK constraint naming it,
            # in one pass, so this works whether the constraint is still the
            # anonymous inline one from the upgrade above or the named one that
            # c3d7e9f1a2b4 introduced.
            new_ddl = strip_table_constraint(old_ddl, "ck_invoices_payment_method")
            new_ddl = strip_inline_column(new_ddl, "payment_method")
            if new_ddl == old_ddl:
                raise RuntimeError(
                    "b8d5f0e2c7a1: could not find payment_method in the invoices "
                    "DDL; the table shape has changed since this migration was "
                    "written."
                )

            # Copy the surviving columns by name rather than with SELECT *, so a
            # column that no longer exists on one side cannot shift into another.
            columns = [c for c in table_column_names(cursor, "invoices") if c != "payment_method"]
            column_list = ", ".join(columns)

            # Captured before the rename, which moves every index onto
            # `invoices_old` for `DROP TABLE` to take with it.
            index_ddl = index_ddl_for(cursor, "invoices")

            cursor.execute("ALTER TABLE invoices RENAME TO invoices_old")
            cursor.execute(new_ddl)
            cursor.execute(
                f"INSERT INTO invoices ({column_list}) SELECT {column_list} FROM invoices_old"
            )
            cursor.execute("DROP TABLE invoices_old")
            for statement in index_ddl:
                cursor.execute(statement)

            violations = cursor.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError(
                    f"b8d5f0e2c7a1: rebuilding invoices left {len(violations)} "
                    f"foreign key violation(s): {violations[:5]}"
                )
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
