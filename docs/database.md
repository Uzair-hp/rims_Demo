# Database

> `PLAN.md` section 8 is the source of truth for the schema. Phase 2 added the
> `users` table; the business tables arrive in Phase 3.

## Engine

SQLite is the production database for this system (see `PLAN.md` 8.5), configured
through `DATABASE_URL`:

```bash
DATABASE_URL=sqlite:///ruchita_interiors.db
```

A relative path is rewritten by the app factory to `backend/instance/`, so the
database lands in the same place regardless of the directory the app was started
from. An absolute path is used as given.

- The database file lives in `backend/instance/` and is git-ignored.
- `.gitkeep` keeps the empty directory in version control.
- Tests use a temporary SQLite file per test and never touch this file.

## Connection Settings

Set per connection in `app/extensions/database.py`, because SQLite ignores
`foreign_keys` unless it is set on each one:

| Setting         | Value    | Why                                              |
| --------------- | -------- | ------------------------------------------------ |
| `foreign_keys`  | `ON`     | Off by default; the RESTRICT rules would be silently ignored |
| `journal_mode`  | `WAL`    | The dashboard can read while a write is in progress |
| `busy_timeout`  | `5000`   | Wait instead of failing on a momentary lock      |
| `synchronous`   | `NORMAL` | Safe with WAL; the default `FULL` costs a write fsync per commit |

## Access

All access goes through SQLAlchemy. Business code must not depend on
SQLite-specific behaviour, so a later move to PostgreSQL needs no restructuring.

`app/extensions/database.py` owns the unconfigured `db` object and an
`init_database(app)` helper; the factory is the only caller.

## Migrations

Alembic owns DDL. `db.create_all()` is never called outside tests, so the schema
in the developer's database always matches a reviewed revision.

```bash
cd backend
venv\Scripts\flask --app "app:create_app" db upgrade
venv\Scripts\flask --app "app:create_app" db current
```

Current revision: `4cb5324d6e1e` — `phase 3 schema`.

## Tables

### `users` (Phase 2)

| Column           | Type      | Notes                                        |
| ---------------- | --------- | -------------------------------------------- |
| `id`             | integer   | Primary key                                  |
| `email`          | string    | Unique, indexed, lower-cased on write        |
| `name`           | string    | Display name                                 |
| `password_hash`  | string    | Werkzeug scrypt. Never selected or returned  |
| `role`           | string    | `owner`. Reserved for a future multi-user system |
| `is_active`      | boolean   | An inactive account is treated as signed out |
| `token_version`  | integer   | Revocation counter, see below                 |
| `created_at`     | datetime  |                                               |
| `updated_at`     | datetime  |                                               |

Exactly one row is expected (FR-A4). There is no signup and no password reset, so
`flask seed-admin` is the only way the account comes into existence.

`token_version` is an addition to `PLAN.md` 8.3 (`PLAN.md` B9). Logout and password
change increment it, which invalidates every refresh token issued beforehand in a
single write. Without it, a stateless JWT could not be revoked and a captured
refresh cookie would survive sign-out.

## Status

### `company_settings` (Phase 3)

Single row, insert-guarded `id = 1`. Every §15 field: company identity and
address, `logo_path`, document defaults (`default_gst_bp` 1800,
`default_validity_days` 15, `quotation_prefix` `QTN`, `invoice_prefix` `INV`),
bank block, signatory, footer text, and the JSON catalogue arrays
(`item_categories`, `units`). CHECK constraints keep GST within 0–2800 bp and
validity within 0–365 days.

### Remaining Phase 3 tables

| Table | Role |
| ----- | ---- |
| `clients` | Address book; indexed on `name` and `archived_at` |
| `quotations` / `quotation_items` | Quotation header (JSON client snapshot, cached totals in paise) + line items; status CHECK per §13; items CASCADE with their header |
| `invoices` / `invoice_items` | Invoice header (bank snapshot, independent `INV` sequence) + line items; **partial unique index** on `quotation_id WHERE status != 'cancelled'` enforces one active invoice per quotation |
| `payments` | `amount_paise > 0` CHECK and the fixed method enum from §11 |
| `terms_conditions` | Default terms per scope (`quotation`, `invoice`, `both`) with the exclusive `is_default` flag |
| `numbering_counters` | `UNIQUE(doc_type, year)` buckets for §12 allocation |

## Status

All `PLAN.md` 8.3 tables exist via migrations (`4cb5324d6e1e`); the downgrade to
base and re-upgrade cycle is covered by `tests/test_seed_and_migrations.py`.
Business *endpoints* over these tables arrive with Phases 4–8.
