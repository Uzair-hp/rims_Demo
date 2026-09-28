# Phases

> `PLAN.md` section 24 is the source of truth for phase order, scope and exit
> gates. This file is a status mirror only. If the two ever disagree, `PLAN.md`
> wins and this file is what needs fixing.

Phases run strictly in order. A phase may not start until the exit gate of the
previous phase passes. `npm run verify` (lint, format, frontend tests, backend
tests, production build) is the gate for every phase.

## Status

| Phase | Title                               | Status      |
| ----- | ----------------------------------- | ----------- |
| 1     | Architecture & project foundation   | **Done**    |
| 2     | Authentication & user system        | **Done**    |
| 3     | Database & company settings         | **Done**    |
| 4     | Client management                   | **Done**    |
| 5     | Quotation engine (core)             | Not started |
| 6     | Quotation document / PDF            | Not started |
| 7     | Invoice system                      | Not started |
| 8     | Payments & financial tracking       | Not started |
| 9     | Dashboard & analytics               | Not started |
| 10    | PWA / mobile optimization           | Not started |
| 11    | Security, validation & edge cases   | Not started |
| 12    | Full testing & production readiness | Not started |

## Phase 1 - Architecture & project foundation (done)

Objective: running skeleton of the whole system.

Delivered:

- Monorepo scaffold: Flask app factory, config, `GET /api/v1/health`; Vite +
  React/JSX frontend with plain-CSS design tokens, router and an AppShell with
  sidebar, top bar and bottom navigation plus placeholder pages.
- PWA manifest and generated service worker, maskable icons, self-hosted fonts.
- ESLint, Prettier, Vitest and pytest tooling; `.env.example` templates; one
  command to run both apps.
- Brand asset pipeline from the official logo in `brand/logo.svg`: the shipped
  vector lockup plus generated PWA, favicon and iOS icons.

Exit criteria met:

- `npm run dev` starts the API and web app together; health check and the Vite
  `/api` proxy both respond.
- Shell responds at 360, 768 and 1280.
- 27 frontend tests, 6 backend tests, clean lint, clean format, passing build.

Deliberately **not** included: authentication, database models, business
endpoints, calculations, documents or form logic. Everything below builds on
this.

## Phase 2 - Authentication & user system (done)

Users model and migration, seed CLI, login/logout/refresh/me and password change
endpoints, JWT cookie auth with CSRF double-submit, login rate limit, protected
route guard with a 401-refresh interceptor, and the branded Login page.

Delivered:

- `User` model with scrypt hashing and a `token_version` revocation counter, plus
  migration `000d90328da3` and the `flask seed-admin` CLI.
- The six auth endpoints under `/api/v1/auth`, all in the §9.1 envelope, all
  `Cache-Control: no-store`. Access token 15 min, refresh 30 days sliding, both
  HTTPOnly / `SameSite=Lax` / `Secure` in production, refresh path-scoped.
- CSRF double-submit: readable `csrf_token` cookie plus `X-CSRF-Token`, required
  on every non-GET request. `GET /auth/csrf` bootstraps it before login.
- In-memory login limiter, 5 failures per 5 minutes per IP + email. Counted as
  failures rather than attempts (`PLAN.md` B7), and `X-Forwarded-For` is ignored
  unless `TRUST_PROXY_HEADERS` is set (B8).
- Frontend: `AuthProvider` resolving the session from `GET /auth/me` on load,
  `RequireAuth` / `RedirectIfAuthenticated` guards, sign-out in the sidebar and the
  mobile More sheet, and the real Login page.
- `client.js` sends the CSRF header on mutations and refreshes a single-flight
  401. Only `/auth/login` and `/auth/refresh` are excluded, so an expired access
  token never signs a user out on reload.

Exit criteria met:

- Seeded credentials sign in; wrong password and unknown account return the
  identical envelope, and an unknown account still pays the scrypt cost.
- Session survives reload and a server restart (tokens are stateless, the refresh
  cookie is not).
- Logout revokes server-side even when the access token has already expired, so a
  captured refresh cookie cannot be replayed.
- Missing CSRF header on POST returns 403; the sixth failure in a window returns
  429.
- Password change invalidates existing refresh tokens.
- 43 backend tests, 46 frontend tests, clean lint, clean format, passing build,
  plus a live HTTP smoke run covering real `Set-Cookie` handling and cookie paths.

## Phase 3 - Database & company settings (done)

Full schema (`PLAN.md` 8.3) with Alembic migrations, settings endpoints, the
complete Settings UI, logo upload and serving, and default seeding.

Delivered:

- Migration `4cb5324d6e1e` creates every §8.3 table — `clients`, `quotations`,
  `quotation_items`, `invoices`, `invoice_items`, `payments`, `terms_conditions`,
  `numbering_counters` and the single-row `company_settings` — including the
  CHECK constraints, FK `ON DELETE` rules and the partial unique index on
  `invoices.quotation_id WHERE status != 'cancelled'`. Downgrade to base and
  re-upgrade verified on an empty database.
- Settings API: `GET/PUT /settings/company` (partial saves merge server-side,
  per-field 422s), terms CRUD with the exclusive per-scope default flag, logo
  upload (`POST /settings/logo`), removal (`DELETE /settings/logo`) and
  authenticated serving (`GET /uploads/logo`, long-lived cache keyed by
  `updated_at`).
- Upload policy (§15/§16): PNG/JPEG/WEBP only, ≤ 2 MB, extension + MIME +
  magic-byte + Pillow decode checks, UUID filenames under `uploads/branding/`
  outside static. SVG rejected with a clear error; a forged extension is
  rejected by the content sniff.
- `flask seed-defaults`: settings row with §15 defaults (QTN/INV prefixes, 18%
  GST, 15-day validity, the 11 category labels), two starter terms; idempotent,
  and refuses to run before `flask db upgrade`.
- Frontend Settings page: all ten §15 sections as independent forms, each with
  its own Save, inline field errors and success feedback — Business
  information, Branding (immediate upload with preview/remove), Quotation /
  Invoice / Tax / Bank / Document defaults, Terms CRUD, Catalogue lists and
  Account & security (password change → sign out, since the server revokes the
  session). `SettingsProvider` loads the row once for the shell.
- The uploaded logo renders in the app shell (sidebar) through `BrandLockup`,
  falling back to the bundled `brand/logo.svg` when none is set or when the
  image fails to load.
- Login UI polish: mobile-first split layout — ink brand panel from `lg`,
  compact plate above the form below it — with the optimized SVG logo, client-
  side validation before any request, focus/error/loading states, 48px inputs
  and a 44px password reveal control.
- **Login page redesign (Phase 6 enhancement):** Complete visual overhaul with
  new design tokens (charcoal, gold, ivory, card), new fonts (Cormorant Garamond
  headings, Cinzel wordmark, DM Sans UI), two-equal-panel desktop layout
  (charcoal brand panel / ivory form panel), mobile header band with overlapping
  form card, gold primary button, inline mail/lock icons in inputs, WCAG AA
  contrast and full accessibility attributes.

Exit criteria met:

- Migration cycle (`upgrade → downgrade base → upgrade`) succeeds; all §8.3
  tables and constraints present in the DDL.
- Every Settings section saves, validates and reloads (67 backend tests),
  including the §25 upload matrix: small PNG accepted; SVG, oversized (>2MB)
  and forged-extension files rejected with per-field messages — verified live
  against the dev server, not only in tests.
- Starter terms and catalogue defaults seeded (`flask seed-defaults`).
- Prefix and GST edits persist through `PUT /settings/company` with no code
  change; the document surface that consumes them arrives in Phases 5–6.
- `npm run verify` green: lint, format, 64 frontend tests, 67 backend tests,
  production build; `/api/v1/health` reports `phase: 3` on the running dev
  servers.

## Phase 4 - Client management (done)

Clients API (CRUD, archive, search, summary), list and detail pages, client form
modal, and the client picker reused by the quotation editor.

Delivered:

- Backend: `PHASE=4` bumped in `settings.py`. `GET /api/v1/health` reports `phase: 4`.
  - Full CRUD under `/api/v1/clients`: create, read (list + single), update, delete (archive).
  - `GET /clients/:id/summary` returns quotation/invoice/payment totals.
  - Search by name/phone/email via `q` param; `include_archived` toggle; pagination.
  - Latent bug fix: `_invoices_for` now filters by `_BILLED_STATUS="issued"` so draft/cancelled
    invoices don't inflate totals (§11).
  - 31 new backend tests (88 total, all passing). Shared `authed_client` + `_csrf` fixtures
    in `conftest.py`; CSRF fixture ordering bug fixed.
- Frontend:
  - `lib/money.js` (`formatPaise` with Indian grouping), `lib/format.js` (`formatDate`),
    `api/endpoints/clients.js` (all 7 client API calls).
  - Icons: `edit`, `archive`, `trash`, `phone`, `mail`, `mapPin`, `rotateCw` added to `Icon.jsx`.
  - UI primitives: `StatusBadge`, `ConfirmDialog`, `Pagination`, `Button`, `Card`,
    `EmptyState`, `Skeleton`, `TextField`, `PageHeader`.
  - `features/clients/index.js` re-exports, `useClients` hook (shared search/pagination/
    archived toggle between list and picker), `ClientForm.jsx` + `ClientFormModal.jsx`.
  - `ClientsPage.jsx` — debounced search (250ms), archived toggle, paginated cards,
    `?new=1` create-modal trigger, archive confirmation.
  - `ClientDetailPage.jsx` — profile card with contact details, totals strip
    (quotations/invoices/payments counts and values via `formatPaise`), archived
    Restore action, inline empty-state links to create new documents.
  - `ClientPicker.jsx` — Sheet-based search-and-pick with inline create, shared
    `useClients` state so picker and list never disagree.
  - `pages/Clients.jsx` wired to real components; `AppShell.jsx` New sheet updated;
    `navigation.js` Phase 4 hint dropped.
  - `clients.test.jsx` + `money.test.js` — 67 frontend tests all passing.

Exit criteria met:

- `npm run verify` green: lint, format, 67 frontend tests, 88 backend tests,
  production build.
- `GET /api/v1/health` reports `phase: 4` on the running dev server.
- Browser smoke: `/clients` renders the list, search/filter works, New client
  opens the form, edit/archive/restore flow works, `/clients/:id` renders the
  detail page with totals and document links.

## Phase 5 - Quotation engine (core)

Quotations, items and counters; the calculation service (`PLAN.md` 10) and
numbering service (`PLAN.md` 12) as the single source of truth; lifecycle and
`allowed_actions`; the quotation editor with live totals and autosave; list and
detail pages; duplicate.

## Phase 6 - Quotation document / PDF

`DocumentPaper` and the print routes from `PLAN.md` 14, preview overlay, terms
snapshot, signatory and footer, multi-page rules, wordmark fallback.

## Phase 7 - Invoice system

Quotation-to-invoice conversion and invoice management.

## Phase 8 - Payments & financial tracking

Payment recording, allocation and financial reporting.

## Phase 9 - Dashboard & analytics

Dashboard metrics, charts and recent activity.

## Phase 10 - PWA / mobile optimization

Offline behaviour, install prompts, update flow, mobile performance.

## Phase 11 - Security, validation & edge cases

Final validation pass, hardening and the explicit edge cases in `PLAN.md` 21.

## Phase 12 - Full testing & production readiness

End-to-end coverage, accessibility and performance audits, deployment.
