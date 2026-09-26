# Database

> Skeleton notes. Schema design happens in the implementation phase.

## Engine

SQLite is the initial database, configured through `DATABASE_URL`:

```
DATABASE_URL=sqlite:///ruchita_interiors.db
```

- The database file lives in `backend/instance/`.
- SQLite files are git-ignored and must never be committed.

## Access

All access goes through the ORM (SQLAlchemy). Business code must not depend on
SQLite-specific behaviour, so a future move to PostgreSQL does not require
restructuring the project.

## Migrations

Schema versioning is planned under `backend/migrations/`.

## Status

No tables are created in this phase — no `users`, `clients`, `quotations`,
`invoices`, `payments` or `settings` tables exist yet. Only the connection
configuration is prepared.
