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

## Phase 10 - PWA / mobile optimization

Offline behaviour, install prompts, update flow, mobile performance.

## Phase 11 - Security, validation & edge cases

Final validation pass, hardening and the explicit edge cases in `PLAN.md` 21.

## Phase 12 - Full testing & production readiness

End-to-end coverage, accessibility and performance audits, deployment.
