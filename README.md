# Ruchita Interiors

Internal business management system for **Ruchita Interiors** - a Quotation,
Invoice & Payment Management application delivered as a Progressive Web App (PWA).

The system is intended for a single business user. The architecture leaves room for
future multi-user support, but multi-user functionality is **not** implemented.

`PLAN.md` is the source of truth for scope, architecture and the phase order. Work
is delivered one phase at a time and each phase has its own exit criteria.

## Stack

| Layer       | Technology                                                    |
| ----------- | ------------------------------------------------------------- |
| Frontend    | React 19 + Vite, JavaScript, React Router 7, plain CSS tokens |
| Backend     | Flask app factory, SQLAlchemy, `/api/v1` blueprint            |
| Database    | SQLite via SQLAlchemy and Alembic                              |
| Application | PWA, installable, offline-capable shell                       |
| Quality     | ESLint, Prettier, Vitest, pytest, production build            |

No TypeScript, no CSS framework, no component library.

## Quick Start

```bash
npm install
python -m venv backend/venv
backend/venv/Scripts/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

Then create the environment files and seed the owner account:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Open `backend/.env` and set the two keys and the credentials. Generate a key
with `python -c "import secrets; print(secrets.token_hex(32))"`; `SECRET_KEY` and
`JWT_SECRET_KEY` must differ, and `ADMIN_PASSWORD` must be at least 10
characters.

```bash
backend/venv/Scripts/flask --app "app:create_app" db upgrade --directory backend/migrations
backend/venv/Scripts/flask --app "app:create_app" seed-admin
backend/venv/Scripts/flask --app "app:create_app" seed-defaults
```

Run these from `backend/`, or `cd backend` first. `seed-defaults` inserts the
settings row, starter terms and catalogue lists — it is idempotent, so re-running
it never duplicates anything.

Then start both applications with one command:

```bash
npm run dev
```

| Service      | URL                                 |
| ------------ | ----------------------------------- |
| Web app      | http://localhost:5173               |
| API          | http://127.0.0.1:5000               |
| Health check | http://127.0.0.1:5000/api/v1/health |

Sign in at http://localhost:5173/login with the `ADMIN_EMAIL` and
`ADMIN_PASSWORD` you set.

The root `npm install` also installs the frontend packages, and `npm run dev`
finds the Python interpreter on its own (`backend/venv`, then `python3`/`python`,
or whatever `Ruchita_PYTHON` points at). On POSIX, the pip line above is
`backend/venv/bin/pip`.

## Commands

Run from the repository root:

| Command                | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | API and web app together                 |
| `npm run build`        | Production frontend build                |
| `npm run preview`      | Serve the production build               |
| `npm run lint`         | ESLint                                   |
| `npm run format:check` | Prettier check                           |
| `npm test`             | Frontend and backend test suites         |
| `npm run test:api`     | Backend tests only                       |
| `npm run verify`       | Lint, format, tests and build - the gate |

`npm run verify` is the command to run before considering a phase finished.

## Project Structure

```
ruchita_interiors/
├── brand/logo.svg     official source logo
├── frontend/          React + Vite PWA
├── backend/           Flask REST API
├── docs/              architecture, development and API notes
├── scripts/           one-command runners and the brand asset pipeline
├── PLAN.md            scope, architecture and phase order
└── package.json       root commands
```

- **brand/** - the official source logo the shipped assets are derived from.
- **frontend/** - the user interface, design tokens and application shell.
- **backend/** - the Flask REST API, business rules and persistence.
- **docs/** - architecture, development, API and phase notes.
- **scripts/** - cross-platform runners for the API and tests, plus the brand
  asset pipeline that produces the shipped logo and every PWA icon.

## Environment

Each application has its own environment template, as shown in Quick Start. The
root `.env.example` is a convenience reference listing every variable in one
place.

Do **not** commit `.env` files - only the `.env.example` templates.

## Current Status

**Phases 1, 2 and 3 are complete.** Both applications run, and the following are
in place and verified:

- Responsive app shell: sidebar at `lg` and up, top bar and five-slot bottom bar
  below it, with More and New sheets.
- Centralised design tokens, light and dark themes, no framework CSS.
- All planned routes, each with a purposeful empty state naming the phase that
  fills it in.
- Self-hosted fonts, installable PWA with generated maskable icons.
- Flask app factory with `GET /api/v1/health` and the full auth surface:
  login, logout, refresh, me and password change.
- `User` model on scrypt hashing, an Alembic migration, and a `flask seed-admin`
  CLI.
- Cookie sessions: 15-minute access token, 30-day sliding refresh, HTTPOnly and
  `SameSite=Lax`, with CSRF double-submit on every non-GET request.
- Frontend route guards, sign-in page, sign-out, and transparent token refresh.
- The full business schema from `PLAN.md` section 8.3 - clients, company
  settings, numbering counters, terms, quotations, invoices, items and payments -
  with CHECK constraints and a partial unique index, via one Alembic migration.
- Settings API and Settings UI covering every section: business profile, logo
  upload with format/size validation, quotation and invoice defaults, tax, bank
  details, document footer, catalogue lists and terms with a per-scope default.
- `flask seed-defaults`: idempotent seeding of the settings row, starter terms
  and catalogue lists.
- Polished sign-in page: two-pane layout at `lg` and up, inline validation,
  password reveal and the optimised SVG logo.
- 64 frontend tests, 67 backend tests, clean lint, clean format, passing build.

Client records, quotation documents, PDFs and invoices arrive in Phases 4-7,
not an oversight - see `PLAN.md`.

## Planned Modules

Phase order from `PLAN.md` section 24, mirrored with status in `docs/phases.md`:

1. Architecture & project foundation - **done**
2. Authentication & user system - **done**
3. Database & company settings - **done**
4. Client management - **done**
5. Quotation engine (core) - **done**
6. Quotation document / PDF - **done**
7. Invoice system - **done**
8. Payments & financial tracking - **done**
9. Dashboard & analytics
10. PWA / mobile optimization
11. Security, validation & edge cases
12. Full testing & production readiness
