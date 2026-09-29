# Development

> See the root `README.md` for the short version. This file is the working
> reference for day-to-day development.

## Getting Started

```bash
# From the repository root
npm install
python -m venv backend/venv
backend/venv/Scripts/pip install -r backend/requirements.txt -r backend/requirements-dev.txt

cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
# Then set SECRET_KEY, JWT_SECRET_KEY, ADMIN_EMAIL and ADMIN_PASSWORD in
# backend/.env. Generate a key: python -c "import secrets; print(secrets.token_hex(32))"

# One-time: create the schema, the owner account and the default settings
cd backend
venv\Scripts\flask --app "app:create_app" db upgrade
venv\Scripts\flask --app "app:create_app" seed-admin
venv\Scripts\flask --app "app:create_app" seed-defaults
cd ..

# One command starts both applications
npm run dev
```

On POSIX the pip path is `backend/venv/bin/pip`.

### Two ways to run the dev servers

`npm run dev` runs both servers as child processes of one foreground command, which
is the right choice when a person is watching. `npm run dev:start` starts them
**detached**, which is what an agent, a script or a CI job needs:

```bash
npm run dev:start    # start (or reuse) both, detached
npm run dev:status   # which are up, on which PID, healthy or not
npm run dev:stop     # stop both
npm run dev:restart  # stop then start
npm run dev:start:api   npm run dev:stop:web   # single service
```

Both forms serve the same URLs. The difference is process lifetime: `dev:start`
creates each process through WMI, so it is parented to the WMI service host rather
than to the calling shell and survives that shell exiting. A server started as a
child of a short-lived shell dies with it, which quietly invalidates any browser
check done afterwards.

`dev:start` is also careful about existing processes:

- A healthy server already on the port is **reused**, not restarted.
- A port held by a process outside this repository is **reported, not killed** -
  `dev:start` will not stop something it does not own.
- Stopping is graceful first, escalating to a forced kill only if a process
  genuinely ignores the polite request.

PID files, the generated `.cmd` launchers and server logs live in `.dev/`
(gitignored). To read what a server printed:

```bash
cat .dev/logs/api.log
cat .dev/logs/web.log
```

| Service      | URL                                 |
| ------------ | ----------------------------------- |
| Web app      | http://localhost:5173               |
| API          | http://127.0.0.1:5000               |
| Health check | http://127.0.0.1:5000/api/v1/health |

`npm run dev` finds Python on its own: `backend/venv` first, then `python3` and
`python`, and finally whatever `Ruchita_PYTHON` points at. Override it if you
need a specific interpreter:

```bash
Ruchita_PYTHON=/path/to/python npm run dev   # PowerShell: $env:Ruchita_PYTHON = "…"
```

The dev scripts are plain Node (`scripts/python.mjs`, `scripts/run-backend.mjs`),
so they behave the same in PowerShell, cmd, bash and zsh. No POSIX-only shell
syntax in any npm script.

## Commands

From the repository root:

| Command                | Purpose                               |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | API and web app together (foreground) |
| `npm run dev:start`    | Start both detached, outliving the shell |
| `npm run dev:status`   | Report dev server state and health    |
| `npm run dev:stop`     | Stop both detached servers            |
| `npm run dev:restart`  | Stop then start                       |
| `npm run build`        | Production frontend build             |
| `npm run preview`      | Serve the production build            |
| `npm run lint`         | ESLint                                |
| `npm run format`       | Prettier write                        |
| `npm run format:check` | Prettier check                        |
| `npm test`             | Frontend and backend suites           |
| `npm run test:api`     | Backend suite only                    |
| `npm run verify`       | Lint, format, tests, build - the gate |

The frontend has its own equivalents inside `frontend/` (`npm test`,
`npm run test:watch`, `npm run test:coverage`).

## Environment

Copy each template before running:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

The app starts with no `.env` at all, because every setting has a development
default - but with no `.env` the JWT key falls back to a per-process random value,
so **sessions do not survive a server restart**. Set both keys in `backend/.env`
before doing anything you care about. `ADMIN_EMAIL` and `ADMIN_PASSWORD` have no
default; `seed-admin` refuses to run without them.

Never commit `.env`; only the `.example` templates are tracked.

## Database

SQLite lives at `backend/instance/ruchita_interiors.db` and is gitignored. Schema
changes go through Alembic, never `create_all()`:

```bash
cd backend
venv\Scripts\flask --app "app:create_app" db upgrade                       # apply
venv\Scripts\flask --app "app:create_app" db current                      # which revision
venv\Scripts\flask --app "app:create_app" db migrate -m "add clients"     # new revision
venv\Scripts\flask --app "app:create_app" db downgrade base               # roll back
```

`downgrade base` then `upgrade head` is part of the Phase 3 exit criteria, so
keep migrations reversible.

Resetting the local database is safe once you have the seed credentials saved
somewhere: delete `backend/instance/*.db*`, then re-run `db upgrade` and
`seed-admin`.

## Working Conventions

- Keep modules small and single-purpose; no file should grow without reason.
- Prefer a reusable `components/ui` primitive over a page-specific duplicate.
- Follow the existing folder structure and place new code in the matching folder.
- Every raw colour, size, radius or duration goes in `src/styles/tokens.css`.
  If you need a value that is not there, add a token rather than a literal.
- All money maths lives in a backend service. The frontend may display a running
  total, never decide one.
- Every new API endpoint needs `@login_required` unless it is deliberately
  public. There is no global auth middleware; the decorator is the control.
- Every non-GET endpoint gets `@csrf_protect`, and the frontend sends the header
  via `apiRequest` in `client.js` rather than calling `fetch` directly.
- Add a test next to new logic. `npm run verify` is necessary but **not sufficient**
  to close a phase (PLAN §25, B11).
- The standard gate is `npm run verify` (`lint` → `format:check` → backend
  `pytest` → frontend `vitest` → production build) plus an API health check
  against `http://127.0.0.1:5000/api/v1/health`. Automate the browser check only
  where `PLAN.md` explicitly calls for E2E (Phase 11), and never add a browser
  dependency to satisfy a phase gate.
- Before a phase is marked done, start the dev servers with `npm run dev:start`
  and load the app at `http://127.0.0.1:5173` to confirm it renders. Phase 1's
  shell shipped unable to render at all and every automated check still passed,
  because the tests covered the route table and never the entry point. A single
  page load catches that class of failure; it is not a substitute for the gate.
- Anything that calls a router hook (`useLocation`, `useNavigate`, `useParams`,
  `useSearchParams`, `useMatches`) belongs in the route table in
  `src/app/routes.jsx`. Mounting it as a sibling of `<RouterProvider>` in `main.jsx`
  or `App.jsx` throws, and the whole app shows the ErrorBoundary.

## Regenerating Brand Images

Brand assets are generated from the official logo, never hand-edited. The pipeline
runs in two steps because the source is an automatic raster trace and cannot be
shipped as-is:

```bash
node scripts/optimize_logo.mjs        # brand/logo.svg -> frontend/public/brand/logo.svg
python scripts/generate_brand_icons.py  # raster icons for favicon, PWA and iOS
```

`optimize_logo.mjs` takes the ~2 MB traced source to roughly 124 KB. The trace
arrives as thousands of near-identical fills and tiny shards; the script
quantises the colour palette, simplifies the geometry, merges same-fill subpaths
and writes a trimmed `viewBox`. It prints a report and refuses to write anything
over 150 KB, so a regression in the reduction cannot slip into the bundle.

Useful flags: `--report` measures without writing, `--epsilon` sets the
simplification tolerance (default 3.5) and `--colors` the palette size
(default 16). Colour count barely affects file size - the path data dominates -
so the default keeps the gold gradient rather than flattening it to save nothing.

`generate_brand_icons.py` renders the favicon, PWA and iOS PNGs from the shipped
vector. It needs Pillow (`pip install Pillow`) and the `@resvg/resvg-js`
dev-dependency, both build-time only. cairosvg is deliberately *not* used: it
requires the native cairo C library, which is absent on a stock Windows install.
All outputs are committed, so a fresh clone never needs a rasteriser to run the app.

## Editing Files Safely on Windows

These files are UTF-8 without a BOM. PowerShell 5.1's `Set-Content -Encoding
UTF8` adds a BOM, so prefer the editor or the `edit` tool. If a BOM does creep
in, `npm run verify` still passes but the file is inconsistent with the rest of
the repository, so strip it.

## Status

Phases 1 and 2 complete. The loop above - `npm run dev:start` to work, `npm run
verify` to gate, then a browser check - is the established workflow. 50 frontend
tests and 43 backend tests pass.
