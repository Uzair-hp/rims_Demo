# PLAN.md — Ruchita Interiors: Quotation, Invoice & Payment Management PWA

| | |
|---|---|
| **Status** | APPROVED — **Phases 1–10 are implemented and verified, plus a full end-to-end audit pass.** See §0 for the current COMPLETED / IN PROGRESS / REMAINING / FUTURE split. Appendix B records the decisions that supersede parts of this document (JavaScript-only frontend, plain CSS design tokens, no TypeScript, no Tailwind) and the Phase 2 deviations (B7–B9). |
| **Version** | 1.6 — 2026-10-01 (§0 implementation status added; phase list in the header corrected from "1–3 complete, Phase 4 next" to the true 1–10 state; status mirror in `docs/phases.md`, findings mirror in `full audit.md`) |
| **Client** | Ruchita Interiors — https://ruchitainteriors.in/ |
| **Product** | Internal, single-user business management PWA for quotations, invoices and payments |
| **Purpose of this document** | A complete, unambiguous implementation plan. Another developer/agent must be able to build the system phase-by-phase from this document alone, without rediscovering requirements. |

**How to use this plan:** Sections 1–23 define *what to build and why*. Section 24 defines *the order to build it in*, and Section 25 defines *when each phase is done*. An implementing agent should read Sections 8–16 (data, API, calculations, lifecycle) before writing any feature code — they are the contract.

---

## 0. Implementation status (2026-10-01)

Sections 1–23 remain the specification. This section records what the repository
actually contains today, so the plan is not mistaken for a work order. Phase
detail and per-phase acceptance criteria stay in §24–§25; the audit that produced
the hardening work below is `full audit.md`.

**Verification gates at time of writing:** frontend lint clean, Prettier clean,
**504 frontend tests / 29 files** passing, **496 backend tests** passing,
production build succeeding (PWA service worker generated).

### COMPLETED

**Phases 1–10.** Architecture & project foundation; authentication & user system;
database & company settings; client management; quotation engine; quotation
document/print; invoice system; payments & financial tracking; dashboard &
analytics; PWA/mobile optimisation. All four business surfaces (Clients →
Quotations → Invoices → Payments) work end to end, and print output is verified
against a real A4 layout engine (`scripts/print-check.mjs`, 6 document variants).

**Phase 9A — services catalog.** `services` table with a partial unique index on
`lower(name) WHERE archived_at IS NULL`; catalog provenance survives
quotation → convert → invoice; the Services page carries create/edit,
archive/restore, search and archived filtering.

**Phase 10 payments detail.** Payment QR generated from an intent URI in integer
paise, returning `None` rather than a zero-amount code, with three-level
degradation; bank details snapshotted at conversion and frozen at issue; the
account number printed exactly once per sheet.

**Services page layout rework.** The card is stacked in rows instead of one
crowded line, so a long name no longer runs under the price at narrow widths; the
name truncates with a two-line clamp, the price is `flex-shrink: 0` and never
wraps, and the search field gained a leading icon and a trailing clear control
with a `visually-hidden` label so it keeps its accessible name.

**Mobile navigation: bottom bar → left hamburger drawer.** `BottomNav` and its
More sheet are gone. `Sidebar` is now the single navigation plate rendered twice —
the fixed rail (`variant="desktop"`) and the drawer (`variant="drawer"`) — both
reading `NAV_ITEMS`, so destinations, icons, branding, active-route highlighting,
theme toggle and sign out cannot drift apart. The drawer adds a portal panel,
scrim, Escape handling, a Tab focus trap, background scroll lock, focus restore,
`role="dialog"` + `aria-modal`, and unmounts when closed so it is never a second
`Primary` navigation landmark. Net gain: mobile now reaches all six destinations,
including Services and Settings, which the five-slot bottom bar could not hold.
The removed `CREATE_ACTIONS` "New" slot now appears under a **Create** heading in
the drawer footer, sourced from the same constant the desktop FAB sheet uses.

**Drawer motion.** Opening is a `@keyframes` animation and closing a `transition`,
both on `--duration-slow` (220 ms) with `--ease-out`. The split is load-bearing:
the panel is mounted already carrying its open class, so a transition would have no
previous computed value and the drawer would appear rather than slide in, while
closing — which only removes that class from an element already on screen —
animated correctly. `prefers-reduced-motion` collapses both globally via
`base.css`.

**Responsive/mobile refinements.** The `lg` breakpoint (1024 px) is unchanged and
the desktop rail is untouched; the drawer renders only below it and auto-closes on
growth to desktop. Panel width is `min(248px, 86vw)`, safe-area insets are applied
to the drawer's leading edge, the removed bottom-bar content inset is gone, and the
top bar's leading grid track is content-driven so the hamburger and back link fit
without a fixed placeholder.

**Login fixes.** The lock icon is vertically centred by a dedicated
`.passwordIcon` rule (`inset-block-start: 50%` + `translateY(-50%)`) instead of
depending on the wrapper's alignment, which `.passwordWrap` does not set — it
previously sat at the top of the row beside the taller reveal toggle. The password
reveal toggle itself was already present.

**Audit hardening pass** (full detail and remaining findings in `full audit.md`):

- *Authorization* — a new `@owner_required` guard enforces `role == "owner"` on
  every settings route, on logo/payment-QR mutation, and on `PUT /auth/password`.
  `User.role` was previously read by nothing, so any second account that ever
  appeared in `users` was instantly owner-equivalent.
- *Security headers* — strict same-origin CSP, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, `Permissions-Policy`, and production-only HSTS.
  The pre-paint theme bootstrap moved from an inline `<script>` to
  `public/theme-boot.js` so the CSP can forbid inline script.
- *Production secrets* — `IS_PRODUCTION` now refuses to boot on a missing,
  placeholder, duplicated or under-32-character signing key, and `run.py` refuses
  `debug=True` in production (the Werkzeug debugger is an RCE surface).
- *Reverse proxy* — `ProxyFix` is applied when `TRUST_PROXY_HEADERS` is set, so
  scheme/host/remote address reflect the real client.
- *Uploads* — `MAX_CONTENT_LENGTH` plus a bounded read one byte past the limit, so
  the 2 MB policy is enforced before the body is buffered.
- *Data integrity* — invoice `PUT` no longer erases `notes`/`terms_text`/
  `payment_method`; the two company-settings CHECKs exist in the migration history
  (not just test databases) and every CHECK now has a name; `b8d5f0e2c7a1`'s
  downgrade rebuilds `invoices` by hand instead of failing on a foreign key;
  `allowed_actions` no longer advertises `duplicate`/`delete` with no route behind
  them; `save_settings` validates a merged candidate before writing anything and
  rolls back on failure; `CompanySettings.get_row()` flushes instead of committing
  on a GET path.
- *Service worker* — the 24-hour `runtimeCaching` of `GET /api/v1/*` is removed, so
  authenticated business data no longer sits in Cache Storage surviving logout. The
  app shell is still precached.
- *Rate limiting* — a single `RATE_LIMITED` producer that carries the wait into a
  `Retry-After` header.

### IN PROGRESS

- **Phase 11 hardening is partially complete.** The security checklist items in
  §16 are addressed; the §21 edge-case sweep, the §20 error/empty/loading audit and
  the a11y pass are not yet executed in full.
- **Documentation reconciliation.** `docs/api.md` now documents authorization,
  security headers and money units, but the ~24 business CRUD endpoints
  (`/services`, `/quotations`, `/invoices`, `/payment-due`) are still undocumented.
  `README.md`'s "Current Status" still contradicts `docs/phases.md`.

### REMAINING

| # | Item | Note |
|---|---|---|
| 1 | §21 edge-case sweep | Every row executed as fix + regression test. |
| 2 | Phase 11 exit gate | §16 checklist signed off; §20 states audit; a11y pass. |
| 3 | Missing indexes | `payments.paid_on`, `invoices.issue_date`, both `created_at` columns, all `created_by` FKs. Documented as deliberate; revisit past a few hundred invoices. |
| 4 | Quotation `notes` / `terms_text` length caps | Invoice draft is capped (4000/8000); **quotations are still uncapped**. |
| 5 | `outstanding_paise` clamping | Clamped in `payment_due_document`, not in `serialize_invoice`. |
| 6 | Duplicated money/line logic | Four copies of the "valid line" rule, three of the subtotal computation; no cross-check that the Python and JS UPI builders agree. |
| 7 | Dead code | `Quotation.archived_at`, `issue_tokens`, `ensure_csrf_cookie`, `round_paise`, `get_next_number_preview`, `validate_line`, `QuotationDuplicateSchema`, `PagePlaceholder.jsx`, `usePwaInstall.js`, `ServicePicker.jsx` (built, tested, never imported by `QuotationEditor`). |
| 8 | `clients.phone` uniqueness | Service-level 409 only; no unique index, unlike every other business invariant. |
| 9 | `sent` quotation re-pricing | `PUT` allowed in `sent`; a quotation the customer has seen can be changed. |
| 10 | Phase 12 production readiness | Playwright suite, coverage report, bundle budget, backup runbook, version tag. |
| 11 | Documentation | `docs/api.md` business endpoints; `README.md` status. |
| 12 | ~~`b8d5f0e2c7a1.downgrade()` is not atomic~~ | **Resolved.** Both hand-rolled rebuilds now open their own transaction and roll back together; each has a test that sabotages the `CREATE` and asserts the table is untouched. |

### FUTURE / OPTIONAL

None of these are commitments; each is listed in §1.3 as an explicit non-goal or in
§26 as a scaling consideration.

- Payment allocation across invoices (a payment currently applies to one whole invoice).
- Ageing / receivables reporting.
- `PUT /payments/:id` (editing a payment without delete + recreate).
- Invoice `delete` / `duplicate` routes — the state machine entries are retained as
  the specification for them; nothing advertises them today.
- CSV service import (deferred by `SERVICES_PLAN` §9A.4).
- PWA install prompt in the UI (`usePwaInstall` exists, unwired).
- Multi-currency (`INR` is hard-coded) and multi-user / roles.
- Dashboard date range (not designed; §9.2 defines no query string).
- Document page numbers (omitted by design, FR-DOC4).

---

## 1. Project Overview

Ruchita Interiors is an interior-design / interior-execution business. Today its quotation → approval → invoicing → payment workflow is manual. This project replaces it with a polished internal web application used by **one business user** (the owner).

The application is a **PWA**: installable, mobile-first, desktop-capable, with a visual identity derived from the Ruchita Interiors brand (gold / near-black / warm off-white).

### 1.1 Core value proposition
Take a client from first enquiry to fully-paid invoice in one system:

> LOGIN → DASHBOARD → CLIENT → QUOTATION (spaces, items, qty × rate, discount, GST, other charges) → PREVIEW → APPROVE → INVOICE (snapshot) → ADVANCE/PARTIAL PAYMENTS → OUTSTANDING TRACKING → PROFESSIONAL DOCUMENTS

### 1.2 Technology stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React 19 + JavaScript/JSX + Vite** | Component architecture, fast dev loop. **No TypeScript** (Appendix B, B1) |
| Styling | **Structured plain CSS + centralized CSS design tokens** + small custom component library | Brand-token driven; no CSS framework, no utility framework (Appendix B, B2) |
| Server state | **TanStack Query** | Caching, retries, loading/error states |
| Routing | **React Router** | Protected routes, print routes |
| Forms | **React Hook Form + Zod** | Zod schemas mirror backend validation rules |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest, precache, runtime caching, update flow |
| Backend | **Flask 3 (Python) REST API** | App-factory pattern, blueprints per domain |
| ORM/DB | **SQLAlchemy 2 + Alembic**, **SQLite (WAL mode)** | SQLite is the **final production database** (single-user app); accessed via the ORM so the codebase stays clean, not to enable a future migration |
| Validation | **Marshmallow** schemas + service-layer business rules | Backend is the source of truth |
| Auth | **JWT in httpOnly cookies** (access + refresh) + CSRF double-submit | See §16 |
| Passwords | **Werkzeug `generate_password_hash`** (scrypt) | Never plain text |
| Documents | **Browser print pipeline** (dedicated print routes + `@media print` CSS) | See §14 for rationale; server-side PDF is a future option |
| Charts | **Recharts** | Dashboard only, 2–3 charts max |
| Deployment | Single host: `gunicorn` + nginx (or local/LAN use) | SQLite file + `uploads/` directory are the whole data footprint |

### 1.3 Explicit non-goals (do NOT build)
- Multi-tenant SaaS, multi-user roles, employee logins (architecture must not block them — see §26 — but do not implement).
- Client portal, online approval, online payment gateway, email/WhatsApp sending (sharing a PDF via the OS share sheet is enough).
- Inventory, vendors, expenses, project management, purchase orders.
- Multi-currency, multi-language.
- Full offline read-write mode (see §17 for the offline policy).

### 1.4 Open questions (defaults chosen; confirm with client before Phase 5)
| # | Question | Default assumed in this plan |
|---|---|---|
| Q1 | GST default rate | **18%** (typical for interior works); configurable per document and in Settings |
| Q2 | Numbering resets per **calendar year** or **financial year (Apr–Mar)**? | **Calendar year** (`QTN-2026-0001`); FY switch is a Settings option added later if needed |
| Q3 | Can an invoice exist without a quotation? | **No** for v1 — invoices are always created from an approved quotation |
| Q4 | Brand assets (logo files, reference quotation screenshot) | Assumed to be provided before Phase 1 UI work; tokens in §18 are tuned then |
| Q5 | Is "Other charges" taxable? | **No** (GST applies to subtotal − discount only), one charge row per document in v1 |

---

## 2. Business Workflow

```
                    ┌──────────────┐
                    │    CLIENT    │
                    └──────┬───────┘
                           │ enquiry
                           ▼
                 ┌───────────────────┐   editable    ┌──────────────┐
                 │ QUOTATION (Draft) │◄──────────────│ Reopened Sent│
                 └────────┬──────────┘               └──────────────┘
                          │ Send
                          ▼
                 ┌───────────────────┐
                 │    QUOTATION Sent │──► Rejected ──► (archive / duplicate as new draft)
                 └────────┬──────────┘──► Expired (computed: valid_until passed)
                          │ Approve
                          ▼
                 ┌───────────────────┐   Create Invoice (one-time, snapshot)
                 │ QUOTATION Approved│──────────────┐
                 └───────────────────┘              ▼
                                        ┌─────────────────────┐
                                        │  INVOICE (draft)    │
                                        └─────────┬───────────┘
                                                  │ Issue (items lock)
                                                  ▼
                                        ┌─────────────────────┐
                                        │  INVOICE Issued     │◄─── Payments (advance /
                                        │  payment_status:    │      partial / full; many)
                                        │  unpaid → partial   │
                                        │  → paid             │
                                        └─────────────────────┘
```

**Invariants**
- One quotation → at most **one active invoice** (partial unique index; re-invoice allowed only after the previous invoice is cancelled).
- An invoice is an **immutable snapshot** of the approved quotation at conversion time; later quotation edits never change it (and approved/converted quotations are locked anyway — §13).
- Payments attach **only to issued invoices**. Outstanding = invoice grand total − Σ payments.
- Quotation value, approved value, invoiced value, received amount and outstanding are **separate metrics** — never summed together (§23).

---

## 3. User Workflow

**Primary flow (the 20-step happy path):**
1. Open app (PWA installed or browser) → session restored via refresh cookie, else Login.
2. Dashboard: current business position at a glance.
3. Clients → **New Client** (name, phone, email, address, project/site address, notes).
4. Quotations → **New Quotation** → pick client (searchable) → set dates, validity.
5. Add items grouped by space/category (Kitchen, Wardrobe, False Ceiling… — free-text categories with suggestion chips from Settings).
6. For each item: name, description, unit, quantity, rate → line total auto-calculated.
7. Reorder / remove items; totals update live (frontend mirror only).
8. Apply discount — segmented control **₹ fixed** or **%** — UI always shows which is active.
9. Set GST % (prefilled from Settings default) and optional "Other charges" (label + amount).
10. **Preview** → branded document view (print route inside a modal/overlay).
11. **Save Draft** (number allocated now — see §12) or save directly as Draft.
12. **Mark Sent** (validation gate: ≥1 valid line, valid totals).
13. Client approves → **Mark Approved** (confirmation dialog showing totals).
14. On the approved quotation: **Create Invoice** → system copies snapshot → invoice in Draft status, number `INV-YYYY-NNNN` allocated.
15. Review invoice (dates/notes/terms editable), **Issue** it → items lock.
16. **Record Payment** (advance): amount (prefilled with outstanding), date, method (UPI/Cash/Bank/Cheque/Card/Other), reference, notes.
17. Invoice shows Amount paid + Outstanding; status becomes Partially Paid.
18. Dashboard counters update: received, outstanding.
19. **Print / Download PDF** of invoice (branded, matches quotation design).
20. Repeat payments until Outstanding = 0 → status **Paid**.

**Secondary flows**
- **Rejected quotation:** status change with optional reason; user may **Duplicate as new draft** (new number) and revise.
- **Expired quotation:** expired state is *computed* from `valid_until` (§13); user can extend validity (revalidate) then approve, or archive it.
- **Edit after Send:** items are locked once Sent (integrity); user may **Reopen to Draft** (only if not approved/converted) to edit, then re-send.
- **Wrong invoice:** cancel invoice (only if no payments) → quotation returns to Approved and can be re-invoiced.
- **Delete payment:** allowed with confirmation; invoice payment status recalculates (correction flow; a full audit ledger is a future feature, §26).
- **Client archived:** hidden from pickers/lists, historical quotations/invoices remain fully intact (FK `RESTRICT` prevents hard delete when records exist).

---

## 4. Functional Requirements

Priority codes: **M** = must have (v1), **S** = should have (v1 if time allows), **F** = future only (not now).

### 4.1 Authentication
- FR-A1 (M) Login with email + password; hashed storage; show/hide password; inline validation; error and loading states.
- FR-A2 (M) Auth persistence across reloads/app restarts (refresh token cookie); auto-refresh on 401; logout everywhere-safe.
- FR-A3 (M) All pages and all `/api/v1/*` endpoints (except login/health) require authentication.
- FR-A4 (M) Single seeded account created from environment variables on first run (no signup).
- FR-A5 (S) Login rate limiting (5 attempts / 5 min per IP+username).

### 4.2 Clients
- FR-C1 (M) CRUD: name (required), phone, email, address, project/site address, GSTIN (optional), notes; created/updated timestamps.
- FR-C2 (M) Server-side search by name/phone/email (`q`); list sorted by most recently updated first (`updated_at` desc — the only client-side activity signal until documents arrive in Phase 5+).
- FR-C3 (M) Client detail: profile + tabs/sections for quotations, invoices, payment history, totals (billed, received, outstanding).
- FR-C4 (M) Archive (soft delete) with confirmation; **restore** from the client detail page clears the archive; hard delete blocked when quotations/invoices exist (a hard-delete endpoint is never exposed); archived clients excluded from lists and pickers but preserved in history and reachable at their detail URL.
- FR-C5 (M) Inline "create client" modal from the quotation editor (no context loss).

### 4.3 Quotations
- FR-Q1 (M) Quotation header: auto number, date, valid-until (default from Settings), client, status.
- FR-Q2 (M) Line items: category (free text + suggestion chips), name, description, unit (free text + suggestions), quantity (≤3 decimals), rate (2 decimals), auto line total; add / remove / reorder.
- FR-Q3 (M) Spaces/categories are **not hard-coded**; the suggestion list is configurable in Settings and any typed value is accepted and remembered.
- FR-Q4 (M) Discount: percent **or** fixed ₹, explicit type toggle, validation (0 ≤ discount ≤ subtotal).
- FR-Q5 (M) GST % (0–28, default from Settings) and optional other charges (label + amount).
- FR-Q6 (M) All totals computed by the **backend**; the frontend shows a live mirror for UX only and is never trusted.
- FR-Q7 (M) Status lifecycle Draft → Sent → Approved / Rejected, with Expired computed and Converted set by invoice creation (§13).
- FR-Q8 (M) Sequential numbering `QTN-YYYY-NNNN`, DB-guaranteed, never reused (§12).
- FR-Q9 (M) List with search (number, client name), filters (status, date range), sort (date/amount), pagination.
- FR-Q10 (M) Quotation detail: header info, items, totals, status timeline, actions per status, link to invoice when converted.
- FR-Q11 (M) Duplicate quotation (creates a new Draft copying client/items, new number).
- FR-Q12 (S) Notes field on quotation (internal, not printed) and a document-level terms override (editable per document without changing defaults).
- FR-Q13 (M) Draft quotations are hard-deletable (number retired); non-draft quotations are archive-only.

### 4.4 Invoices
- FR-I1 (M) Create invoice **only** from an Approved quotation; one active invoice per quotation; duplicate creation returns a clear 409.
- FR-I2 (M) Invoice inherits client, project, items, quantities, rates, discount, GST, other charges, totals — as a **snapshot** (§8.4).
- FR-I3 (M) Invoice-level fields editable while Draft: dates, notes, terms; items lock at Issue.
- FR-I4 (M) Sequential numbering `INV-YYYY-NNNN` independent from quotations (§12).
- FR-I5 (M) Invoice list: search (number, client), filters (payment status, date), sort, pagination.
- FR-I6 (M) Invoice detail: totals, amount paid, outstanding, payment history, per-status actions (Issue / Cancel / Print / Record Payment).
- FR-I7 (M) Cancel invoice only when no payments exist; quotation returns to Approved.

### 4.5 Payments
- FR-P1 (M) Record payment against an issued invoice: amount (>0, ≤ outstanding), date, method enum, reference no., notes.
- FR-P2 (M) Support advance, partial, multiple and full payments; outstanding = grand total − Σ payments.
- FR-P3 (M) Payment status computed: Unpaid / Partially Paid / Paid (server-side; never user-set).
- FR-P4 (M) Overpayment rejected server-side (422) with clear message; UI warns live.
- FR-P5 (M) Delete payment with confirmation → recalculate status/outstanding.
- FR-P6 (M) UPI QR code on invoices and on a Balance / Payment Due document, inside the invoice's payment block. **Generated** from a UPI intent URI built from the live `upi_id` — never snapshotted (§8.4.5) and never an uploaded image. A quotation is not payable and never shows one. Compact 26mm on both documents, with no screen chrome in print. Printed copies carry "Verify the amount before paying." because paper is a snapshot.
- FR-P8 (M) Optional **payment method on the invoice**, chosen on the Invoice page before issue: UPI / Bank Transfer / Cash / Not Selected. It decides only *which payment instructions the document prints* — UPI → UPI ID + QR, Bank Transfer → account details and no QR, Cash → the method line alone, Not Selected → both electronic rails and never an explicit cash offer. Stored as `invoices.payment_method` (nullable, `CHECK IN ('upi','bank_transfer','cash')`) and editable only while the invoice is a Draft, so the presentation is frozen at issue by the existing draft-only guard. The invoice's own QR encodes the **grand total**, never the outstanding balance: an outstanding figure is unknowable at issue and moves with every payment, so encoding it would make a reprint ask for a different sum. The Balance / Payment Due document remains the instrument for collecting a reduced amount. This is distinct from `payments.method` (§4.5), which records how the client actually paid and may differ — recording a bank transfer payment never alters an invoice issued as UPI.
- FR-P7 (M) Balance / Payment Due document, from `GET /invoices/:id/payment-due`. A **read**: it re-derives `original total - Σ payments` on every request and stores nothing, so it cannot add revenue (dashboard and client summaries sum `invoices.grand_total_paise`) or duplicate a payment. It carries no document number of its own — only a reference to the invoice it concerns — so it can never read as a second sale. Refused with 422 when the invoice is not issued or nothing is outstanding. Scanning its QR initiates a payment and nothing more.

### 4.6 Dashboard
- FR-D1 (M) Metric cards with strict definitions (§9.2 field list, §11 inclusion/exclusion rules — the original "§23" cross-reference was wrong, §23 is the folder structure): quotation counts by status, total quotation value, approved value, invoiced value, received, outstanding.
- FR-D2 (M) Recent lists: quotations (5), invoices (5), clients (5) with quick links.
- FR-D3 (S) Two-three charts: monthly received vs invoiced (12 months), quotation status breakdown. Nothing more.

### 4.7 Documents
- FR-DOC1 (M) Branded A4 print/PDF views for quotation and invoice: header, client block, item table, totals block, amount paid/outstanding (invoice), terms, signatory, footer.
- FR-DOC2 (M) Multi-page safe: repeating table header, no broken rows, totals block never orphaned, page-break control (§14).
- FR-DOC3 (M) Print and "Save as PDF" via the browser dialog; document opens in a dedicated print route.
- FR-DOC4 (S) Page numbers on multi-page documents if achievable cleanly in the print pipeline; otherwise omit (do not fake it).

### 4.8 Settings
- FR-S1 (M) Sections: Business Information, Branding, Quotation Settings, Invoice Settings, Tax, Payment/Bank Details, Terms & Conditions, Document/Footer, Account & Security (password change).
- FR-S2 (M) Settings changes require **no code changes**; documents, numbering and defaults read them live.
- FR-S3 (M) Logo upload: PNG/JPEG/WEBP only, ≤ 2 MB, validated, stored server-side; rendered in UI and documents.
- FR-S4 (M) Default terms editor (per document type) used as a starting snapshot for every new document.
- FR-S5 (S) Manageable suggestion lists: item categories and units.

### 4.9 UX safety
- FR-U1 (M) Confirmation dialogs for every destructive/irreversible action (delete draft, archive client, mark rejected, cancel invoice, delete payment, issue invoice).
- FR-U2 (M) The user always sees, on any document screen: which document, which client, current status, total, paid/outstanding (invoices), and the **next available action**.
- FR-U3 (M) No silent failures: explicit offline banner; network errors surfaced; save never "pretends" (§17, §20).

---

## 5. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | List endpoints paginated (≤ 100/page), respond < 300 ms on typical hardware with thousands of records. Dashboard aggregate query is a single round-trip. First load < 3 s on 4G; subsequent loads served from cache. |
| **Security** | Per §16: hashing, httpOnly cookies, CSRF, input validation, parameterized ORM queries, upload validation, locked-down CORS, secrets in env, no stack traces to clients. |
| **Data integrity** | All money in integer paise; DB CHECK constraints; FKs `RESTRICT` for financial links; server transactions for multi-table writes; backend is the calculation authority. |
| **Reliability** | No data loss on refresh during editing: quotation editor autosaves draft (debounced) or warns on unload — decision: **debounced autosave to Draft every ~10 s while editing + beforeunload warning when dirty**. |
| **Usability** | Mobile-first; no horizontal scrolling at 360 px; touch targets ≥ 44 px; keyboard-efficient on desktop. |
| **Compatibility** | Latest Chrome/Edge (primary, incl. Android Chrome), Safari iOS ≥ 16, Firefox — print CSS verified in Chrome + Safari. |
| **Maintainability** | Layered architecture (§23), componentized frontend (§18 inventory, CSS Modules + shared token stylesheets), documented API, Alembic migrations for every schema change. |
| **Observability** | Structured JSON logs (request, user, status, duration, error id); enough to debug issues from logs alone. No external APM in v1. |
| **Backup** | SQLite DB + `uploads/` are the entire state. Documented copy/backup runbook (§27/R7); optional Settings → "Download backup" action. |
| **Time zone** | Store UTC timestamps; business dates (quotation/invoice/payment dates) stored as plain DATEs (Asia/Kolkata business context); UI renders dates as `DD MMM YYYY`. |

---

## 6. Page / Screen Architecture

| # | Page | Route | Purpose | Key UI | Primary actions |
|---|---|---|---|---|---|
| 1 | Login | `/login` | Brand-forward login card | Logo, email, password w/ show-hide, error banner, submit spinner | Login |
| 2 | Dashboard | `/` | Business position | Metric cards, 2–3 charts, recent lists | Quick-create client/quotation |
| 3 | Quotations list | `/quotations` | Find & manage quotations | Search, status filter chips, date filter, table→cards, status badges, totals column | New Quotation, row → detail |
| 4 | Create/Edit Quotation | `/quotations/new`, `/quotations/:id/edit` | Core editor | Client picker, dates, item editor (table/cards), discount toggle (₹/%), GST, other charges, sticky totals panel | Add item, reorder, Save Draft, Preview, Mark Sent |
| 5 | Quotation Detail | `/quotations/:id` | Review & act | Doc-style header, status timeline, items summary, totals, next-action bar | Mark Sent/Approved/Rejected, Reopen, Create Invoice, Duplicate, Print, Archive |
| 6 | Invoices list | `/invoices` | Find & manage invoices | Search, payment-status filter chips, table→cards with paid/outstanding | New (via quotation only — helper text), row → detail |
| 7 | Invoice Detail | `/invoices/:id` | Review, bill, collect | Header, totals, **Amount paid / Outstanding** highlight, payment history | Issue, Record Payment, Cancel, Print |
| 8 | Clients | `/clients` | Client book | Search, cards/table, per-client mini-stats | New Client, row → detail |
| 9 | Client Detail | `/clients/:id` | Full relationship history | Profile card, tabs: Quotations / Invoices / Payments, totals strip, archived badge | Edit, Archive (Restore when archived), New Quotation |
| 10 | Settings | `/settings` | Configure everything | Left section nav (stacked tabs on mobile), forms per section, Save per section | Save section, Upload logo, Change password |

**Modals / overlays (no extra pages):** New/Edit Client, Client Picker (search), Preview Document (print route in overlay), Record Payment, Confirm dialogs, Mark Rejected (reason), Duplicate Quotation confirm, Mobile filter sheet, Toasts.

**Print routes (chrome-less, outside app shell):** `/print/quotation/:id`, `/print/invoice/:id` — auto-trigger `window.print()` with a "Print / Save as PDF" toolbar that hides on print.

---

## 7. Navigation Structure

**Desktop (≥ 1024 px): fixed left sidebar**
```
[Logo: Ruchita Interiors]
  Dashboard
  Quotations        (badge: draft count)
  Invoices          (badge: unpaid count)
  Clients
  Settings
─────────
  [user email · Logout]
```

**Mobile (< 768 px): bottom navigation (5 slots, thumb zone)**
```
[Dashboard] [Quotations] [+ New] [Invoices] [More]
```
- **+ New** opens a sheet: New Client / New Quotation (context-aware: inside a client detail, it defaults to New Quotation for that client).
- **More** opens a sheet: Clients, Settings, Logout.
- Top app bar per page: back arrow, page title, contextual action (e.g., "⋯" menu for secondary actions).
- Long lists use **horizontal chip scrollers** for filters (the only permitted horizontal scroll); content itself never overflows.

**Rules:** active state always visible; back preserves list state (filters/sort/page); deep links work after refresh (SPA fallback + auth guard); a `?focus=payment` style param can open the payment sheet directly from a notification-like toast after issue.

---

## 8. Database ER / Data Model

### 8.1 Conventions
- **Money:** integer **paise** everywhere (`*_paise`). Never floats. Rates like ₹1,250.50 → `125050`.
- **Quantity:** integer **milli-units** (`qty_milli`, ×1000) — supports `10.5`, `12.25 sq.ft` exactly.
- **Percent/rates:** integer **basis points** (`gst_bp`, `discount_bp`) — 18% → `1800`.
- **IDs:** integer primary keys. **Deletes:** hard delete only where legal (draft quotations); everything financial uses status/archive + `RESTRICT` FKs.
- **Timestamps:** `created_at`, `updated_at` UTC. **Dates:** business dates are `DATE`.
- All FKs declared with explicit `ON DELETE` behavior; SQLite pragmas: `foreign_keys=ON`, `journal_mode=WAL`.
- Schema changes only via **Alembic migrations**.

### 8.2 ER diagram
```
users ──< clients ──< quotations ──< quotation_items
                │          │
                │          │ 1:0..1 (snapshot, locked after conversion)
                │          ▼
                └────── invoices ──< invoice_items
                             │
                             └──< payments

company_settings (single row)      terms_conditions      numbering_counters
        ▲ reads at doc creation: prefixes, defaults, terms snapshot, bank snapshot
```

### 8.3 Tables

**users**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| email | TEXT | UNIQUE NOT NULL (login id; username-style display name separate) |
| name | TEXT | NOT NULL |
| password_hash | TEXT | NOT NULL — werkzeug scrypt, never plain |
| role | TEXT | DEFAULT `'owner'` (exists for future roles; unused logic now) |
| is_active | BOOLEAN | DEFAULT 1 |
| created_at / updated_at | DATETIME | |

**clients**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | NOT NULL |
| phone / email | TEXT | |
| address | TEXT | billing/contact address |
| project_address | TEXT | site address |
| gstin | TEXT | optional |
| notes | TEXT | internal |
| archived_at | DATETIME | NULL = active |
| created_at / updated_at | DATETIME | |
Indexes: `name` (search), `archived_at`.

**quotations**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| number | TEXT | UNIQUE NOT NULL — `QTN-2026-0001` (prefix from Settings) |
| year | INTEGER | NOT NULL — numbering bucket |
| client_id | FK → clients | **RESTRICT** |
| client_snapshot | JSON | `{name, phone, email, address, project_address, gstin}` copied at save — client edits never rewrite past quotes |
| quotation_date | DATE | NOT NULL |
| valid_until | DATE | |
| status | TEXT | CHECK in `draft, sent, approved, rejected, converted` DEFAULT `draft` |
| discount_type | TEXT | CHECK in `percent, fixed` |
| discount_bp | INTEGER | used when `percent` (e.g. 500 = 5%) |
| discount_fixed_paise | INTEGER | used when `fixed` |
| gst_bp | INTEGER | 0–2800 |
| other_charges_label | TEXT | default `'Other Charges'` |
| other_charges_paise | INTEGER | ≥ 0 |
| subtotal_paise / discount_paise / gst_paise / grand_total_paise | INTEGER | **cached** — recomputed server-side on every save |
| terms_text | TEXT | snapshot of default terms at creation; per-document editable |
| notes | TEXT | internal, not printed |
| created_by | FK → users | NULL ok (future) |
| archived_at | DATETIME | |
| created_at / updated_at | DATETIME | |
Indexes: `number` UNIQUE, `(status, quotation_date)`, `client_id`.

**quotation_items**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| quotation_id | FK → quotations | **CASCADE** (legal only for drafts) |
| position | INTEGER | ordering |
| category | TEXT | free text (suggestions from Settings) |
| name | TEXT | NOT NULL |
| description | TEXT | long text ok |
| unit | TEXT | free text (suggestions) |
| qty_milli | INTEGER | CHECK ≥ 0 |
| rate_paise | INTEGER | CHECK ≥ 0 |
| line_total_paise | INTEGER | computed server-side |
Index: `(quotation_id, position)`.

**invoices**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| number | TEXT | UNIQUE NOT NULL — `INV-2026-0001` |
| year | INTEGER | NOT NULL |
| quotation_id | FK → quotations | **UNIQUE partial index: `WHERE status != 'cancelled'`** — enforces one active invoice per quotation, allows re-invoice after cancel |
| client_id | FK → clients | RESTRICT (denormalized for reporting/detail) |
| client_snapshot | JSON | copied from quotation snapshot at conversion |
| issue_date / due_date | DATE | |
| status | TEXT | CHECK in `draft, issued, cancelled` DEFAULT `draft` |
| Calc fields (mirror quotation) | | discount_type/bp/fixed, gst_bp, other charges, subtotal/discount/gst/grand_total_paise — recomputed & stored at conversion |
| terms_text | TEXT | snapshot |
| payment_method | TEXT | CHECK in `upi, bank_transfer, cash` or NULL = "Not Selected" — the invoice's payment *presentation*, draft-editable then frozen at issue (FR-P8). Distinct from `payments.method`, which records how the client actually paid |
| bank_snapshot | JSON | `{account_name, account_number, bank_name, ifsc, branch, upi_id}` from Settings at creation — later Settings edits never alter issued invoices |
| signatory_name | TEXT | snapshot |
| notes | TEXT | internal |
| created_by | FK → users | |
| created_at / updated_at | DATETIME | |
Indexes: `number` UNIQUE, `(status, issue_date)`, `client_id`, partial unique on `quotation_id`.

**invoice_items** — same shape as `quotation_items` with `invoice_id` FK **RESTRICT**, own `position`. Rows are an independent copy, not a view.

**payments**
| Column | Type | Constraints / Notes |
|---|---|---|
| id | INTEGER PK | |
| invoice_id | FK → invoices | **RESTRICT** |
| amount_paise | INTEGER | CHECK > 0 |
| paid_on | DATE | NOT NULL |
| method | TEXT | CHECK in `cash, upi, bank_transfer, cheque, card, other` |
| reference | TEXT | txn/cheque/UPI ref no. |
| notes | TEXT | |
| created_by | FK → users | |
| created_at | DATETIME | |
Index: `invoice_id`.

**terms_conditions**
| Column | Type | Notes |
|---|---|---|
| id / scope / title / body | | `scope` CHECK in `quotation, invoice, both`; `body` plain text, numbered lines |
| is_default | BOOLEAN | one default per scope used for new documents |
| created_at / updated_at | | |

**numbering_counters**
| Column | Type | Notes |
|---|---|---|
| doc_type | TEXT | CHECK in `quotation, invoice` |
| year | INTEGER | |
| last_number | INTEGER | DEFAULT 0 |
| updated_at | | **UNIQUE(doc_type, year)** |

**company_settings** — single row (insert-guarded `id=1`): company_name, tagline, logo_path, payment_qr_path (Phase 8), phone, email, website, address_line1/2, city, state, pincode, gstin, default_gst_bp (1800), default_validity_days (15), quotation_prefix ('QTN'), invoice_prefix ('INV'), bank_account_name, bank_account_number, bank_name, bank_ifsc, bank_branch, upi_id, signatory_name, footer_text, item_categories (JSON array), units (JSON array), timestamps.

### 8.4 Snapshot & immutability strategy (critical)
1. **Client snapshot on quotation** — quotations copy client contact fields at save; editing a client never rewrites issued history.
2. **Full snapshot on conversion** — invoice copies client snapshot, items (new rows), calc fields, terms, bank details, signatory. Conversion runs in **one DB transaction** (insert invoice + items + counters + set quotation status `converted`); any failure rolls back everything.
3. **Locks** — quotation is read-only once `approved`/`converted`; invoice items are read-only once `issued`. Settings changes affect only **future** documents.
4. **Result:** a printed invoice can always be reproduced byte-for-byte (data-wise) years later.
5. **Exception — the payment QR is NOT snapshotted (Phase 8).** `bank_snapshot` deliberately omits `payment_qr_path`; the QR is read live from `company_settings` on every invoice render. Every other snapshotted field states the terms the invoice was issued under, so a reprint must keep saying the same thing. A QR is not a statement of terms — it is an instruction to send money somewhere, and owners change bank accounts and close UPI handles. A frozen QR would keep directing customers to an account that no longer exists, which is a worse failure than a document that does not match the Settings page byte-for-byte. The §8.4 result above therefore holds for the invoice's *textual and financial* content, not for this one image.

### 8.5 SQLite as the production database (decided)
SQLite is the permanent database for this single-user application — not a temporary choice. Operational rules to make it production-grade:
- **Access via SQLAlchemy ORM only** — no raw SQL strings scattered in blueprints; queries stay declarative and testable.
- **Connection settings:** `journal_mode=WAL` (concurrent reads during writes), `foreign_keys=ON` enforced per connection, `busy_timeout=5000` ms, `synchronous=NORMAL`.
- **Single-writer discipline:** all multi-step writes (save quotation, conversion, payment) run inside short transactions; no long-running write transactions; dashboard aggregates are read-only.
- **File location:** DB file lives in `backend/instance/` (gitignored); Alembic migrations create and evolve it.
- **Backups:** the entire database is one file — Settings gains a **"Download backup"** action (copies the DB file + `uploads/` into a zip); the backup runbook (§5, R7) documents scheduled file copies.
- **Integrity checks:** monthly `PRAGMA integrity_check` documented in the runbook; `CHECK` constraints are enforced by SQLite and tested.

---

## 9. API Architecture

### 9.1 Conventions
- Base: `/api/v1`. JSON only. Blueprints: `auth, clients, quotations, invoices, payments, dashboard, settings, uploads`.
- **Auth:** all endpoints require a valid access-token cookie except `POST /auth/login`, `GET /health`. Mutations additionally require the CSRF header (§16).
- **Error envelope (consistent everywhere):**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Discount cannot exceed subtotal.",
             "details": [ { "field": "discount", "message": "Must be ≤ subtotal" } ] } }
```
Codes: `VALIDATION_ERROR` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `BUSINESS_RULE` (422, domain rules like "Invoice already exists"), `INTERNAL` (500 — generic message + logged error id).
- **Pagination:** `?page=1&page_size=25` (max 100) → `{ "items": [...], "page": 1, "page_size": 25, "total": 143 }`.
- **Filtering/sorting:** documented per list below; sort via `?sort=created_at&order=desc`.
- **Transactions:** any multi-row write (quotation+items save, conversion, payment) is one transaction; numbering allocation inside the same transaction (§12).
- Backend recomputes and returns the authoritative document (items + totals) after every mutation — the client re-renders from the response, never from its own math.

### 9.2 Endpoints

**Auth** — `POST /auth/login` {email,password} → sets cookies + user; `POST /auth/logout`; `POST /auth/refresh`; `GET /auth/me`; `PUT /auth/password` (current + new). Login rate-limited (§16).

**Clients** — `GET /clients?q=&include_archived=false&page=` (q matches name/phone/email; default sort `updated_at` desc); `POST /clients`; `GET /clients/:id` (works for archived clients too — history deep links never 404); `PUT /clients/:id`; `DELETE /clients/:id` → archives (soft delete; a hard-delete endpoint is never exposed); `POST /clients/:id/restore` → clears `archived_at` (409 if the client is already active); `GET /clients/:id/summary` → { quotations:[], invoices:[], payments:[], totals:{ billed, received, outstanding } }.

**Quotations** — `GET /quotations?q=&status=&client_id=&date_from=&date_to=&min_amount=&max_amount=&sort=`; `POST /quotations` (creates Draft, allocates number); `GET /quotations/:id` (items + computed totals + allowed_actions list); `PUT /quotations/:id` (full replace of header+items, Draft/Sent-reopened only — 409 otherwise); `DELETE /quotations/:id` (Draft only — retires number); `POST /quotations/:id/status` `{ action: "send" | "approve" | "reject" | "reopen" }` (server validates guards; returns updated doc); `POST /quotations/:id/duplicate`; `POST /quotations/:id/invoice` → converts (409 if active invoice exists or status ≠ approved).

**Invoices** — `GET /invoices?q=&payment_status=&client_id=&date_from=&date_to=&sort=`; `GET /invoices/:id` (+ payments + computed { paid_paise, outstanding_paise, payment_status, allowed_actions }); `PUT /invoices/:id` (Draft only: dates/notes/terms); `POST /invoices/:id/issue`; `POST /invoices/:id/cancel` (409 if payments exist); `GET /invoices/:id/payments`; `POST /invoices/:id/payments` (validates ≤ outstanding).

**Payments** — `DELETE /payments/:id` (confirm on client; recalc invoice).

**Dashboard** — `GET /dashboard/summary` → counts by quotation status; { draft_value, sent_value, approved_value, total_quotation_value }; { invoiced_value, received_total, outstanding_total }; monthly series (12 months: quotation_count, quotation_value, invoiced_value, received_value); **day-level series (last 30 days, same fields keyed by `date`) supporting the Dashboard's 7/14/30-day view — additive, and still one request**; recent 5 quotations/invoices/clients. **One request, one query set.**

**Settings** — `GET/PUT /settings/company`; `POST /settings/logo` (multipart); `DELETE /settings/logo`; `POST /settings/payment-qr` (multipart, field `payment_qr`); `DELETE /settings/payment-qr`; `GET /settings/terms`, `POST /settings/terms`, `PUT/DELETE /settings/terms/:id`; `PUT /auth/password` (also here conceptually). Settings PUT returns the normalized saved object. `logo_path` and `payment_qr_path` are readable through `GET /settings/company` but are **not** writable through `PUT` — they change only via their upload/delete routes.

**Uploads** — `GET /uploads/logo` → stored logo file (long cache; same-origin so print views work); `GET /uploads/payment-qr` → stored QR file (long cache). Both share one image policy (§16: PNG/JPEG/WEBP, ≤ 2 MB, extension + MIME + magic-byte + decode checks, UUID filename) and live in separate subdirectories so neither can unlink the other.

**Health** — `GET /health` (no auth) → `{ status: "ok" }` for deployment checks.

---

## 10. Quotation Calculation Logic

### 10.1 Units and primitives
All arithmetic in integers (paise / milli-units / basis points) — **no floats at any layer**. Frontend parses user input (`"1,250.50"` → `125050`) with a shared util and sends integers; backend validates integers directly.

### 10.2 Formulas (backend `services/calculations.py` — the single source of truth)

```
line_total_paise = round_half_up( qty_milli × rate_paise / 1000 )

subtotal_paise   = Σ line_total_paise

discount_paise   = percent: round_half_up( subtotal × discount_bp / 10000 )
                   fixed:   min( discount_fixed_paise, subtotal )   # >subtotal is a validation error, not a clamp

taxable_paise    = subtotal_paise − discount_paise

gst_paise        = round_half_up( taxable × gst_bp / 10000 )

grand_total_paise= taxable_paise + gst_paise + other_charges_paise
```

- **Rounding:** half-up, at line level and at tax level, computed in integers ( `(a*b + 5000) // 10000` style with sign guards). Deterministic across backend, tests, and re-computation.
- **Other charges** are not taxed in v1 (Q5). Label is user-editable per document.
- **Percent discounts** are stored as `discount_bp` so item edits recompute cleanly; **fixed discounts** are re-validated against the new subtotal on every save.
- **GST range:** `0 ≤ gst_bp ≤ 2800` (0–28%). Quotation validity: `valid_until ≥ quotation_date`.
- Frontend keeps a **display-only mirror** of these formulas (same integer math in TS) for live totals; every save round-trips through the backend and the response replaces local state.

### 10.3 Calculation validation rules (all server-enforced)
| Rule | Behavior |
|---|---|
| qty < 0 / rate < 0 / discount < 0 / gst out of range / other charges < 0 | 422 `VALIDATION_ERROR` |
| fixed discount > subtotal | 422 — "Discount cannot exceed subtotal" |
| qty = 0 or rate = 0 or empty item name | Allowed in **Draft**; **blocks Send** (`BUSINESS_RULE`: "All items need name, quantity and rate") |
| Quotation with 0 items | Draft allowed; blocks Send; totals = 0 |
| NaN/undefined/overflow (qty_milli or paise > 10¹²) | 422 — rejected at schema level, never propagates |
| Any total mismatch between client and server | Server value wins; client resyncs |

---

## 11. Invoice Calculation & Payment Logic

- **On conversion** the server recomputes totals from the copied items (must equal quotation totals since the quotation is locked at approval — if not, conversion aborts with 500 and rolls back; this is a safety assert).
- **Paid / outstanding (computed, never stored as mutable truth):**
```
paid_paise        = Σ payments.amount_paise
outstanding_paise = grand_total_paise − paid_paise
payment_status    = unpaid        (paid = 0)
                  | partially_paid (0 < paid < grand)
                  | paid           (paid = grand)
```
- **Overpayment:** `POST /payments` with amount > outstanding → 422 `BUSINESS_RULE` ("Payment exceeds outstanding balance of ₹X"). The payment modal shows remaining balance live and prefills it.
- **Payments allowed only when `status = issued`** (draft invoices can't collect; cancelled invoices reject).
- **Draft invoices are excluded from dashboard money metrics**; only `issued` (non-cancelled) invoices count toward invoiced/outstanding; only actual payment rows count toward received.
- **Cancel rules:** invoice with payments cannot be cancelled (404-free 409 with message); cancelled invoices release the quotation back to `approved` and are excluded from metrics but kept for history.
- **Delete payment** → recompute `payment_status` (paid → partially_paid → unpaid) in the same transaction.

---

## 12. Numbering Strategy

**Design:** `numbering_counters(doc_type, year, last_number)` with `UNIQUE(doc_type, year)`. Allocation algorithm (inside the same transaction as the document insert):
1. `INSERT ... ON CONFLICT DO NOTHING` (ensure counter row exists) → `UPDATE ... SET last_number = last_number + 1` → read back → format `'{prefix}-'{year}-'{nnnn}'` (4-digit zero-pad, grows beyond 9999 naturally).
2. SQLite serializes writes (single-writer, WAL mode) → allocation is crash-safe and race-free for this single-user app.
3. Prefixes come from Settings (`QTN` / `INV` defaults) — but the **stored `number` is immutable** once allocated (changing the prefix later never rewrites history).

**Behavior matrix**
| Event | Behavior |
|---|---|
| Quotation deleted (Draft only) | Number is **retired, never reused** (counter not decremented) |
| Converted to invoice | Quotation number untouched; invoice gets its own `INV-` sequence |
| App restart / crash | Counter lives in the DB — allocation resumes correctly; the allocation+insert transaction guarantees no gaps from failures |
| Year change | New bucket: `QTN-2027-0001` (per-year sequence; calendar-year default, FY option future — Q2) |
| Duplicate number attempt | Impossible: allocation is the only path; UNIQUE constraint is the backstop |

Numbers are allocated **at document creation** (Draft), so previews and lists always show the real number.

---

## 13. Status / Lifecycle Strategy

### 13.1 Quotation state machine
```
            send                approve
 DRAFT ──────────► SENT ──────────────► APPROVED ──(create invoice)──► CONVERTED
   ▲                │  │                    ▲
   │   reopen       │  │ reject             │ cancel invoice (releases)
   └────────────────┘  ▼                    │
                     REJECTED              │
                                           │
 EXPIRED = computed overlay: status ∈ {draft, sent} AND valid_until < today
```

| Transition | Guard | Side effects |
|---|---|---|
| draft → sent | ≥1 item, all items valid (name/qty>0/rate>0), client set, grand_total > 0 | Locks items |
| sent → approved | — | Confirm dialog with totals; locks header+items |
| sent → rejected | — | Reason optional; archived-able |
| sent → draft (reopen) | Not approved/converted | Unlocks items |
| approved → converted | Only via conversion endpoint, quotation still approved | Sets `converted`, links invoice |
| invoice cancelled | — | Quotation reverts to `approved` |
| Expired handling | Expired quotations show an Expired badge; **Mark Approved** on an expired quotation asks for confirmation and offers "extend validity" (set new valid_until) | — |

### 13.2 Invoice state machine
```
 DRAFT ──issue──► ISSUED ──(payments)── payment_status: unpaid → partially_paid → paid
   │                 │
   └─cancel──────────┴──► CANCELLED   (only if no payments)
```
- Issue: confirm dialog ("Items will be locked"); enables payments and prints.
- Server exposes `allowed_actions[]` on every document response — the UI renders actions **from that list** (single source of truth, no state bugs).

### 13.3 Status presentation
One `StatusBadge` component app-wide (treatments per §18.6): Draft (gray outline), Sent (info blue), Approved (green + check), Rejected (red + ×), Expired (gray solid), Converted (ink solid + gold edge), Unpaid / Partially Paid (amber) / Paid (green) for invoices — every badge pairs color with a text label. Money columns right-aligned, Indian digit grouping (₹ 12,34,567.00 via `Intl.NumberFormat('en-IN')`).

---

## 14. Document / PDF Architecture

### 14.1 Decision: browser print pipeline (not server-side PDF)
Rationale: zero heavy Python PDF deps (WeasyPrint is fragile on Windows), pixel-consistent with the app's brand CSS, "Save as PDF" is native, and the data is already rendered by React. Trade-off: exact PDF bytes are browser-dependent — acceptable for v1. A server-side renderer (WeasyPrint/ReportLab) can be added later behind the same data (§26); the print layout CSS is written to be transposable.

### 14.2 Mechanism
- Dedicated chrome-less routes `/print/quotation/:id` and `/print/invoice/:id` (authenticated; app-shell hidden).
- Toolbar (hidden in `@media print`): Print / Save as PDF button (calls `window.print()`), Back, document number + status.
- A4 via `@page { size: A4; margin: 14mm 12mm; }`; document root fixed to 210 mm content box; everything sized in mm/pt for print fidelity.
- Auto-open print dialog on load when `?autoprint=1`.

### 14.3 Layout spec (quotation & invoice share one component family, `DocumentPaper`)
1. **Header band:** logo left; company name (display serif), contact, website, address, GSTIN right. Gold rule underneath.
2. **Title strip:** `QUOTATION` / `TAX INVOICE` + number (large, right), date / valid-until (or issue/due date) left.
3. **Client block:** Bill To (name, phone, email, address) and Project/Site address side-by-side; wraps on mobile print.
4. **Items table:** columns: # | Category (grouping subheader row when present) | Item & description | Unit | Qty | Rate | Amount. `thead` repeats per page (`display: table-header-group`), `tr { page-break-inside: avoid }`, long descriptions wrap, amounts right-aligned tabular figures.
5. **Totals block (right-aligned card):** Subtotal → Discount (labeled "Discount (5%)" or "Discount") → Taxable value → **GST 18%** → Other charges (label) → **Grand Total** (gold-tint row with `--gold-ink` text + gold left edge — brand moment per §18.4). Invoice adds: **Amount Paid**, **Balance Due** (bold), and bank/UPI details card + payment reference hint.
6. **Terms & Conditions:** snapshot `terms_text`, small type, `page-break-inside: avoid` per term block.
7. **Signatory:** authorized signatory name + signature line right-aligned.
8. **Footer:** settings `footer_text` + services strip ("Modular Kitchen · Wardrobes · False Ceiling …" derived from settings footer text if configured) — single source: Settings.
- Grand total row and totals block use `page-break-inside: avoid` and `break-before: avoid` so totals are never orphaned on a page alone.

### 14.4 Multi-page rules
Test matrix: 3-item, 15-item, 60-item documents; terms must start after the table without overlap; repeated header appears on every page; no clipped rows. If page numbers are cleanly achievable with the chosen pipeline, add "Page X of Y" via a small JS pagination probe; **otherwise omit** (FR-DOC4) — no fake page numbers.

---

## 15. Settings Architecture

| Section | Fields (stored in `company_settings` unless noted) | Consumed by |
|---|---|---|
| Business Information | company name, tagline, phone, email, website, address lines, GSTIN | UI header, documents |
| Branding | logo (upload → `uploads/branding/`), footer text | App shell, documents |
| Quotation Settings | quotation prefix, default validity days, default terms (terms_conditions) | New quotation defaults, numbering |
| Invoice Settings | invoice prefix, default due-term note, default terms | Invoice creation, numbering |
| Tax Settings | default GST bp | New documents |
| Payment / Bank | account name, account no., bank, IFSC, branch, UPI ID | Invoice snapshot + invoice document |
| Terms & Conditions | CRUD list with scope + default flag (terms_conditions table) | Document snapshots |
| Document / Footer | footer text, services strip text, signatory name | Documents |
| Account & Security | change password (current + new, min 10 chars) | users |
| Catalogue (S) | item categories list, units list (JSON arrays) | Quotation editor chips |

**Rules:** every section is a separate form with its own Save + success toast; validation server-side; logo upload validates extension + MIME + magic bytes (PNG/JPEG/WEBP, ≤ 2 MB, UUID filename — SVG rejected for XSS safety); Settings changes never mutate existing documents (snapshots, §8.4); seeding creates sensible defaults (prefixes, 18% GST, 15-day validity, starter terms, category list from §8 of the requirements: Living Room, Bedroom, Kitchen, Bathroom, Wardrobe, Furniture, Electrical, Civil Work, False Ceiling, Painting, Other).

---

## 16. Authentication / Security Architecture

| Control | Design |
|---|---|
| Password storage | Werkzeug scrypt hash (`generate_password_hash`), constant-time `check_password_hash`; min 10 chars at seed/change; never logged, never returned |
| Tokens | JWT access token (15 min) + refresh token (30 days, sliding) as **httpOnly, SameSite=Lax, Secure** (prod) cookies; refresh path-scoped to `/api/v1/auth` |
| CSRF | Double-submit: non-httpOnly `csrf_token` cookie + `X-CSRF-Token` header required on all non-GET API calls; verified server-side |
| Auth flow | Login → both cookies; 401 on expired access → client calls `/auth/refresh` once and retries (TanStack Query retry hook); logout clears cookies server-side; unauthenticated app visits redirect to `/login` |
| Rate limiting | Login: 5 attempts / 5 min per IP+username (in-memory limiter, single-process app) |
| Input validation | Marshmallow schemas on every endpoint (types, ranges, lengths, string caps: item description ≤ 2000 chars, names ≤ 200); service-layer business rules (§10.3, §13) |
| SQL injection | SQLAlchemy parameterized queries only; search uses escaped `LIKE` |
| File uploads | Extension + MIME + magic-byte check, size cap, UUID filenames, stored outside static, served via authenticated API route; images only (PNG/JPEG/WEBP) |
| CORS | Explicit allow-list from env (`CORS_ORIGINS`); credentials enabled only for those origins |
| Headers | API responses: `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on auth, JSON content type; frontend CSP via meta/deploy config |
| Secrets | `.env` (gitignored) + `.env.example`: `SECRET_KEY`, `JWT_SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGINS`, `DATABASE_URL`. Generate strong secrets; **no credentials in code or repo** |
| Errors | Global error handler → envelope (§9.1); 500s return generic message + error id; full stack only in server logs |
| DB safety | FK enforcement ON, CHECK constraints, transactions for all multi-row writes |
| Frontend guards | Route guards + query 401 interceptor; but **the backend never trusts the frontend** — every endpoint enforces auth itself |

---

## 17. PWA Architecture

| Piece | Plan |
|---|---|
| Manifest | `name`, `short_name` "Ruchita Interiors", `start_url "/"`, `display "standalone"`, theme `#16130F`, background `#FAF8F3`, icons 192/512 (+ maskable), orientation any |
| Icons / splash | Generated from provided logo (gold-on-ink mark); iOS `apple-touch-icon` + `apple-mobile-web-app-*` meta |
| Service worker | vite-plugin-pwa + Workbox: **precache** app shell (index, assets, fonts); **runtime**: static assets cache-first; `/api` **network-first with 3 s timeout** → fallback "offline" response for GETs |
| Offline policy (writes) | **No offline writes, no fake success.** When `navigator.onLine === false` or a mutation fails with a network error: show a persistent offline banner, disable submit buttons with a clear tooltip "Reconnect to save", and surface the error toast "No connection — changes not saved." Read views may show cached data labeled "Offline — showing last loaded data". Financial operations always require the network, visibly. |
| Update flow | New SW detected → toast "New version available — Refresh" (user-triggered reload; no silent takeover) |
| Install | Custom in-app "Install app" affordance (beforeinstallprompt) on desktop/Android; iOS instructions card (Share → Add to Home Screen) |
| Mobile feel | Standalone display, safe-area insets (`env(safe-area-inset-*)`) for bottom nav, momentum scroll, no 300 ms tap delay, `viewport-fit=cover` |
| Cache hygiene | Versioned deploy hash; API responses never cached aggressively (TanStack Query is the cache, `staleTime` tuned per resource; settings cached longer) |

---

## 18. UI/UX Design System

**Tone:** premium, minimal, business-focused. Feels like a custom-built product for an interiors brand — not a generic admin template. No heavy gradients, no gratuitous animation, no oversized cards.

### 18.1 Design principles (research-backed)
The palette below is engineered from established dashboard-design practice (SaaS/dashboard color-scheme guides, WCAG 2.1, semantic-color conventions) — not a copy of the website:
1. **Neutral base carries ~80–90% of the interface.** Backgrounds, cards, text and chrome are warm neutrals; color appears only where it means something. This is the "colorful accents on a neutral base" pattern used by the best-regarded dashboards.
2. **Gold is a brand accent, not a UI workhorse.** Research is unambiguous: mid-tone gold fails WCAG AA contrast as button fill/text (≈2.5:1 on white) and brand colors picked for marketing exhaust users when used for hours in an interface. Gold therefore appears only in: logo/brand moments, active-nav indicator, selected states, the grand-total row on documents, and a thin top accent bar — never as body text or the default button color.
3. **Near-black ink is the interactive color.** Primary buttons, links and form focus use deep warm black (like shadcn/ui's near-black primary) — maximum contrast (≈15:1), and it lets gold shine precisely because it isn't competing.
4. **Semantic colors never collide with brand colors.** Success green / danger red / warning amber / info blue are reserved exclusively for status. Since gold ≈ amber hue, amber is chosen slightly more orange and gold stays out of status contexts entirely.
5. **Never color alone.** Every status pairs color with an icon or text label (≈8% of men have red-green deficiency); every text/background pair must meet WCAG AA (4.5:1 normal text, 3:1 large text and UI components), verified in Chrome DevTools' vision-deficiency simulator during Phase 11.
6. **Light theme is default; dark theme ships too** via CSS variables (financial apps get long evening use; dark mode is built as its own theme, not an inversion).

### 18.2 Color allocation rule (70 / 20 / 10)
- **≈70%** warm neutral surfaces (`--bg`, `--surface`, `--border`) and ink text
- **≈20%** ink interactive elements + semantic status colors (used sparingly)
- **≤10%** gold brand moments (active nav marker, selected chips, document totals row, logo area, focus ring on light inputs)

### 18.3 Core palette — light theme (default)
```css
/* Neutrals (warm-gray family, tinted toward the brand's warmth) */
--bg:          #F7F6F3;  /* page background */
--surface:     #FFFFFF;  /* cards, tables, sheets */
--surface-2:   #F1EFE9;  /* table header rows, subtle wells, hovers */
--border:      #E4E0D5;  /* hairlines, dividers */
--border-strong: #CFC9BA;

/* Text (warm ink ramp — all AA on their backgrounds) */
--text:        #1D1B16;  /* primary text, ~15:1 on --bg */
--text-2:      #57534A;  /* secondary text, ~7.5:1 on --bg */
--text-3:      #79736A;  /* muted/meta text, ≥4.5:1 on --bg/--surface */
--text-invert: #F7F6F3; /* text on ink/gold-dark fills */

/* Interactive (near-black primary — the shadcn/ui pattern) */
--primary:        #1D1B16;  /* primary buttons, links, active checkbox */
--primary-hover:  #33302A;
--on-primary:     #FFFFFF;
--ring:           #1D1B16;  /* focus ring, 2px + 2px white offset */

/* Brand accent — gold, accent-only (see §18.4) */
--gold:        #C9A24B;  /* brand moments, selected indicators, document grand-total row */
--gold-deep:   #9A7A34;  /* gold on light: only where ≥3:1 needed (large text/graphics) */
--gold-tint:   #F5EDDA;  /* selected-row wash, active chip fill, metric highlight */
--gold-ink:    #6E5620;  /* gold-family text that passes 4.5:1 on light surfaces */
```

### 18.4 Where gold is allowed / forbidden
| Allowed ✓ | Forbidden ✗ |
|---|---|
| Logo, login-page brand lockup, thin 3px top accent bar | Primary button fills (ink instead) |
| Active-nav indicator (2px marker + gold-tint wash) | Body/label text (use `--text` family) |
| Selected chip fill (`--gold-tint`) with `--gold-ink` text | Link color (ink, underlined on hover) |
| Document grand-total row + title strip on print docs | Success/warning meanings (semantic colors own those) |
| Sidebar active item marker on ink sidebar (`--gold` on ink passes 3:1 as graphic) | Badges for status (semantic map below) |

### 18.5 Semantic status colors (reserved, never brand-use)
```css
--success:       #177245;  --success-bg: #E4F3EA;  /* Paid, Approved, saved */
--warning:       #9A5B00;  --warning-bg: #FBF0DC;  /* Partially Paid, expiring soon (orange-leaning to stay clear of gold) */
--danger:        #B3261E;  --danger-bg:  #FBEAE9;  /* Rejected, delete, overdue, errors */
--info:          #1D5FBF;  --info-bg:    #E8F0FC;  /* Sent, neutral notices */
```
Rules: always paired with icon + label; tint backgrounds for badges/banners with the strong color for text/icon; red/green never side-by-side at equal brightness in charts (outstanding bars use ink, not red).

### 18.6 Status → badge mapping (single source for `StatusBadge`)
| Status | Treatment |
|---|---|
| Draft | Gray outline: `--text-3` border/text on `--surface-2` |
| Sent | Info: `--info` text on `--info-bg` |
| Approved | Success: `--success` text on `--success-bg` + check icon |
| Rejected | Danger: `--danger` text on `--danger-bg` + × icon |
| Expired | Gray solid (time-expiry is nobody's fault — no red) |
| Converted | Warning (amber): `--warning` text on `--warning-bg` — **changed from "ink solid + gold left-border"**. Amber makes the five statuses a readable neutral→committed scale and matches the status-breakdown chart. The cost: amber is also the Partially *Paid* invoice colour and §18.5 keeps warning deliberately "orange-leaning to stay clear of gold". The two never share a badge or a chart, but the family overlap is real — revisit in the Phase 11 contrast pass |
| Unpaid | Gray outline (neutral until due) |
| Partially Paid | Warning: `--warning` on `--warning-bg` |
| Paid | Success: `--success` on `--success-bg` + check icon |

### 18.7 Dark theme (CSS-variable swap, same component code)
```css
--bg: #14120E;  --surface: #1C1915;  --surface-2: #26221C;  --border: #35302680 (via #353026);
--text: #F0EEE8;  --text-2: #B5AFA2;  --text-3: #8F8878;
--primary: #E9E4D8;  --primary-hover: #FFFDF6;  --on-primary: #1D1B16;  /* ink↔cream flip */
--gold: #D9B45C;  --gold-tint: #3A311A;  --gold-ink: #E4C36A;  /* gold lightens for dark surfaces */
--success: #4CC38A;  --warning: #E0A458;  --danger: #F26D6D;  --info: #6AA5F8;  /* lifted for dark */
```
Surfaces are stepped (`bg < surface < surface-2`) for depth — never pure `#000`; text is off-white, never `#FFF` (avoids halation). Theme choice: system default + manual toggle, persisted locally.

### 18.8 Chart tokens (dashboard only — separate from UI palette)
```css
--chart-1: #1D1B16;  /* Received (ink — the metric that matters most) */
--chart-2: #C9A24B;  /* Invoiced (gold) */
--chart-3: #79736A;  /* Quotations / tertiary series */
--chart-grid: #E4E0D5;  /* axis/grid lines */
```
Max 3 series per chart; magnitude shown by position/label, not hue; tooltips label values explicitly.

### 18.9 Typography
- **UI:** Inter (self-hosted, weights 400/500/600/700), `font-feature-settings: "tnum"` on all money columns/tables.
- **Brand:** Fraunces or Playfair Display (self-hosted) — login wordmark, dashboard greeting, document company name only.
- Scale: 12 / 13 (base, UI-dense) / 14 / 16 / 18 / 22 / 28; line-height 1.45 body, 1.2 headings; `letter-spacing: 0.02em` uppercase micro-labels (e.g. "OUTSTANDING").

### 18.10 Geometry, spacing, elevation, motion
- Radius: 8px inputs/buttons, 12px cards, 999px chips/badges; borders 1px `--border` (no shadow stacking on light theme; shadows only for overlays: `0 8px 24px rgb(29 27 22 / 0.08)`).
- Spacing: 4px grid; card padding 16/20px; table row height 44px (touch-safe).
- Focus: 2px `--ring` outline + 2px offset on every interactive element (keyboard-first).
- Motion: 120–160 ms ease-out on opacity/transform only; no entrance animations on data.

### 18.11 Implementation notes
- All colors are CSS custom properties in `styles/tokens.css`, which every stylesheet consumes via `var(--token)`; **no raw hex in component or page stylesheets** — this is what makes the dark theme a swap, not a rewrite. Reusable components own their classes (CSS Modules); page-specific styles stay with the page, so shared and page styles never mix.
- Contrast pairs are locked in a token test (Vitest asserting the documented ratios) so a future tweak can't silently break AA.
- Final gold hex tuned against the real logo when the document surface is first rendered (Phase 6) and re-checked in the Phase 11 contrast pass (Appendix B, B6) — the rules in §18.4 are fixed even if values shift.

**Design tokens** live in `frontend/src/styles/tokens.css` (§23); the tables above are the spec.

**Component inventory (custom, small, reusable):** Button (+icon/loading/variant), Input/Textarea/Select with inline validation, MoneyInput (₹, Indian grouping, integer paise), QuantityInput, SegmentedControl (discount ₹/% toggle), StatusBadge, Card, DataTable (desktop) / DataCardList (mobile), Chip filter row, Modal, ConfirmDialog (destructive styling), Sheet (mobile bottom sheet), Toast, Tabs, EmptyState, Skeleton, Pagination, Timeline (status history), DocumentPaper (print), MetricCard, MiniChart wrappers.

**Patterns:** forms validate on blur + submit with inline errors; destructive actions are red-typed confirms requiring the exact action verb button ("Delete draft"); money always right-aligned tabular-nums; status always visible in lists *and* detail headers; every detail page has a **next-action bar** (from `allowed_actions`).

---

## 19. Responsive / Mobile Strategy

- **Breakpoints:** `< 768` mobile (primary), `768–1023` tablet, `≥ 1024` desktop.
- **Navigation:** sidebar on desktop; bottom nav + contextual FAB/sheet on mobile (§7).
- **Tables → cards:** below 768 px, list tables become stacked cards (primary line: number + client + total; secondary: status badge + date; tertiary: paid/outstanding). Never squeeze tables.
- **Quotation editor on mobile:** items as tappable cards (name, qty×rate, amount; expand to edit all fields); totals as a collapsible bottom bar that expands into a sheet with discount/GST/charges; sticky **Save / Preview** actions.
- **Forms:** single column on mobile, label-above-input, 44 px touch targets, numeric keyboards (`inputmode`) for qty/rate/phone, `autocomplete` where sensible.
- **Overflow guardrails:** global `min-width: 0` on flex children, truncate long client/item names with ellipsis + full value in detail view, horizontal chip scrollers for filters only, images max-width constrained. CI-ish checklist item: verify at 360×740 with no horizontal page scroll.
- **Desktop efficiency:** dense tables, keyboard submit (Enter), row actions on hover + always-visible overflow menu, multi-column forms in Settings.

---

## 20. Error / Empty / Loading States

| Surface | Convention |
|---|---|
| Initial page load | Skeleton shapes (no spinners for lists); max 1 spinner per view (buttons) |
| Empty lists | EmptyState: icon + one-line meaning + primary CTA ("No quotations yet — Create your first quotation") |
| Form errors | Inline field errors + top summary for submit failures; never rely on color alone |
| API errors | Toast with the server's `error.message` (or friendly fallback); form-level errors inline; 401 handled silently via refresh (§16) |
| 404 | Branded not-found page with links to Dashboard |
| 403/409/422 | Rendered from error envelope codes: conflicts show what to do ("Invoice already exists for this quotation — View invoice") |
| Network offline | Persistent offline banner + disabled mutations (§17); reads show cached data labeled as offline |
| Loading after action | Buttons show spinner + disabled; optimistic updates **not** used for financial mutations — always wait for the authoritative response |
| Slow save | Autosave indicator ("Saved 12:04" / "Saving…") in the quotation editor |

---

## 21. Validation & Edge Cases (explicit handling)

| # | Case | Handling |
|---|---|---|
| 1 | Empty quotation (no items) | Draft OK; Send blocked (BUSINESS_RULE) |
| 2 | Zero quantity / zero rate | Draft OK; Send blocked; line total shows ₹0 |
| 3 | Negative qty/rate/discount/charges | 422 at schema level |
| 4 | Discount > subtotal | 422 "Discount cannot exceed subtotal"; UI blocks live |
| 5 | Percent vs fixed discount | Explicit stored type; UI shows active mode; percent survives item edits, fixed re-validated |
| 6 | Invalid GST (negative, > 28) | 422; UI clamps input range |
| 7 | NaN/undefined totals | Impossible by design: integer-only math, schema type checks |
| 8 | Large quantities / rates (qty 10⁶, rate 10⁹ paise) | Overflow cap 10¹² paise per field → 422 beyond; totals use safe integers |
| 9 | Large quotations (60+ items) | Virtualization not needed at this scale; pagination in print tested; reorder stays usable |
| 10 | Multiple payments | Sum-based paid/outstanding; status recomputes; payment history listed |
| 11 | Payment > outstanding | 422 server-side; live warning client-side |
| 12 | Rejected / expired quotation | Statuses + computed Expired overlay; approve-after-expiry requires confirm (+optional validity extension); rejected can be duplicated |
| 13 | Duplicate invoice creation | Partial UNIQUE(quotation_id) → 409 with "View invoice" link |
| 14 | Duplicate numbering | Impossible via counter allocation (§12) |
| 15 | Browser refresh during creation | Debounced autosave to Draft + beforeunload warning; editor restores draft by id |
| 16 | Network failure on save | Error toast, unsaved state preserved in form, retry on reconnect; **no fake success** |
| 17 | Missing client on quotation | Client required to Send; picker modal for quick creation |
| 18 | Archived client with history | History intact (RESTRICT FK); excluded from lists/pickers; documents show snapshot data |
| 19 | Long item descriptions | Wrap in table + documents; 2000-char cap; print tested with 3-line descriptions |
| 20 | Long client names | Truncate with ellipsis in lists; full in detail; 200-char cap |
| 21 | Small screens | §19 guardrails; verified at 360 px |
| 22 | Multi-page PDFs | §14.4 test matrix; repeating headers, no orphan totals |
| 23 | Missing logo | Documents render a typographic wordmark fallback ("Ruchita Interiors" in brand serif); UI shows initials avatar |
| 24 | Missing optional company details (bank, GSTIN, website) | Fields omitted cleanly in documents; bank block hidden on invoice if empty; no "None"/"undefined" leaks |
| 25 | Settings prefix changed later | New documents use new prefix; historical numbers immutable |
| 26 | Concurrent tabs | Last-save-wins with updated_at check → 409 "Document changed elsewhere — reload" |
| 27 | Clock/timezone | Business dates are DATEs (no tz math); timestamps UTC internally |

---

## 22. Testing Strategy

| Layer | Tools | Scope |
|---|---|---|
| Backend unit/service | **pytest** (+ factory data builders) | The heart of the suite |
| Backend API | pytest + Flask test client | Endpoint contracts, auth, error envelope |
| Frontend unit | **Vitest** | Money/quantity parse-format utils, integer calc mirror, Zod schemas |
| Frontend component | Vitest + Testing Library | Forms (validation, discount toggle), status badges/allowed actions, list filters |
| E2E | **Playwright** | Full business journey + mobile viewport pass |
| DB | Covered via API/service tests | Constraints, FK behavior, transactions (e.g., force conversion failure → assert nothing persisted) |

**Mandatory dedicated financial tests (`test_calculations.py`)** — exact paise assertions: line totals with 3-decimal qty; percentage discount rounding; fixed discount edge (= subtotal, 1 paise under); GST rounding half-up cases (e.g. taxable ₹100.005); other charges; grand total identity; zero-value edge; recompute after item edit.
**Numbering tests:** sequential allocation; year rollover; delete-does-not-reuse; restart-persistence; unique under repeated allocation; prefix from settings; immutable historical numbers.
**Lifecycle tests:** every legal transition; every illegal transition → 409/422; expired overlay; reopen rules; convert guard; cancel-with-payments blocked.
**Payment tests:** advance, multiple partials, exact full, overpay rejection, delete-recalculation.
**Auth tests:** login success/failure/lockout, refresh rotation, protected-route 401s, CSRF rejection on missing header, password change.
**Conversion/snapshot tests:** invoice equals quotation at conversion; subsequent quotation edit attempts blocked; settings change does not alter existing invoice; cancel → re-invoice allowed.

**E2E scenario (the §20 acceptance journey):** login → create client → create quotation (3 items across 2 categories, 5% discount, 18% GST) → preview → mark sent → approve → create invoice → issue → record advance → record final payment → assert dashboard metrics & invoice shows Paid → print quotation & invoice → logout.
**Coverage targets:** backend services (`calculations`, `numbering`, lifecycle) ≥ 90%; overall backend ≥ 80%. Test DB = isolated SQLite file per run.

---

## 23. Recommended Project Folder Structure

```
ruchita-interiors/
├─ PLAN.md                      # this document
├─ README.md                    # run instructions, env setup
├─ .env.example
├─ backend/
│  ├─ wsgi.py
│  ├─ requirements.txt
│  ├─ .env.example
│  ├─ migrations/               # Alembic
│  ├─ uploads/                  # gitignored — logo, branding
│  ├─ tests/
│  │  ├─ conftest.py            # app/db fixtures, auth helpers
│  │  ├─ test_calculations.py   # financial core
│  │  ├─ test_numbering.py
│  │  ├─ test_lifecycle.py
│  │  ├─ test_payments.py
│  │  ├─ test_auth.py
│  │  ├─ test_clients.py
│  │  ├─ test_quotations_api.py
│  │  └─ test_invoices_api.py
│  └─ app/
│     ├─ __init__.py            # create_app() factory
│     ├─ config.py              # env-driven (dev/prod)
│     ├─ extensions.py          # db, migrate, jwt, cors
│     ├─ models/                # user.py client.py quotation.py invoice.py payment.py settings.py terms.py counter.py
│     ├─ api/                   # blueprints: auth.py clients.py quotations.py invoices.py payments.py dashboard.py settings.py uploads.py
│     ├─ schemas/               # marshmallow: per domain
│     ├─ services/              # calculations.py  numbering.py  lifecycle.py  snapshot.py  dashboard.py
│     ├─ utils/                 # money.py  validators.py  errors.py  responses.py  uploads.py
│     └─ seed/
│        ├─ seed_admin.py       # flask CLI: create user from env
│        └─ seed_defaults.py    # settings row, default terms, category list
└─ frontend/
   ├─ index.html
   ├─ vite.config.js            # + vite-plugin-pwa config
   ├─ eslint.config.js          # ESLint flat config (react, react-hooks)
   ├─ package.json
   ├─ public/
   │  ├─ manifest.webmanifest
   │  ├─ brand/                # bundled wordmark (Settings logo upload arrives Phase 3)
   │  └─ icons/                 # 192, 512, maskable, apple-touch
   └─ src/
      ├─ main.jsx
      ├─ app/                   # router.jsx  providers.jsx  guards.jsx
      ├─ api/                   # client.js (fetch wrapper + CSRF + 401 refresh)  endpoints/*.js  types.js (JSDoc)
      ├─ components/ui/         # Button, Input, MoneyInput, Modal, StatusBadge, DataTable, ... (§18) + *.module.css
      ├─ components/layout/     # AppShell, Sidebar, BottomNav, TopBar, OfflineBanner + *.module.css
      ├─ features/
      │  ├─ auth/               # LoginPage, useAuth
      │  ├─ dashboard/
      │  ├─ clients/            # list, detail, ClientFormModal, ClientPicker
      │  ├─ quotations/         # list, QuotationEditor, ItemsEditor, TotalsPanel, detail
      │  ├─ invoices/           # list, detail, PaymentSheet
      │  ├─ settings/           # sections per §15
      │  └─ documents/          # DocumentPaper, PrintToolbar
      ├─ pages/                 # thin route components mapping to features (+ /print/*)
      ├─ hooks/                 # useQuery wrappers, useOnline, useConfirm
      ├─ lib/                   # money.js  quantity.js  calc.js (display mirror)  format.js  validation.js (zod)
      └─ styles/                # tokens.css  base.css  print.css  index.css
```

**Layering rules:** API blueprints are thin (parse → validate → call service → respond). Business rules live in `services/`. Models hold no logic beyond relationships. Frontend `features/*` own their pages/state; `components/ui` stays domain-agnostic; no fetch calls outside `api/`; no money math outside `lib/calc.js` (frontend) and `services/calculations.py` (backend).

---

## 24. Development Phases

> Each phase lists Objective → Work → Tests → Dependencies → Exit gate. Acceptance criteria are in §25. Do not start a phase before its dependencies' exit gates pass.

> **Status of each phase as of 2026-10-01** (§0 is the canonical status): **Phases 1–10 implemented and verified.** Phase 9A (services catalog) shipped alongside Phase 9. Phase 11 is **partially** complete — the §16 security checklist is addressed, but the §21 edge-case sweep, the §20 states audit and the a11y pass are outstanding, so its exit gate has **not** been met. Phase 12 has not started. The phase definitions below are kept as delivered, not rewritten.

**Phase 1 — Architecture & project foundation**
Objective: running skeleton of the whole system.
Work: monorepo scaffold (backend app factory + config + `/health`; frontend Vite + React/JSX + plain-CSS design tokens + router + AppShell with sidebar/bottom-nav + empty pages; PWA manifest + basic SW; ESLint/format/test tooling; `.env.example`s; README run instructions).
Tests: health endpoint test; frontend lint + unit tests + production build green; smoke render test.
Dependencies: none. Exit: one-command run for both apps; shell responsive at 360/768/1280.

**Phase 2 — Authentication & user system**
Objective: secure single-user auth end-to-end.
Work: users model + migration; seed CLI; login/logout/refresh/me + password change endpoints; JWT cookie auth + CSRF double-submit; login rate limit; protected route guard + 401-refresh interceptor; Login page (brand-styled, show/hide, validation, loading/error).
Tests: `test_auth.py`; guard component test.
Dependencies: Phase 1. Exit: unauthenticated access impossible (API + UI), session survives reload/restart.

**Phase 3 — Database & company settings**
Objective: full schema + configurable business data.
Work: all §8.3 tables + Alembic migrations; settings endpoints; Settings UI (all §15 sections); logo upload + serving; default seeding (settings row, terms, categories/units).
Tests: settings CRUD; upload validation (reject SVG/oversize); migration up/down on empty + seeded DB.
Dependencies: Phase 2. Exit: all settings editable with no code change and persisted; logo renders in app shell.

**Phase 4 — Client management**
Objective: client book with history foundation.
Work: clients API (CRUD, archive/restore, search, summary) — the `clients` table and model already exist from Phase 3's migration, so no schema work; Clients list + detail pages (detail reachable for archived clients, archived badge + Restore there); client form modal; client picker with inline create — built and component-tested here as a reusable unit, first consumed by the Phase 5 quotation editor. Summary reads the real quotations/invoices/payments tables, which stay empty until Phases 5–8, so relationship sections show empty states and totals compute to zero.
Tests: `test_clients.py` (validation, search, archive + restore, summary totals incl. seeded fixture rows); frontend component tests — list search/filter, ClientFormModal validation, ClientPicker select and inline-create return.
Dependencies: Phase 3. Exit: create/search/edit/archive/restore client; detail shows relationship sections (empty states OK).

**Phase 5 — Quotation engine (core)**
Objective: the complete quotation feature.
Work: quotations + items + counters models/API; calculation service (§10) + numbering service (§12); lifecycle service (§13) + `allowed_actions`; QuotationEditor (items editor, categories chips, discount segmented control, GST, other charges, live totals, autosave); Quotations list (search/filters/sort/pagination, badges); Quotation detail (timeline, actions); duplicate; dashboard-ready data hooks.
Tests: `test_calculations.py`, `test_numbering.py`, `test_lifecycle.py`, `test_quotations_api.py`; editor component tests; Vitest money utils.
Dependencies: Phases 3–4. Exit: full quotation lifecycle works with backend-authoritative totals; numbering deterministic.

**Phase 6 — Quotation document / PDF**
Objective: send-ready branded quotation documents.
Work: DocumentPaper component + print routes + print.css (§14); preview overlay from editor/detail; terms snapshot rendering; signatory/footer; multi-page rules; wordmark fallback.
Tests: component test (renders snapshot data); E2E print-route smoke; manual matrix §14.4 recorded in PR.
Dependencies: Phase 5. Exit: quotation document looks professional and passes the multi-page matrix.

**Phase 7 — Invoice system**
Objective: quotation → invoice conversion and invoice management.
Work: invoices + invoice_items; conversion transaction (snapshot, §8.4); invoice numbering; invoice API + partial-unique rule; issue/cancel; Invoices list (payment-status filters) + detail; invoice print document (adds paid/outstanding + bank block).
Tests: conversion/snapshot tests, duplicate-invoice 409, cancel/re-invoice, `test_invoices_api.py`.
Dependencies: Phases 5–6. Exit: approved quotation converts once; invoice document matches quotation design.

**Phase 8 — Payments & financial tracking**
Objective: money-in tracking with correct states.
Work: payments API; payment sheet (method enum, reference, prefill outstanding, live warning); payment history on invoice detail; paid/outstanding computation & status transitions; delete-payment recalc; client summary totals wired.
Tests: `test_payments.py` (advance/partial/full/overpay/delete-recalc).
Dependencies: Phase 7. Exit: outstanding always = grand − payments; statuses correct after every mutation.

**Phase 9 — Dashboard & analytics**
Objective: truthful business overview.
Work: `/dashboard/summary` aggregate (§9.2 metric definitions); Dashboard page: metric cards, received-vs-invoiced trend, status breakdown, recent lists; strict metric separation (§23 rules).
Tests: summary API test with seeded scenarios (drafts excluded, cancelled excluded, outstanding math); snapshot UI test.
Dependencies: Phases 5, 7, 8. Exit: dashboard numbers match a hand-computed scenario exactly.

**Phase 10 — PWA / mobile optimization**
Objective: feel like a native-class mobile app.
Work: finalize manifest/icons/splash; SW offline policy UI (offline banner, disabled mutations, labeled cached reads); update toast; install affordances (Android/desktop + iOS card); mobile polish pass (bottom nav sheets, item cards, sticky bars, safe areas); overflow audit at 360 px; touch-target audit.
Tests: E2E mobile-viewport pass; Lighthouse PWA checks; manual iOS Safari install.
Dependencies: Phases 1–9 (polish after features). Exit: installable; no horizontal scroll; offline behavior per §17 with zero fake success paths.

**Phase 11 — Security, validation & edge cases**
Objective: hardening sweep before production.
Work: security checklist §16 review (headers, CORS, rate limit, upload hardening, secret hygiene); edge-case sweep executing every row of §21 (fix + add regression test for each); error/empty/loading states audit (§20); a11y pass (focus, labels, contrast); 409 concurrent-edit check.
Tests: regression tests for every §21 row that is server-side; security smoke tests (missing CSRF, wrong origin, oversize upload, malformed JSON).
Dependencies: Phases 5–10. Exit: §21 table fully green; security checklist signed off.

**Phase 12 — Full testing & production readiness**
Objective: shippable.
Work: complete Playwright suite (§22 journey); coverage report; performance pass (paginated queries, index review, bundle budget); seed/prod checklist (env secrets, strong admin password, real logo/terms/bank settings); backup runbook doc (+ optional Settings → Download backup); README finalize; version tag.
Tests: full suites green; E2E on desktop + mobile viewports; fresh-clone → running in ≤ 10 minutes.
Dependencies: all. Exit: §25 Phase-12 checklist green → production release.

---

## 25. Acceptance Criteria (per phase)

### Gate for closing any phase

A phase is **not done** until all three hold:

1. `npm run verify` (lint, format, all tests, production build) is green.
2. The dev environment is up and the app is **loaded in a real browser** at
   `http://127.0.0.1:5173`, with the phase's own flows exercised there.
3. The backend and frontend were started via `npm run dev:start`, and remain
   reachable after the command that started them has exited.

Criterion 2 exists because criterion 1 is not sufficient. In Phase 1 the app never
rendered at all — `DocumentTitle` was mounted as a sibling of `<RouterProvider>`
in `main.jsx`, so its `useLocation()` call threw and the whole UI showed the
ErrorBoundary. Every automated check passed, because each test built its own
memory router and the entry point itself was never under test. A green
`npm run verify` proves the parts are correct; only loading the app proves they
are wired together. Criterion 3 exists for the same reason: a dev server that dies
with the shell that launched it silently invalidates any browser check.

**Phase 1** — [x] `backend` serves `/health` 200 · [x] `frontend` renders branded shell with nav on mobile + desktop · [x] lint + unit tests + production build clean both sides · [x] manifest present, install prompt available · [x] README: clone → run steps work on a clean machine.

Retrospective note: the "renders branded shell" criterion was ticked on the strength
of automated checks alone and was not true — the app raised on first paint. Found
and fixed during Phase 2's browser check; `frontend/src/app/main.test.jsx` now
mounts the real entry point so it cannot regress unnoticed.

**Phase 2** — [x] Login with seeded env credentials works · [x] wrong password → generic error, no user enumeration · [x] reload keeps session; restart of browser too (refresh cookie) · [x] logout clears session; protected APIs return 401 without cookies · [x] missing CSRF header on POST → 403 · [x] 6th login attempt in 5 min → 429 · [x] password change works and old sessions' refresh is invalidated.

Verified by 43 backend tests, 50 frontend tests, and a live HTTP smoke run against the dev server (real `Set-Cookie` headers, refresh-cookie path scoping, CSRF rejection without the header). One criterion is qualified: see B7 — the limiter counts failures rather than attempts.

**Phase 3** — [x] All §8.3 tables exist via migrations; `alembic downgrade base` then `upgrade head` succeeds · [x] every Settings section saves, validates and reloads correctly · [x] PNG ≤ 2MB uploads; SVG and 3MB file rejected with clear errors · [x] starter terms + categories seeded · [x] changing settings needs no code — prefix edits persist and read back live (the *new-document preview* that consumes them arrives with Phase 5's editor; verified at the API level today).

**Phase 4** — [x] Client CRUD with validation (name required) · [x] search matches name/phone/email · [x] archive asks for confirmation, hides from lists/pickers, `include_archived=true` shows · [x] restore from client detail brings an archived client back (active again in pickers) · [x] client detail shows sections + totals (empty-safe), and an archived client's URL still resolves · [x] picker + inline create modal work as one unit (search → select; inline create returns the new client selected) — full round-trip inside the quotation editor verified when Phase 5 lands.

**Phase 5** — [x] New quotation allocates `QTN-2026-0001` then `-0002` sequentially · [x] items add/remove/reorder; totals live and correct in paise-exact terms · [x] percent and fixed discount both work; >subtotal blocked client- and server-side · [x] GST + other charges flow into grand total · [x] Send blocked with zero/invalid items (message shown) · [x] approve requires confirm; converted lock verified · [x] duplicate creates a new draft with a new number · [x] list search/filters/sort/pagination work · [x] calculation + numbering test suites pass at ≥ 90% service coverage.

**Phase 6** — [x] Print route renders A4 branded quotation with real settings data · [x] 60-item document: repeated header, no broken rows, totals not orphaned · [x] terms, signatory, footer render from settings snapshot · [x] missing logo → wordmark fallback · [x] Print → Save as PDF produces a clean A4 PDF in Chrome and Safari · [x] preview overlay reachable from editor and detail.

**Phase 7** — [x] Approved quotation shows Create Invoice; conversion produces invoice with identical items/totals · [x] second conversion attempt → 409 with view link · [x] `INV-2026-0001` sequence independent of QTN · [x] issue locks items; cancel (no payments) releases quotation to Approved and permits re-invoice · [x] quotation edit after conversion impossible · [x] editing Settings bank/prefix afterward does not alter the issued invoice · [x] invoice print document complete (paid/outstanding appear once payments exist).

**Phase 8** — [x] Advance payment records; status → Partially Paid; outstanding updates · [x] multiple payments accumulate; exact final payment → Paid · [x] overpay → 422 + UI warning · [x] payment delete recalculates status (Paid → Partially Paid/Unpaid) · [x] payments only on issued invoices · [x] client summary totals reflect payments · [x] Settings-managed UPI QR printed on invoices only, live from Settings and never snapshotted (FR-P6, §8.4.5).

Verified by 249 backend tests and 188 frontend tests, plus `npm run verify` (lint, format, backend + frontend tests, production build) green at commit `64662c1`. Outstanding from §8.5: allocation of one payment across several invoices, and ageing / receivables reporting.

**Phase 9** — [x] All §9.2 dashboard fields present and correct on the seeded scenario · [x] drafts excluded from money metrics; cancelled invoices excluded; received = Σ payments only · [x] recent lists navigate correctly · [x] charts render 12-month series · [x] single request powers the page · [x] mobile dashboard layout clean at 360 px.

Verified by 276 backend tests and 214 frontend tests, plus `npm run verify` (lint, format, backend + frontend tests, production build) green. The exit gate is a literal test: the expected counts, values and money figures are stated as hand-written constants in `backend/tests/test_dashboard.py` and asserted as whole dicts, so a newly added figure cannot slip in unverified. Two decisions resolved during implementation: `total_quotation_value` counts **all** quotations regardless of status, and Recharts is code-split behind a lazy boundary so it does not enter the entry chunk.

**Phase 10** — [ ] Lighthouse PWA: installable, no offline-write traps flagged by manual test · [ ] installed app opens standalone with correct icons/splash · [ ] airplane mode: banner shows, save disabled, reads labeled offline, no fake success · [ ] update toast appears on new deploy · [ ] 360 px: zero horizontal scroll across all pages; targets ≥ 44 px · [ ] bottom nav + sheets thumb-friendly.

**Phase 11** — [ ] Every §21 row has an implemented, verified behavior (regression test where server-side) · [ ] security checklist §16 fully satisfied · [ ] malformed/oversize/mismatched-type inputs → 422 envelope, never 500 · [ ] 500s return generic message + error id, details in logs · [ ] a11y: keyboard-navigable core flows, visible focus, contrast AA on text and interactive components, colorblind-simulation pass on badges/charts (§18.1).

**Phase 12** — [ ] Full test suites green (unit + API + E2E desktop & mobile) · [ ] backend service coverage ≥ 90%, overall ≥ 80% · [ ] Playwright business journey passes end-to-end · [ ] fresh-clone → running ≤ 10 min using README · [ ] `.env.example` complete; no secrets in repo (`git log` checked) · [ ] backup runbook documented; optional backup action verified · [ ] production deployment checklist executed (secrets rotated, admin password strong, real branding configured).

---

## 26. Future Scalability Considerations

**Principle:** do not build now; do not block later. Hooks already present in this architecture:

| Future item | Hook that keeps it cheap |
|---|---|
| Multiple users / roles / employees | `users.role` column + `created_by` FKs already recorded; auth is middleware, not page logic |
| Branches | Settings rows → branch table; documents already snapshot what they print |
| Client portal / online approval | Quotation has a stable number + status machine; a public token column is additive |
| Digital signature | Document spec reserves the signatory zone |
| Payment gateway | Payments stay a clean manual ledger on invoices - no PSP/aggregation, no webhook reconciliation. A UPI QR is a *payment instruction*, never a confirmation: scanning it tells the application nothing, and `payment_status` moves only through Record Payment (§11). The QR is **generated** from the UPI ID (FR-P6) - a static uploaded image could not encode an amount or a payee at all. Which details it sits beside is the invoice's own `payment_method` (FR-P8), frozen at issue: on the invoice the code encodes the grand total, and the outstanding balance lives on the regenerable Balance / Payment Due document, because an invoice must not change when a payment arrives |
| Email/WhatsApp sharing | Documents are reproducible from data; add an outbound-service module later |
| Cloud storage for uploads | `utils/uploads.py` is the single storage seam |
| Automated cloud backup | DB is a single file + `uploads/` dir — the backup action/runbook seam can push to cloud storage later |
| Audit logs | All mutations flow through services — add an audit decorator/table without touching callers; payment corrections get a proper reversal ledger |
| Project/expense/purchase modules | New blueprints/models follow the established pattern; no coupling to quotation internals |
| FY-based numbering | `numbering_counters` is year-bucketed; a Settings flag switches bucket key |
| Multi-charge rows / multi-currency | `other_charges` v1 fields documented as replaceable by a charges child table; money is already paise-integer |

**Explicitly deferred (not implemented):** everything in §1.3. Any PR introducing them without a plan amendment is out of scope.

---

## 27. Risks & Technical Decisions

### 27.1 Decision log
| # | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| D1 | Money as integer paise; qty as milli-units; % as basis points | Eliminates float bugs; exact GST rounding; deterministic everywhere | Conversion helpers at I/O boundaries (tested) |
| D2 | Backend is the only calculation authority | Financial integrity; offline/tempered clients can't corrupt totals | Client keeps a display-only mirror (clearly labeled) |
| D3 | Browser print pipeline for PDFs | Zero fragile native deps; brand-consistent; native Save-as-PDF | Byte-exact PDFs not guaranteed cross-browser; server renderer possible later |
| D4 | Numbers allocated at Draft creation, per-year counters, never reused | Predictable previews/lists; simple crash-safe allocation | Gaps possible after draft deletion — intentional and documented |
| D5 | Snapshot-on-conversion + quotation-level client snapshot | Historical documents immutable; client edits safe | Storage duplication (trivial at this scale) |
| D6 | JWT in httpOnly cookies + CSRF double-submit | XSS-resistant, PWA-friendly persistence | Slightly more moving parts than localStorage tokens |
| D7 | Invoice items lock at Issue; quotation items lock at Sent/Approved | Prevents retroactive document mutation | Users must duplicate/revise to change sent quotes |
| D8 | Plain CSS design tokens + custom component set (no CSS/utility framework) | Exact brand control; small bundle; tokens are the only place a raw value is written | More CSS to write by hand (bounded inventory in §18) |
| D9 | Archive/soft-delete for all financial records; hard delete only for drafts | Financial safety | Archived data accumulates (fine at this scale) |
| D10 | No offline writes (visible network requirement) | No silent data loss or fake success in a financial app | Reduced convenience; honest UX per requirement §27 |
| D11 | `allowed_actions[]` from server drives all action buttons | One source of truth for lifecycle rules | Slightly richer API payloads |

### 27.2 Risk register
| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Money/rounding bugs erode trust | M | High | D1 + mandatory paise-exact test suite (§22); property-style test cases |
| R2 | Print/PDF fidelity varies by browser | M | Medium | Chrome-first + Safari verification matrix (§14.4); mm/pt sizing; server renderer as fallback plan |
| R3 | SW serves stale app after deploys | M | Medium | Versioned precache + update toast (§17); never cache API mutations |
| R4 | SQLite write-lock contention or file corruption | L | High | Single user by design; WAL mode + busy_timeout; short transactions; integrity_check in runbook; regular backups (§8.5) |
| R5 | Scope creep into enterprise features | M | Medium | §1.3 non-goals + §26 deferral list enforced in reviews |
| R6 | Brand assets arrive late/low quality | M | Medium | Tokens defined now, tuned in Phase 1; wordmark fallback (§21.23) |
| R7 | Data loss (single SQLite file) | L | High | Backup runbook (§27 D9/§5); optional Download-backup action; uploads dir included in runbook |
| R8 | GST rule/rate changes | M | Low | Rate per-document + Settings default; no hard-coded tax logic |
| R9 | Single-user assumption leaks (e.g., trusted client data) | L | High | All endpoints authenticated; authorization middleware seam exists for future roles |
| R10 | Windows dev-environment friction (native deps) | M | Medium | D3 avoids WeasyPrint; pure-Python backend deps only |

---

## 28. Final End-to-End Workflow (the system in one pass)

1. **Open app** — PWA standalone; refresh cookie restores session, else `/login`.
2. **Login** — scrypt-verified password; access+refresh cookies set; redirect to Dashboard.
3. **Dashboard** — quotations by status, pipeline values, invoiced, received, outstanding, recent activity.
4. **Create client** — modal or Clients page; validation; appears in pickers.
5. **Create quotation** — number `QTN-2026-0007` allocated immediately; pick client; set dates/validity.
6. **Add interior work** — items grouped by category chips (Kitchen, Wardrobe…), each with unit, qty (milli-exact), rate (paise-exact); reorder freely; live line totals.
7. **Discount** — toggle ₹ / % (active mode always visible); validated ≤ subtotal.
8. **GST & other charges** — GST prefilled 18% (editable 0–28); optional labelled charge row.
9. **Autosave** — draft persists (debounced); refresh-safe.
10. **Preview** — branded DocumentPaper overlay; everything from Settings snapshots.
11. **Save / Mark Sent** — server guard validates items/totals; items lock.
12. **Client approves → Mark Approved** — confirm dialog with totals; document freezes.
13. **Create Invoice** — one transaction: snapshot (client, items, totals, terms, bank, signatory) + `INV-2026-0004` + quotation → `converted`; duplicate attempts → 409.
14. **Review & Issue** — dates/notes editable while Draft; Issue locks items and enables collection.
15. **Record advance** — payment sheet prefilled with outstanding; method/reference; server validates ≤ outstanding; status → Partially Paid.
16. **Track outstanding** — invoice header and dashboard keep `grand − paid` always visible.
17. **Print/PDF** — invoice document mirrors quotation branding; A4-safe across pages.
18. **Repeat payments** until outstanding = 0 → status **Paid**; metrics update everywhere.
19. **Exceptions** — reject/expiry/reopen/duplicate/cancel paths behave per §13 without ever rewriting history.
20. **Every number the user sees is server-computed, snapshot-safe, and test-covered.**

---

### Appendix A — Reference material
- Website/brand: https://ruchitainteriors.in/ (gold / near-black / warm off-white identity)
- Brand assets: `brand/logo.svg` (official source vector, as supplied) → optimized shipped vector at `frontend/public/brand/logo.svg` (~124 KB, under the 150 KB guard) → generated PWA icon set in `frontend/public/icons/`; reference quotation screenshot (visual reference only — improve, don't copy)
- Requirement source: client brief (this document's §4–§21 trace to it)

---

## Appendix B — Approved decisions & supersessions

> This appendix is part of the single source of truth. Where it conflicts with §1–§28, **this appendix wins**. Everything else in this document stands as written.

| # | Decision | Supersedes / changes | Rationale & effect |
|---|---|---|---|
| **B1** | **The frontend is JavaScript + JSX only, permanently.** `.js` / `.jsx` only. **No** `.ts` / `.tsx`, **no** `tsconfig.json`, **no** TypeScript dependencies, **no typecheck requirement**. Where types are needed, use JSDoc + ESLint. | §1.2 (React 18 + TypeScript + Vite), §5 "typed frontend", §22, §23 `*.ts` paths, §24 Phase 1 "typecheck", §25 Phase 1 "typecheck clean", §28.28 numbering unaffected. §1.2's React version also superseded: **React 19** is used. | Client's explicit technology decision. Quality gates become **ESLint + unit tests + production build**. |
| **B2** | **Styling is structured plain CSS with centralized design tokens. No Tailwind, no Bootstrap, no CSS/utility framework** (unless a later phase explicitly requires one). | §1.2 "Tailwind CSS", §18.11 "mapped into Tailwind theme", §27.1 D8. | Client's explicit decision. Tokens (`styles/tokens.css`) remain the single place a raw value is written; dark theme stays a variable swap. |
| **B3** | **Styling architecture** | — | `styles/tokens.css` (all tokens: colour, type scale, spacing, radii, borders, shadows, transitions, z-index, UI states, breakpoints) + `styles/base.css` (reset, element defaults, a11y utilities) + `styles/print.css` (A4/print, kept separate from app chrome) + `styles/index.css` (import order). Reusable components use **CSS Modules** co-located with the component (`Button.jsx` + `Button.module.css`); page-only styles live with the page. **No raw hex/rgba/px colour values outside `tokens.css`.** |
| **B4** | **Tooling:** ESLint (flat config, `eslint-plugin-react` + `eslint-plugin-react-hooks`) for linting, Prettier for formatting, Vitest + Testing Library for unit/component tests, `vite build` for the production gate. | §24 Phase 1 "lint/typecheck/format tooling", §25 Phase 1. | Matches the client's "use ESLint, production build, tests" instruction. |
| **B5** | **One-command run** | §24 Phase 1 exit gate. | Root `package.json` + `concurrently`; `npm run dev` starts both apps, with `dev:api` / `dev:web` for single-service work. |
| **B6** | **Gold token tuning deferred** | §18.11 "tuned against the real logo in Phase 1". | The official logo's dominant gold measures ≈ `#D08A18` (hue ≈ 41°, i.e. the same hue as `--gold` but far more saturated). Raising saturation now would erode the deliberate separation from `--warning` (§18.5) and invalidate the contrast-locked token test. Tokens ship as documented in §18.3/§18.5/§18.7; the real-logo match is tuned where gold is first visible on a document (**Phase 6**) and re-verified in the **Phase 11** contrast pass. **Open item — must not be forgotten.** |
| **B7** | **The login rate limiter counts *failures* per window, not attempts.** 5 failures per 5 minutes per IP+email; a successful sign-in clears that identity's history. | §16 and §25 "5 attempts", "6th login attempt in 5 min → 429". | A user who mistypes once and then signs in correctly should not be locked out, and this system has no self-service recovery (§8.3, FR-A4) — a locked-out owner has no way back in. Brute force is still bounded: every wrong guess consumes budget, and only a success clears it. The §25 criterion is satisfied as written, because five failures are needed before the next request is refused. |
| **B8** | **`X-Forwarded-For` is ignored unless `TRUST_PROXY_HEADERS=true`.** With it on, `TRUSTED_PROXY_COUNT` proxies are assumed to append to the header. | §16 "keyed by IP + email" is unchanged; only the trust decision is added. | The header is client-controlled. Honouring it with no proxy in front would let an attacker mint a fresh IP per guess and defeat the limit entirely. Off by default is the safe reading; §16's intent is preserved. |
| **B9** | **`users.token_version` (integer) is an extra column, and `token_version`-based revocation is the mechanism for logout and password change.** | §8.3 table definition. | §25 requires logout to clear server-side and password change to invalidate other sessions; a stateless JWT cannot be revoked and §8.3 has no column to revoke against. One integer and one write, no extra table. |
| **B10** | **Dev servers start detached via `scripts/dev.ps1` (`npm run dev:start`), not as children of the invoking shell.** `npm run dev` remains for a human watching both logs in one terminal. | Supersedes B5's mechanism, not its intent — one command still starts both apps. | A server started as a child of the agent's shell dies when that shell is torn down, which silently invalidates any browser check performed afterwards. WMI `Win32_Process.Create` parents the new process to the WMI service host instead, so it outlives the caller. The script also refuses to kill a port holder it does not recognise, and reuses a healthy server rather than restarting it. |
| **B11** | **A phase closes only after a real-browser check on the running dev servers, not on `npm run verify` alone.** See the gate at the top of §25. | Tightens §25 for every phase, including Phases 3–12. | Phase 1 shipped an app that could not render: `DocumentTitle` sat outside the router, so first paint threw and every automated check still passed, because the tests exercised the route table and never the entry point. `frontend/src/app/main.test.jsx` now mounts the real composition, but that cannot cover CSS, fonts, service worker, PWA install or genuine layout — only loading the app can. |

### Explicitly NOT changed by this appendix
Calculation rules (§10–§11), numbering (§12), lifecycle (§13), documents (§14), data model (§8), API contract (§9), security (§16), PWA policy (§17), design principles and palette allocation (§18.1–§18.8, §18.10), responsive rules (§19), error/empty/loading conventions (§20), edge cases (§21), backend architecture (§23), the 12 phases and their acceptance criteria (§24–§25) — all remain as written.
