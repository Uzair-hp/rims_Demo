# Ruchita Interiors - Backend

Flask REST API for the Ruchita Interiors Quotation, Invoice & Payment Management
System. It serves the JSON API consumed by the `frontend/` PWA and owns all
business rules, validation and persistence.

## Current Setup Status

**Phases 1 and 2 are complete.** The app factory, configuration, the SQLAlchemy
extension, the users model with migrations, and the full authentication surface
are implemented and tested:

| Method | Path                    | Auth          | Purpose                       |
| ------ | ----------------------- | ------------- | ----------------------------- |
| GET    | `/api/v1/health`        | none          | Liveness probe, no database   |
| GET    | `/`                     | none          | Service identity              |
| GET    | `/api/v1/auth/csrf`     | none          | Issue the CSRF cookie         |
| POST   | `/api/v1/auth/login`    | CSRF          | Verify credentials, set cookies |
| POST   | `/api/v1/auth/logout`   | CSRF          | Revoke sessions, clear cookies  |
| POST   | `/api/v1/auth/refresh`  | CSRF          | New token pair, sliding window |
| GET    | `/api/v1/auth/me`       | access cookie | Current user                  |
| PUT    | `/api/v1/auth/password` | access cookie + CSRF | Change password        |

`quotations`, `invoices`, `clients`, `payments` and `settings` all return 404 by
design until their phase lands, rather than half-working.

See `../docs/api.md` for the envelope, cookie flags and CSRF contract.

## Python Environment Setup

```bash
cd backend
python -m venv venv
```

Activate it:

- Windows: `venv\Scripts\activate`
- Linux/macOS: `source venv/bin/activate`

## Dependency Installation

```bash
pip install -r requirements.txt -r requirements-dev.txt
```

## Environment Configuration

```bash
cp .env.example .env
```

Then generate the two secret keys and paste them in:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

| Variable                        | Description                                          | Default                    |
| ------------------------------- | ---------------------------------------------------- | -------------------------- |
| `FLASK_ENV`                     | `development` or `production`                        | `development`              |
| `FLASK_DEBUG`                   | Enables the debugger and reloader                    | `true` in development      |
| `SECRET_KEY`                    | Flask session key                                    | random per process         |
| `JWT_SECRET_KEY`                | Access/refresh token signing key                     | falls back to `SECRET_KEY` |
| `ACCESS_TOKEN_TTL_SECONDS`      | Access token lifetime                                | `900` (15 min)             |
| `REFRESH_TOKEN_TTL_SECONDS`     | Refresh token lifetime, sliding                      | `2592000` (30 days)        |
| `DATABASE_URL`                  | SQLAlchemy connection string                         | SQLite under `instance/`   |
| `CORS_ORIGINS`                  | Comma-separated CORS origins; falls back to `FRONTEND_URL` | `http://localhost:5173` |
| `ADMIN_EMAIL`                   | Seeded owner account email                           | none                       |
| `ADMIN_PASSWORD`                | Seeded owner password, minimum 10 characters         | none                       |
| `ADMIN_NAME`                    | Seeded owner display name                            | `Ruchita Interiors`        |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | Failed logins per window, per IP + email             | `5`                        |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Rate-limit window                                  | `300`                      |
| `TRUST_PROXY_HEADERS`           | Honour `X-Forwarded-For`                             | `false`                    |
| `TRUSTED_PROXY_COUNT`           | Proxies appending to that header                     | `1`                        |
| `HOST` / `PORT`                 | Bind address                                         | `127.0.0.1` / `5000`       |

`SECRET_KEY` and `JWT_SECRET_KEY` must be different values, and both are
mandatory in production: a random per-process value would sign out every user on
every restart. Never commit `.env`.

## First Run

```bash
flask --app "app:create_app" db upgrade
flask --app "app:create_app" seed-admin
flask --app "app:create_app" seed-defaults
```

`seed-admin` refuses to run before `db upgrade`, and asks before resetting an
existing account's password. `seed-defaults` inserts the settings row, starter
terms and catalogue lists, and is safe to re-run.

## Development Start Command

```bash
python run.py
```

Backend URL: `http://127.0.0.1:5000`

Health check: `http://127.0.0.1:5000/api/v1/health`

From the repository root, `npm run dev` starts the API and the web app together.

## Tests

```bash
python -m pytest tests -q
```

Tests use a temporary SQLite file per test, so running them never touches the
developer's database.

## API Conventions

Every response uses the same envelope, which the frontend client depends on:

```jsonc
// success
{ "data": { } }

// failure
{ "error": { "code": "NOT_FOUND", "message": "…", "details": [] } }
```

Error codes in use: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `METHOD_NOT_ALLOWED`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`.

## Folder Structure

```
backend/
├── app/
│   ├── __init__.py            # create_app() factory, error handlers
│   ├── api/                   # versioned blueprints (/api/v1)
│   │   ├── health.py          # GET /health
│   │   └── auth.py            # the six auth endpoints
│   ├── config/settings.py     # environment-driven configuration
│   ├── extensions/
│   │   └── database.py        # SQLAlchemy instance + SQLite pragmas
│   ├── models/user.py         # User, scrypt hashing, token_version
│   ├── schemas/auth.py        # Marshmallow request validation
│   ├── services/
│   │   ├── auth.py            # JWT issuing, decoding, cookies
│   │   ├── csrf.py            # double-submit enforcement
│   │   └── rate_limit.py      # in-memory login limiter
│   ├── seed/seed_admin.py     # flask seed-admin
│   └── utils/                 # guards, error envelope
├── migrations/                # Alembic
├── tests/                     # pytest suite
├── instance/                  # local SQLite database (gitignored)
├── uploads/                   # uploaded files
├── conftest.py                # test fixtures
├── run.py                     # entry point
└── requirements.txt
```

## Notes

- SQLite is the initial database, configured via `DATABASE_URL`. The ORM sits in
  front of it so a later move to PostgreSQL needs no restructuring. `foreign_keys`,
  WAL, `busy_timeout` and `synchronous` are set per connection.
- Schema changes go through Alembic only. Never `db.create_all()` against the
  developer's database.
- Business endpoints arriving in Phase 3 onward must use the `login_required`
  decorator in `app/utils/guards.py`. The backend, not the frontend guard, is
  what actually protects a route.
