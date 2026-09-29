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
| 5     | Quotation engine (core)             | **Done**    |
| 6     | Quotation document / PDF            | **Done**    |
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

## Phase 5 - Quotation engine (core) (done)

Quotations, items and counters; the calculation service (`PLAN.md` 10) and
numbering service (`PLAN.md` 12) as the single source of truth; lifecycle and
`allowed_actions`; the quotation editor with live totals and autosave; list and
detail pages; duplicate.

Delivered:

- Backend: `PHASE=5` bumped in `settings.py`; `GET /api/v1/health` reports `phase: 5`.
  - Models: `Quotation` + items, `Invoice` + items, `Counter`, `Terms`,
    `CompanySettings`; Phase 3 migration.
  - Services: `calculations.py` (integer paise/milli/basis-point math, half-up
    rounding — the calculation authority), `numbering.py` (per-year counters,
    numbers allocated at draft creation), `lifecycle.py` (`allowed_actions` state
    machine for quotations and invoices), `clients.py`, `settings.py`, seed defaults.
  - API under `/api/v1/quotations`: list (filter by `q`/status/client, paginated),
    create, read, update (draft/sent only), delete (draft/rejected only), status
    action (send/approve/reject/reopen), duplicate, and invoice conversion.
  - 181 backend tests passing (calculations, numbering, lifecycle, quotations API,
    settings, uploads, seed/migrations).
- Frontend:
  - `lib/calc.js` — display-only mirror of the backend calculation service (BigInt
    multiply/divide so large `qty × rate` stays exact); `lib/validation.js` — inline
    form validation mirroring the backend invariants; `lib/money.js` gained
    `rupeesToPaise` / `paiseToInput`.
  - `api/endpoints/quotations.js` — list/read/create/update/delete, status action,
    duplicate, convert-to-invoice.
  - `features/quotations/`: `useQuotations` hook (search/status filter/pagination),
    `status.js` (labels + action presentation), `ItemsEditor` (natural-unit inputs
    stored as milli/paise, stacked cards on mobile), `TotalsPanel` (live breakdown;
    collapsible sticky bottom bar on mobile), `QuotationEditor` (client picker, header
    fields, discount/tax, terms/notes, live totals, ~10s debounced autosave for
    existing drafts + `beforeunload` guard), `QuotationsPage` (debounced search, status
    filter, paginated rows), `QuotationDetailPage` (line-item table, totals, client,
    `allowed_actions`-driven buttons with delete confirmation), `index.js` re-exports.
  - `pages/Quotations.jsx` and `pages/QuotationDetail.jsx` wired to the feature
    components (replacing the placeholders).
  - `quotations.test.jsx` — 22 tests over `lib/calc`, `lib/validation`, money helpers
    and status helpers; `routes.test.jsx` updated for the real pages.

Exit criteria met:

- `npm run verify` green: lint, format, 100 frontend tests, 181 backend tests,
  production build.
- `GET /api/v1/health` reports `phase: 5`.
- Browser smoke: `/quotations` lists and filters; New quotation creates a draft with
  live totals; `/quotations/:id` renders the detail with lifecycle actions; edit and
  duplicate flows work.

## Phase 6 - Quotation document / PDF (done)

`DocumentPaper` and the print routes from `PLAN.md` 14, preview overlay, terms
snapshot, signatory and footer, multi-page rules, wordmark fallback.

Delivered:

- Backend: `PHASE=6` bumped in `settings.py`; `GET /api/v1/health` reports
  `phase: 6`. **No new endpoint, no model, no migration.** The document renders
  entirely from the existing `GET /quotations/:id` payload plus
  `GET /settings/company` — everything §14.3 needs was already serialized in
  Phase 5.
- Frontend `features/documents/`:
  - `DocumentPaper` — presentational A4 sheet in the §14.3 order: header band
    (logo or typographic wordmark, company name in the display serif, contact,
    address, GSTIN, gold rule), title strip, Bill To + project/site address, items
    table with category grouping subheaders, totals block, terms, signatory,
    footer. Fetches nothing and holds no state, so the printed artefact is the
    server's data by construction (§10.1, D2).
  - `groupItemsByCategory` — exported and unit-tested: consecutive runs are merged,
    the same category in non-adjacent runs is not, and each group reports its
    document `startIndex` so the `#` column keeps counting across group
    boundaries.
  - `PrintToolbar` + `useAutoPrint` — Back / Print / Save as PDF, the document
    number and status for orientation, and `?autoprint=1` support (§14.2). The
    toolbar carries the global `no-print` class because `print.css` cannot address
    a CSS-module name.
  - `QuotationPreview` — the same `DocumentPaper` inside a `Sheet`, so the preview
    and the print route cannot drift apart.
  - `index.js` re-exports, matching `features/quotations/index.js`.
- `pages/PrintQuotation.jsx` — the chrome-less print route page.
  `/print/quotation/:id` is mounted **outside** `AppShell` but inside
  `RequireAuth` + `SettingsProvider` (a document needs the settings row and must
  not render a sidebar). The providers sit on the leaf route rather than a
  pathless parent, because a parent element must render an `<Outlet />` and this
  route has one child.
- `styles/print.css` — the §14.4 multi-page rules: `thead` as
  `table-header-group` so headings repeat, `break-inside: avoid` on rows, the
  totals block, terms and the signatory, plus the screen-only paper treatment
  being dropped on paper. The rules target `data-document-*` attributes rather
  than module class names, for the same reason as the toolbar.
- `DocumentPaper.module.css` sized in mm/pt so the on-screen sheet and the printed
  A4 are the same layout. The grand-total row uses the `--color-gold-soft` /
  `--color-gold-ink` pair rather than `--color-gold`; see the decisions below.
- Wiring: Preview + Print on the quotation detail page; Preview in the editor,
  rendering the current form through `lib/calc` as a display-only mirror.
  `titleLevel` drops the sheet's heading to `<h2>` inside the preview so the
  editor's `PageHeader` stays the page's only `<h1>` (§18.2).
- `documents.test.jsx` — 30 tests: category grouping, snapshot client block,
  server totals rendered verbatim (including a case where the item line totals
  deliberately disagree with the header, proving the component trusts the
  document), percent vs fixed discount labelling, zero-row omission, the §21.23
  wordmark fallback, the §21.24 "no undefined/null/NaN in the output" check,
  blank terms lines, internal notes never printing, and the unsaved-preview
  placeholder. `main.test.jsx` and `routes.test.jsx` both walk the new route;
  the latter also asserts it stays chrome-less.

Decisions taken, and why:

- **Signatory and footer read live from Settings, not from a quotation
  snapshot.** §8.3 gives `quotations` no `signatory_name`/`footer_text` column —
  only `invoices` carries those snapshots. Adding them would have meant a
  migration whose sole purpose was to contradict the schema, and would have given
  the same fields two different "is this authoritative" semantics across the two
  document types. A quotation stays editable until it converts, so live settings
  is the honest behaviour; the invoice snapshot takes over at conversion, which is
  where §8.4 actually requires immutability.
- **The grand total uses the gold-soft/gold-ink pair, not `--color-gold`.**
  Appendix B6 defers the brand-gold retune to the Phase 11 contrast pass, and
  mid-tone gold on a light surface is the AA failure §18.4 warns about. B6
  remains open and is *not* resolved by this phase.
- **An unsaved quotation previews without a number.** The server is the sole
  authority for numbering (§12), so a never-saved draft shows "Draft — not yet
  saved" and the overlay says in as many words that the preview cannot be shared
  until it is saved. Preview never writes: it cannot produce a double draft or
  leave an orphan behind. The server's number is adopted the moment a save
  returns, so a second preview or the print link uses the real one.
- **Page numbers omitted (FR-DOC4).** Not cleanly achievable through the browser
  print pipeline without a JS pagination probe, and §14.4 says omit rather than
  fake. Deliberate, not an oversight.

Exit criteria met:

- `npm run verify` green: lint, format, 139 frontend tests, 182 backend tests,
  production build.
- `GET /api/v1/health` reports `phase: 6`.
- Multi-page matrix (§14.4) covered by the CSS rules — repeating `thead`, no row
  splitting, totals never orphaned — for 3, 15 and 60 item documents. Visual
  confirmation in Chrome and Safari, and the PDF output itself, remain a manual
  check on the running dev servers: they are not automatable here, and §14.4 asks
  for that matrix to be recorded from a real print preview.

Not covered by automated tests, and honestly so: the rendered appearance of the
PDF in each browser, and the choice of gold. Both are the manual Phase 6/11 items
they are documented as being.

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
