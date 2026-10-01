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
| 7     | Invoice system                      | **Done**    |
| 8     | Payments & financial tracking       | **Done**    |
| 9     | Dashboard & analytics               | **Done**    |
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
- The shell sidebar is collapsible to an icon-only rail, with the state persisted
  locally in `useSidebarCollapsed` (`ri.sidebar.collapsed`), mirroring the `useTheme`
  pattern. Desktop-only: the sidebar is hidden below `lg`, where the bottom bar is
  used instead. Collapsed labels stay in the DOM behind CSS so accessible names are
  preserved, with `title` and `aria-label` fallbacks on every control.

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

Post-delivery correction:

- A fixed discount larger than the subtotal reached `calculate_discount` during the
  totals recompute, where it raises a bare `ValueError`. Nothing caught it, so the
  generic handler returned `500 INTERNAL` for what §10.3 specifies as an ordinary
  validation failure. `validate_document` now rejects it before the recompute runs,
  using the same line math, so the API returns `422 VALIDATION_ERROR` with
  "Discount cannot exceed subtotal". Covered by
  `test_fixed_discount_exceeding_subtotal_is_422`, verified to fail on the pre-fix
  service. `calculate_discount` keeps its guard as defence-in-depth.

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

## Phase 7 - Invoice system (done)

Quotation-to-invoice conversion and invoice management.

Delivered:

- Backend: `PHASE=7` bumped in `settings.py`; `GET /api/v1/health` reports
  `phase: 7`. **No migration** — Phase 3 already created `invoices`,
  `invoice_items` and `payments` with the partial unique index, and Phase 5 wrote
  the conversion endpoint and the invoice state machine.
- `services/invoices.py` (new) — the invoice business rules, with the conversion
  moved out of the quotations blueprint into it so the API layer stays thin (§23):
  - `payment_status()` and `paid_paise_for()` are the **single definition** of
    paid/outstanding (§11). `clients.py` now imports them instead of keeping its
    own copy, so a client summary and an invoice page cannot disagree.
  - `payment_status_predicate()` expresses the same three-way comparison as a
    correlated SQL subquery, so `GET /invoices?payment_status=…` filters in the
    database rather than loading every invoice and filtering in Python (§5's
    pagination and latency budget).
  - `serialize_invoice()` populates the four computed fields the schema declares
    but nothing produced (`paid_paise`, `outstanding_paise`, `payment_status`,
    `allowed_actions`).
  - `update_invoice_draft()`, `issue_invoice()`, `cancel_invoice()`.
  - `convert_quotation()` — the snapshot, the numbering, and the §11 safety
    assert.
- `api/invoices.py` (new) — list (search by number or client, payment-status
  filter, date range, sort, pagination), detail, draft update, issue, cancel.
  There is deliberately no `POST /invoices`: an invoice only exists by converting
  an approved quotation (FR-I1), and — at this phase — no `/payments` routes
  (delivered in Phase 8).
- Frontend: `api/endpoints/invoices.js`, `features/invoices/` (`useInvoices`,
  `InvoicesPage` with the payment-status filter, `InvoiceDetailPage` with an
  Amount Paid / Outstanding strip, draft-field editing and payment history, and
  `status.js`).
- `DocumentPaper` gained a `docKind` prop. `quotation` is the Phase 6 path,
  unchanged; `invoice` adds issue/due dates in place of date/validity, **Amount
  Paid** and **Balance Due** below the grand total, and a bank/UPI block built
  from `bank_snapshot`. The signatory now comes from `doc.signatory_name` when the
  document has a snapshot, falling back to live Settings for a quotation — so an
  invoice prints what it snapshotted and a quotation still reads Settings (§8.4).
- `InvoicePreview` overlay and `/print/invoice/:id`, sharing the `PrintQuotation`
  shell with `/print/quotation/:id`; `useAutoPrint` and the toolbar are shared.
- Two dead invoice-creation links fixed, because they became actively misleading
  once invoices existed: the client detail page pointed at `/invoices/new`
  (a route that never existed) and the mobile "New" sheet offered "New invoice".
  Both now reflect FR-I1 — invoices originate from approved quotations.

Decisions taken, and why:

- **The duplicate-conversion check runs before the status check.** After a
  conversion the quotation is `converted`, so checking status first answered every
  second attempt with a bare 422 and made the 409-with-invoice-id unreachable —
  the one response that lets the UI offer "View invoice" (§9.2, §25).
  `test_convert_twice_conflicts` was changed from asserting 422 to asserting 409
  plus the `invoice_id`/`invoice_number` in `details`; the old assertion was not
  preserved just because it was green.
- **Conversion independently recomputes its totals** from the items it is copying
  and compares them against the quotation's stored figures, per §11. A mismatch
  raises `ConversionSafetyError` before anything is committed, so the invoice, its
  items and the allocated number all roll back together; the API answers
  `500 INTERNAL` with a generic message and a logged error id (§16).
- **`due_date` stays nullable with no default.** §8.3 gives invoices a `due_date`
  but `company_settings` no due-days column, so adding one would contradict the
  schema. It is editable while the invoice is Draft. No migration was added.
- **`record_payment` and `duplicate`/`delete` get no buttons.** The lifecycle
  service advertises them for an invoice, but Phase 7 implements no endpoint for
  any of them, so `INVOICE_ACTION_META` maps only `issue` and `cancel`. The detail
  page skips unmapped actions, which is the same pattern the quotation detail page
  already uses, so a button can never appear for something the API would reject.
- **Payment history renders an explicit empty state** saying payments are not
  recorded yet, rather than an empty list that looks like a bug.
- **The invoices list still serializes row by row (known, not urgent).**
  `serialize_invoice` issues one `SUM` per invoice and, for an issued invoice, a
  lazy load of `invoice.payments` behind `allowed_actions` — roughly two extra
  queries per row, so the list costs O(page_size) queries rather than O(1). The
  `payment_status` *filter* is unaffected: it already runs in SQL as a correlated
  subquery, so this is a serialization cost and not a filtering one. Bounded by
  `page_size <= 100` on local SQLite. The fix, when the list needs it, is one
  grouped `SUM` over the page's invoice ids plus an eager load of `payments` for
  the rows whose `allowed_actions` touch it.

Bug found and fixed in the pre-existing scaffolding:

- `validate_invoice_transition` consulted only the per-action guards, never the
  transition table, so `ISSUE` and `CANCEL` skipped their status gate entirely:
  issuing an already-issued invoice returned 200. Now the table is consulted first,
  mirroring `validate_quotation_transition`, with three tests added at the service
  level.

Exit criteria met:

- `npm run verify` green: lint, format, 157 frontend tests, 211 backend tests,
  production build.
- `GET /api/v1/health` reports `phase: 7`.
- Full lifecycle covered by tests: approved → convert → draft → issue → locked;
  cancel → quotation released to `approved` → re-invoiceable with a fresh number;
  cancel refused once a payment exists; duplicate conversion → 409; conversion
  safety assert; snapshot immutability against both quotation edits and Settings
  edits; payment-status filtering for all three states, plus an agreement test
  between the SQL predicate and the computed field.

Deferred to Phase 8 (now delivered): payment recording, editing and deletion, the
payment sheet, and the collection workflow. Throughout Phase 7 the invoice
surfaces read the `payments` table so the status and outstanding figures were
already real, but nothing could create a payment yet.

## Phase 8 - Payments & financial tracking (done)

Payment recording, allocation and financial reporting.

### Implemented

Payments are **derived, not stored**. `Invoice` has no `payment_status` column:
`payment_status()`, `paid_paise_for()` and `payment_status_predicate()` in
`services/invoices.py` remain the single definition of the figures, and Phase 7
already read them. A payment is a row; the status, the amount paid and the
outstanding are all computed from the rows every time the invoice is serialized,
so there is no second copy to fall out of date.

- **Migration** `a7c4e19b2d80` adds `company_settings.payment_qr_path`. Nothing
  else changed: `payments` already exists from Phase 7.
- **`services/payments.py`** — `record_payment`, `list_payments`, `get_payment`
  and `delete_payment`. Every mutation returns the re-serialized invoice so the
  client never recomputes a figure locally.
- **Routes** `GET`/`POST /invoices/:id/payments` and `DELETE /payments/:id`, all
  `@login_required` + `@csrf_protect`.
- **`Invoice.payments`** is ordered `paid_on DESC, id DESC`, so the history list
  is deterministic even when two payments land on the same day.
- **Frontend** — `PaymentSheet` (prefilled with the outstanding balance, live
  overpayment warning, all six methods), a real payment history with per-row
  delete, and an explanation of why Cancel disappears once a payment exists
  (§11 forbids cancelling a paid invoice, so the action stops being advertised).
- **`invoices.payment_method`** (FR-P8, migration `b8d5f0e2c7a1`) — the admin's
  choice of which payment instructions the document prints, settable only while the
  invoice is a Draft. See the FR-P8 decisions below.

### FR-P8: the invoice's payment presentation

Two fields that both sound like "the payment method" and are deliberately not the
same thing:

- **`invoices.payment_method`** — *how payment options are presented on the
  document.* `NULL` (`'upi' | 'bank_transfer' | 'cash'`), frozen at issue.
- **`payments.method`** — *how the client actually paid.* Free to differ, and free
  to differ twice on one invoice.

The document renders exactly one of four presentations, and the ledger is never
consulted for it:

| `payment_method` | printed |
|---|---|
| `upi` | UPI ID, payee, 26mm QR, "Scan to Pay". No bank details. |
| `bank_transfer` | account holder, bank, account number, IFSC. No QR, no UPI ID. |
| `cash` | `Payment Method: Cash` and nothing else. |
| `NULL` | both electronic rails. Cash is never offered as a default. |

#### Decisions

- **A nullable column, not a `bank_snapshot` key.** A payment presentation is a
  first-class document fact, so it gets a `CHECK` constraint in the database
  (`ck_invoices_payment_method`) rather than a string in a JSON blob. `NULL` is the
  Not-Selected state, so the migration is purely additive and needs no backfill.
- **The existing draft-only guard is the whole freeze mechanism.**
  `update_invoice_draft` already refuses any edit unless `status == 'draft'`, so
  adding the field to its whitelist is sufficient; there is no second lock and no
  ledger code path that can reach it.
- **The invoice's QR encodes the grand total, not the outstanding balance.** An
  outstanding amount is unknowable at issue and moves with every payment, so
  encoding it would mean a reprint of the same document asked for a different sum —
  the one thing §8.4 exists to prevent. Collecting a reduced figure is the Balance /
  Payment Due document's job, and that document is regenerated per payment. The
  sheet's "verify the amount before paying" is what makes a stale reprint safe.
- **`latest_payment_method` is no longer printed.** It is derived from the ledger,
  and putting it on a permanent document is exactly the confusion the split removes:
  a sheet that silently re-presents itself in the method it was last paid by. It
  remains in the API for the application UI.
- **A narrower vocabulary than `payments.method`.** Cheque, card and other are real
  ways to be paid but are not instructions to print, so the invoice's `OneOf` is
  `upi / bank_transfer / cash` only.
- **A misconfiguration prints nothing rather than something wrong.** A `upi` invoice
  with no UPI ID configured prints no rail at all; it does not fall back to bank
  details, because that would contradict the choice on the document.

### Decisions

- **The payment QR is never snapshotted.** This is the one deliberate exception to
  §8.4's immutability, and it is deliberate enough to spell out. Everything else
  in `bank_snapshot` is frozen because it states the terms the invoice was issued
  under, so a reprint must keep saying the same thing. A QR is not a statement of
  terms — it is an instruction to send money somewhere. Owners change bank
  accounts and close UPI handles; a frozen QR would keep directing customers to an
  account that no longer exists, which is a worse failure than a document that
  does not match the Settings page byte for byte. The QR is therefore read live
  from `CompanySettings` on every render, and `payment_qr_path` is absent from
  `bank_snapshot` by design — pinned by a regression test in `test_invoices_api.py`.
- **Invoices only.** A quotation is not payable, so it never shows a QR. It is a
  subsection of the existing Payment Details block rather than a sibling of it, so
  the bank layout does not change for anyone who has not set a QR.
- **Overpayment is rejected, not clamped** (422), in the service and again in the
  UI. The sheet blocks the submit and explains why, but the server is the
  authority: the outstanding is re-read inside the write, and the post-insert
  total is what the server commits against. The two reads share one transaction,
  so that re-read is defence-in-depth rather than the concurrency guarantee —
  what stops two concurrent payments from both landing today is SQLite's
  single-writer model, since the second writer's pre-check runs after the first
  commits. An MVCC port (Postgres, MySQL) would need a row lock on the invoice
  instead.
- **The QR reuses the logo's upload policy** rather than a second copy: same
  formats, same 2 MB cap, same extension + MIME + magic-byte + decode gauntlet,
  in its own `payment-qr/` subdirectory so clearing a logo can never unlink a QR.

### Not done

- Allocation of one payment across several invoices, and ageing / receivables
  reporting — §8.5 lists these, and they remain open.

Exit criteria met:

- `npm run verify` green (lint, format, frontend tests, backend tests, production
  build): 188 frontend tests, 249 backend tests.
- `GET /api/v1/health` reports `phase: 8`.
- Advance / multiple partials / exact full / overpayment 422 / delete-recalculates,
  plus draft and cancelled rejection, zero amount, invalid method, all six
  methods, CSRF guards, and a concurrent-overpayment rollback guard.
- QR: upload, serve, replace-without-orphan, delete, `payment_qr_path`
  non-writable via `PUT /settings/company`, logo/QR slot independence, and the
  document renders it only on invoices, only inside the payment block, and drops
  the subsection entirely if the image fails to load.

## Phase 9 - Dashboard & analytics (done)

Truthful business overview.

### Implemented

- **`services/dashboard.py`** — the whole aggregate. Every figure is a
  `SUM()`/`GROUP BY` over the four tables; nothing is loaded to be added up in
  Python.
- **`GET /api/v1/dashboard/summary`** — one response powering the entire page
  (§9.2 "one request, one query set"). `@login_required`, read-only, no
  `@csrf_protect`.
- **Frontend** — `api/endpoints/dashboard.js`, `features/dashboard/useDashboard.js`,
  a new `MetricCard`, the real Dashboard page, and a shared `RecentList` for the
  three FR-D2 lists. Tiles, two charts, three recent lists.
- **Charts** — Recharts (PLAN §1.2), 12-month invoiced-vs-received trend and a
  quotation status breakdown. Colours are read from the existing §18.8 chart
  tokens at render time, so they follow the dark theme.
- **No migration.** Nothing in the schema changed, and nothing needed to: §8.3
  already stored every field the dashboard aggregates.

### Decisions

- **Everything derives from existing authoritative definitions.** `BILLED_STATUS`
  decides which invoices count toward money and `_paid_paise_expr()` computes
  "paid", both imported from `services/invoices.py`. No payment-status or
  invoice-money rule is restated here, and `test_summary_rows_agree_with_the_
  invoice_detail_api` cross-checks each dashboard row against
  `GET /invoices/:id` so a second implementation could not survive.
- **Aggregated in SQL, not in Python.** `services/clients.py` sums a single
  client's rows in Python, which is right for one client and wrong here; copying
  it would have loaded every invoice to add it in Python. §5's response budget
  applies.
- **`total_quotation_value` is every quotation, all five statuses** (D2). §9.2
  lists it beside the per-status values without qualifying it, so the total is
  the total — not the approved slice. Asserted on its own so the choice cannot
  drift silently.
- **The browser computes no totals.** The page renders the server's paise figures
  verbatim. The only arithmetic on the client is `shortRupees`, which shortens a
  figure for a chart axis — a unit change, not a total.
- **Recharts is code-split.** It is the only charting dependency and by far the
  heaviest. Inlined, it pushed the entry chunk from 138 KB to 252 KB gzip, which
  every route would have paid for including `/login`. The chart section is
  `lazy()`-loaded, leaving the entry at **140 KB gzip** and a separate 112 KB
  chunk fetched only when the Dashboard opens. The skeleton lives in its own
  module precisely so importing it does not defeat the split.
- **No entry animation on the charts.** §18.10 requires "no entrance animations
  on data"; Recharts animates series in by default, so this is the design rule as
  much as a testability choice.
- **A failure that can be acted on is named as such.** A 5xx is reported as "the
  server returned an error — it is running, but the request failed", distinct from
  an offline message. Same reasoning as the Phase 8 audit fix: a pending migration
  once made every request 500 while the page insisted the API was down.

### Known limitations, deliberately not addressed

- **No indexes on the grouped columns** — none exist on `quotations.status`,
  `quotations.quotation_date`, `invoices.status`, `invoices.issue_date`,
  `payments.paid_on` or any `created_at`, so the aggregates scan. Fine for a
  single-user SQLite database at realistic volume; measured before adding a
  performance-only migration, which §1.3 and PLAN do not ask for.
- **No date range.** §9.2 defines no query string for this endpoint, so none is
  accepted. The figures are whole-of-business totals, not a filtered view.

Exit criteria met:

- `npm run verify` green: lint, format, 256 frontend tests, 310 backend tests,
  production build.
- All §24 boxes satisfied and individually tested: every §9.2 field present and
  correct on the seeded scenario; drafts excluded from money metrics and cancelled
  invoices excluded; `received` = Σ payments only; recent lists navigate to the
  right places; charts render the 12-month series; one request powers the page; the
  mobile layout is a single column below 768 px with no horizontal scroll.
- The §24 gate "dashboard numbers match a hand-computed scenario exactly" is a
  literal test: `SCENARIO_TRUTH` in `tests/test_dashboard.py` states the expected
  counts, values and money figures as hand-written constants, and the whole-dict
  assertions mean a newly added figure cannot slip in unverified. The scenario
  deliberately places a payment in a different month from its invoice, so the
  `issue_date` / `paid_on` distinction is observable rather than assumed.


## Phase 9A - Services catalog (SERVICES_PLAN.md)

Standard rate card with an "add from services" picker for the quotation editor.
Phase 9A sits between Phase 9 and Phase 10 so the Phase 10–12 sweeps cover it.

### Implemented

- **Model & migration** `b1f2a3c4d5e6` — the `services` table (name, category,
  description, unit, `default_qty_milli`, `rate_paise`, `archived_at`) with CHECK
  constraints (rate > 0 per S3, qty ≥ 0), the `(archived_at, category, name)` list
  index, and a **partial unique index on `lower(name) WHERE archived_at IS NULL`**
  (FR-SV3). The same migration adds `service_id` (FK RESTRICT) and
  `catalog_rate_paise` to `quotation_items` and `invoice_items` — nullable, **no
  backfill**, batch mode with a *named* FK so the downgrade can drop it.
- **API** under `/api/v1/services` (mirrors `clients`): list (search by
  name/category/description, category filter, `include_archived`, pagination,
  sorted category then name per FR-SV4), create, read (archived resolves), update,
  delete (**archive**, never hard-delete, S5), restore (409 on active, 409 on a
  name collision). Mutations are `@login_required` + `@csrf_protect`.
- **Item provenance** (S7): `service_id` / `catalog_rate_paise` ride on quotation
  items through PUT (unknown id → 422, archived id accepted per edge case 2), are
  copied by duplicate and by conversion onto `invoice_items` (FR-SV8), and are
  serialized read-only on invoices. They never enter `calculations.py` —
  `test_calculations.py` is untouched and green, which is the proof.
- **Frontend** — `api/endpoints/services.js`, `useServices` (shared fetch path for
  page and future picker, the `useClients` pattern), `validateService` in
  `lib/validation.js` mirroring the backend schema (rate > 0, caps),
  `ServiceForm`/`ServiceFormModal` (with the FR-SV5 helper text on edit:
  "Changes apply to new quotation lines only"), and `ServicesPage` — debounced
  search, a category chip scroller fed by a `categories` facet on the list
  response (the one permitted horizontal scroll, §7), archived toggle with
  Restore, archive confirmation, rate formatted via `formatPaise`, `?new=1`
  deep link. Category/unit suggestions come from the existing Settings →
  Catalogue lists (S6).
- **Navigation** — `/services` in the desktop sidebar; on mobile it rides in the
  More sheet because the bottom bar's five slots are full (§6).

### Decisions

- **Rate card, not price list (S1/S2).** The catalog stores the *standard* rate;
  the line stores the *agreed* rate, editable per line. Editing a catalog rate can
  never touch an existing quotation or invoice — pinned by
  `test_editing_catalog_rate_never_changes_existing_documents` and the converted-
  invoice variant.
- **Archive-only (S5).** Old lines keep a RESTRICT FK to the service; a hard
  delete is never exposed, exactly like clients (FR-C4).
- **No seeded rates (S9).** The owner's real prices are not known; the page ships
  empty with an empty state.
- **No per-service GST (S4).** GST stays document-level (`gst_bp`), untouched.

### Not done (deliberate, per SERVICES_PLAN §1)

- `ServicePicker` and the "Add from services" button in the quotation editor —
  SERVICES_PLAN build order 9A.3, delivered separately so the page can be reviewed
  first.
- The optional CSV import CLI (FR-SV9, build order 9A.4).

### Exit criteria met

- Backend: 42 new tests in `test_services.py` + the migration-cycle assertions in
  `test_seed_and_migrations.py`; full suite 392 green, including an untouched
  `test_calculations.py` (S7).
- Frontend: `validateService` matrix + navigation contract tests.
- Migration down/up verified on an empty database through the existing cycle test.

## Phase 10 - UPI QR and the Balance / Payment Due document

Delivered after Phase 9. FR-P6 amended, FR-P7 added.

### What changed and why

Phase 8 printed a **static** UPI QR image the owner uploaded in Settings. The
stated reason (PLAN 12) was deliberate: a static image "cannot track amount or
status". That reasoning is correct about *verification* and wrong about *amount*,
and the second half turned out to matter.

An uploaded QR cannot carry an amount, so a customer's own printed copy of a
partly-paid invoice asks for the original total. They scan it, their app asks for
1,00,000 when 60,000 is owed, and the business either collects too much or explains
the discrepancy. The QR is now **generated** from a UPI intent URI:

    upi://pay?pa=<upi_id>&pn=<payee>&am=<outstanding>&cu=INR&tn=<invoice number>

- `am` is the **outstanding balance**, not the invoice total, read live from the
  payment ledger. A printed invoice can no longer over-collect.
- It is built in one place, `services/calculations.build_upi_uri`, and
  `format_upi_amount` renders it with integer arithmetic only. `paise / 100` in
  Python or JavaScript gives "6000.499999999999" for some values, and a QR that
  asks for a fraction of a paisa less than the invoice is a collection bug nobody
  spots by eye.
- It returns `None` rather than a URI with an empty or zero `am` when the VPA is
  missing or the amount is not positive, so the card falls back to showing the UPI
  ID as text. A code that opens a payment app asking for nothing reads as broken.
- The UPI ID and payee name stay **live from Settings, never from `bank_snapshot`**
  (the 8.4 exception Phase 8 already made for the QR). A closed account must not
  stay on already-issued documents.
- The Settings upload control is gone. `upi_id` is validated for *shape* only - an
  "@", text either side, no whitespace, 100 characters - and deliberately not
  against a provider allow-list, because a VPA's suffix is not an enumerable set
  and rejecting a real one would block a real payment. The rule applies on write
  only, so an older install with a now-invalid value still starts and still reads.

### The Balance / Payment Due document (FR-P7)

`GET /api/v1/invoices/:id/payment-due` renders a printable reminder for an
invoice's remaining balance. It is **a read**:

- No `invoices` row, no `payments` row, no stored balance. `payment_due_document()`
  re-derives `grand_total_paise - Σ payments` on every call and writes nothing.
- That matters because `services/dashboard.py` and `services/clients.py` both sum
  `invoices.grand_total_paise`. A persisted "balance invoice" would add a second
  60,000 to revenue. `test_generating_a_balance_document_writes_nothing` counts both
  tables and the revenue sum before and after, and fails first if that ever changes.
- **No document number of its own.** `numbering.py` allocates per
  `(doc_type, year)`, so a `PD-` prefix would need a new counter - and a second
  number on a collection notice reads as a second billing document, which is the
  confusion it exists to avoid. It is headed by the invoice it concerns.
- Refused with 422 when the invoice is not issued (a cancelled one must never
  produce a demand) or when nothing is outstanding (a fully paid invoice has no
  balance, and a 200 with a zero amount would let a client render a 0 QR).
- The QR encodes the balance **at generation time**. A later payment changes the
  real figure and the next document reflects it; a printed copy does not, which is
  why the sheet prints "Verify the amount before paying." rather than presenting
  itself as authoritative.

### What it deliberately is not

Scanning the QR, or opening the UPI app, **records nothing**. There is no webhook,
no reconciliation and no new status. `payment_status` stays derived from the ledger
(unpaid / partially_paid / paid) and moves only through Record Payment. The card
and the document both say this in words, because a rendered QR reads like a receipt
to anyone who has not been told otherwise.

`payment_due_notices` - a table recording that a reminder was sent - is future work
and is deliberately absent. A payment reminder is a snapshot, not an accounting
event, and nothing in 11 needs to know one was printed.

### Also in this phase

- `@csrf_protect` added to the four mutating `/settings` routes. They were the only
  non-GET mutations in the app without it, and it stopped being cosmetic when this
  blueprint started carrying the UPI ID and bank details - a cross-site request
  could otherwise rewrite where customers are told to send money.
- `qrcode` (npm) is the only dependency added. Pure JS, no native build, renders to
  a canvas at any size - which is what keeps the printed code sharp instead of
  resampling a screenshot.

### Exit criteria met

- `npm run verify` green: lint, format, 301 frontend tests, 342 backend tests,
  production build.
- The amount invariant is pinned on both sides. Backend: `am=60000.00` in the URI
  for a 60,000 balance, and the ledger counts unchanged after generating. Frontend:
  the displayed figure and the encoded figure come from one `amountPaise`, there is
  a test that a re-render with a new amount never leaves the old code on screen, and
  one that the card encodes exactly what `lib/upi.js` produces.
- Refusal paths covered: cancelled, draft, fully paid, no UPI ID, malformed VPA,
  overpayment (already rejected by `record_payment`, so a balance cannot go
  negative).

## Bugfix - Client detail related data (FR-C3)

The client detail page fetched `GET /clients/:id/summary` and then read a
response shape the service has never produced. Selecting a client therefore
showed a profile, six zeroed totals and three placeholder lines, and never a
single quotation, invoice or payment - the data was in memory the whole time,
just read under keys that did not exist.

### Root cause

`services/clients.py` returns
`{ client, quotations[], invoices[], payments[], totals: { billed_paise,
received_paise, outstanding_paise } }`. The page read `quotations_count`,
`invoices_count`, `payments_count`, `total_quotations_value`,
`total_invoices_value` and `total_payments_value` - none of them server
fields. `formatPaise(undefined)` is `₹0.00`, so a total of nothing looked
exactly like a total of zero, and a fabricated defaults object at the top of
the render stood in for the real payload and hid the mismatch rather than
surfacing it. `clients-page.test.jsx` could not catch it: the list page never
reads the summary.

No backend change was needed. `test_clients.py::test_summary_totals_with_seeded_rows`
already pinned the contract (billed 50000, received 20000, outstanding 30000
paise, `partially_paid`), and the API was returning it correctly throughout.

### Fixed

- The page now reads the service's own field names, and the three money
  figures come from `totals`. No figure is recomputed in the browser - derived
  values (`paid_paise`, `outstanding_paise`, `payment_status`) stay the
  server's (§11, D2), so a client page and an invoice page cannot disagree.
- Quotations, invoices and payments render as real card rows reusing the
  `InvoicesPage` pattern, linking to `/quotations/:id` and `/invoices/:id`.
  Rows are keyed on the record ids; nothing matches on client name.
- **Stale data on switching is closed.** The previous client's `client` and
  `summary` are cleared when the route's id changes, before the next fetch, so
  a slow response cannot leave the previous client's figures on screen. The
  superseded request is also dropped by the existing `cancelled` guard.
- The profile and the summary are now separate outcomes (`allSettled`). A
  failed summary degrades to empty sections with an inline `role="alert"`
  instead of blanking a client that loaded fine.
- `useClients()` removed from this page. It was called only for `refetch()`,
  which fired a `/clients` list request the page never read and which did not
  refresh the summary. Archive, restore and edit now re-read this client, so
  the archive badge and the figures cannot disagree with the server.
- Archived clients keep their totals and history. The page previously hid the
  whole totals strip for an archived client, which made a real balance
  invisible on the client's own page; FR-C4 archives to hide a client from
  lists and pickers, not to erase what they owe.
- Loading, empty and error states use the shared `Skeleton` and `EmptyState`.
  The quotation empty state links to `/quotations/new?client={id}`, so the new
  quotation opens against the right client. The invoice empty state still
  explains FR-I1 rather than pointing at a route that does not exist.
- The profile name is no longer a second `<h1>`; `PageHeader` owns the page
  heading (§18.2) and the profile name is an `<h2>`.

### Tests

New `client-detail.test.jsx` (16 tests) - the coverage whose absence let this
ship. The figures are asserted against the same numbers the backend test
asserts against seeded rows, so the two cannot drift. Two clients with
near-identical names prove records are scoped by id rather than by name; a
route change proves the first client's data is gone rather than merely
outnumbered. Re-reading the totals under the old, wrong key names fails 3 of
the 16, which is the regression this file exists to prevent.