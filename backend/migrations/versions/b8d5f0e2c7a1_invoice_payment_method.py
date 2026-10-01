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
    # A column-level CHECK travels with its column, so dropping the column drops the
    # constraint. This is again a rewrite, and would hit the same foreign key
    # refusal as the original upgrade if anything still referenced `invoices`.
    with op.batch_alter_table('invoices', schema=None) as batch_op:
        batch_op.drop_column('payment_method')
