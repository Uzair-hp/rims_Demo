"""phase 9A services catalog

Revision ID: b1f2a3c4d5e6
Revises: b8d5f0e2c7a1
Create Date: 2026-09-30 10:00:00.000000

SERVICES_PLAN §4.2 (Phase 9A). One migration, three things:

1. The `services` table — the standard rate card. CHECK constraints (rate > 0,
   qty >= 0) and the partial unique index on `lower(name) WHERE archived_at IS
   NULL` are written by hand because Alembic autogenerate cannot see them from
   SQLite models — the same limitation the phase 3 migration documents.
2. `service_id` / `catalog_rate_paise` on `quotation_items` and `invoice_items`
   — informational only (S7): they never enter `calculations.py`. Nullable with
   **no backfill**, so existing lines are simply "not from catalog" (§4.2).
   `service_id` is an FK with RESTRICT, which is safe precisely because services
   are never hard-deleted (S5).
3. The index that serves the list's `(archived_at, category, name)` ordering.

`downgrade` drops everything in reverse order, so the cycle the test suite runs
(empty and seeded) stays lossless.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1f2a3c4d5e6'
down_revision = 'b8d5f0e2c7a1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'services',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('unit', sa.String(length=50), server_default='job', nullable=False),
        sa.Column('default_qty_milli', sa.Integer(), server_default='1000', nullable=False),
        sa.Column('rate_paise', sa.Integer(), nullable=False),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            'rate_paise > 0 AND rate_paise <= 1000000000000',
            name='ck_services_rate_positive',
        ),
        sa.CheckConstraint(
            'default_qty_milli >= 0',
            name='ck_services_default_qty_nonnegative',
        ),
    )
    with op.batch_alter_table('services', schema=None) as batch_op:
        batch_op.create_index(
            'ix_services_archived_category_name',
            ['archived_at', 'category', 'name'],
            unique=False,
        )
        # FR-SV3 backstop: one active service per lowercase name. SQLite cannot
        # express this in the ORM declaration alone (same as the invoices partial
        # index), so the DDL is written here to match the model.
        batch_op.create_index(
            'uq_services_active_name',
            [sa.func.lower(sa.column('name'))],
            unique=True,
            sqlite_where=sa.text('archived_at IS NULL'),
        )

    # The two item columns, via batch mode because SQLite rewrites the table for
    # an FK-bearing ADD COLUMN (same reasoning as the phase 8 migration). The FK is
    # given an explicit name because batch mode cannot drop an unnamed constraint
    # on the way back down — the downgrade would fail with "Constraint must have a
    # name".
    for table in ('quotation_items', 'invoice_items'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    'service_id',
                    sa.Integer(),
                    sa.ForeignKey('services.id', ondelete='RESTRICT', name=f'fk_{table}_service_id'),
                    nullable=True,
                )
            )
            batch_op.add_column(sa.Column('catalog_rate_paise', sa.Integer(), nullable=True))


def downgrade():
    for table in ('quotation_items', 'invoice_items'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column('catalog_rate_paise')
            batch_op.drop_column('service_id')

    with op.batch_alter_table('services', schema=None) as batch_op:
        batch_op.drop_index('uq_services_active_name')
        batch_op.drop_index('ix_services_archived_category_name')

    op.drop_table('services')
