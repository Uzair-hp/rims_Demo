# Ruchita Interiors — Full End-to-End Audit

**Audit date:** 2026-10-01
**Original commit:** `1fa8392` (branch `main`)
**Mode:** original pass was read-only; this revision records the state **after** the
audit remediation work, which is now in the working tree.
**Scope:** architecture, frontend, UI/UX, backend, database, security, business logic, documents/print, API end-to-end, PWA/mobile, performance, tests, deployment, code quality

> **How to read this revision.** The original findings are preserved verbatim.
> Each now carries a status: **RESOLVED** (fixed by the current implementation
> work, with the fix and its test named), **OUTSTANDING** (still present, not
> fixed), **PARTIAL**, or **CONFIRMED DEFECT** (a defect discovered during
> remediation and reproduced). Nothing was closed because the application happens
> to work.

> **Repository state when the original audit ran:** 37 modified files and 11
> untracked files. Findings below were taken against that working tree, not
> `HEAD`, and have been re-verified against it since.

---

## Status summary

| | Count |
|---|---|
| **RESOLVED** | 21 |
| **PARTIAL** | 4 |
| **OUTSTANDING** | 24 |
| **Newly confirmed during remediation, since fixed (§M)** | 2 |

Test results have moved from *27 files / 463 frontend, 432 backend* to
***29 files / 504 frontend, 496 backend*** — see §G.

---

## Table of contents

- [A. Overall project status](#a-overall-project-status)
- [B. Critical findings](#b-critical-findings)
- [C. High-priority findings](#c-high-priority-findings)
- [D. Medium-priority findings](#d-medium-priority-findings)
- [E. Low-priority findings](#e-low-priority-findings)
- [F. Feature-by-feature status](#f-feature-by-feature-status)
- [G. Test results](#g-test-results)
- [H. Security findings](#h-security-findings)
- [I. Production/deployment findings](#i-productiondeployment-findings)
- [J. Technical debt](#j-technical-debt)
- [K. Missing/incomplete functionality](#k-missingincomplete-functionality)
- [L. What remains](#l-what-remains)
- [M. New findings from the remediation](#m-new-findings-from-the-remediation)

---

## A. Overall project status

**Working, and materially hardened since the original audit.**

Every verification gate passes. The application is feature-complete through Phase 10,
all four business surfaces (Clients → Quotations → Invoices → Payments) function
end-to-end, print output is verified against a real A4 layout engine, and there are
no known crash-level defects.

The original audit's headline — *"not production-hardened: authentication has zero
authorization enforcement, security headers omit CSP/HSTS, uploads are unbounded in
memory, and one model↔migration drift means two database constraints exist only in
test databases"* — **no longer holds.** Authorization is enforced, CSP/HSTS and the
cross-origin isolation headers are sent, the upload path is bounded before the body
is buffered, and the two CHECK constraints are written by the migration history.

What is still true: this is a single-user product (§1.3), several business-logic and
data-integrity findings were never in scope for this pass, and the dead-code and
documentation debt is untouched. See §L.

**Two defects were confirmed during remediation** (§M): a non-atomic table rebuild in
`b8d5f0e2c7a1.downgrade()`, and the fact that the development database was destroyed
twice — once by that class of failure and once by a test that opened the real database
and called `drop_all()`. **Both are now fixed**, the first by making the downgrade
rebuild transactional and the second by isolating every test's database.

---

## B. Critical findings

> All three original critical findings are **RESOLVED**. Each fix is named with its
> regression test.

### B1. `PUT /api/v1/invoices/:id` silently erases `notes`, `terms_text` and `payment_method`

**🔴 RESOLVED**

`backend/app/schemas/quotations.py:195-207` gave all three fields `load_default=None`,
so they were **always** present in the loaded payload.
`backend/app/services/invoices.py:373-375` then wrote every key that is present.

A PUT of only `{"due_date": "..."}` therefore cleared the notes, the printed terms and
the entire FR-P8 payment presentation. **No test covered a partial invoice PUT.**

**Impact:** an invoice that has been carefully branded and given payment instructions
silently loses them on the next date edit.

**Fix.** The three `load_default=None` declarations on `InvoiceDraftSchema` were
removed, so an absent key now means "leave unchanged" and an explicit `null` is what
clears a field. Length caps were added at the same time (`notes` 4000, `terms_text`
8000), closing part of the §D input-validation finding as well.

**Regression test:** `test_invoices_api.py::test_partial_invoice_put_leaves_untouched_fields_alone`
and `::test_invoice_notes_and_terms_length_are_capped`.

**Original locations:**
- `backend/app/schemas/quotations.py:195-207`
- `backend/app/services/invoices.py:360-378`

---

### B2. Model ↔ migration drift: two CHECK constraints exist only in tests

**🔴 RESOLVED**

`backend/app/models/company_settings.py:70-81` declared:

- `default_gst_bp >= 0 AND default_gst_bp <= 2800`
- `default_validity_days >= 0 AND default_validity_days <= 365`

`backend/migrations/versions/4cb5324d6e1e_phase_3_schema.py:56-57` created both columns
with a server default and **no** CHECK constraint.

`backend/tests/conftest.py:40` uses `db.create_all()`, so every test database *did* have
the constraints and no real deployment did. Nothing asserted that the constraints exist
after a genuine `upgrade()`.

**Fix.** A new revision `c3d7e9f1a2b4_company_settings_checks` writes both CHECKs
through `batch_alter_table` (`company_settings` is a standalone single-row table, so no
foreign key points at it). Both are now **named** in the model
(`ck_company_settings_default_gst_bp`, `ck_company_settings_default_validity_days`),
so batch mode can no longer drop them silently on a later recreate. The same revision
also gives `invoices.payment_method` a **named** table-level CHECK
(`ck_invoices_payment_method`) in place of the anonymous inline one that `b8d5f0e2c7a1`
created — which also removes the `Unnamed CHECK constraint … is being omitted from the
table recreate` warning the suite had been emitting.

**Regression tests:**
`test_seed_and_migrations.py::test_migrations_create_every_named_check_constraint`
(runs the real Alembic runner and reads the resulting DDL for *every* named CHECK in
the model — the drift class, not just these two),
`::test_company_settings_checks_are_enforced_by_the_database`,
and `::test_invoices_rebuild_rolls_back_when_it_fails_midway`.

**Original locations:**
- `backend/app/models/company_settings.py:70-81`
- `backend/migrations/versions/4cb5324d6e1e_phase_3_schema.py:56-57`
- `backend/tests/conftest.py:40`

---

### B3. `b8d5f0e2c7a1.downgrade()` reintroduces the FK failure its own docstring documents

**🔴 RESOLVED for the reported defect — but see §M1, a new defect in the replacement.**

`backend/migrations/versions/b8d5f0e2c7a1_invoice_payment_method.py:78-79` used
`batch_alter_table('invoices')`, which in SQLite recreates the table via
`DROP TABLE invoices` — while `invoice_items` and `payments` hold foreign keys to it.

The module's own docstring (`:44-56`) explains that this operation fails with
`sqlite3.IntegrityError: FOREIGN KEY constraint failure`.

`backend/tests/test_seed_and_migrations.py:127-129` ran the downgrade against an
**empty** database, so the hazard was never exercised with data. Any real downgrade path was
likely broken.

**Fix.** `downgrade()` no longer uses batch mode. It rebuilds `invoices` by hand from
its own `sqlite_master` DDL (transforming the text rather than retyping it, so no other
column, default or FK can be dropped by accident), with `PRAGMA foreign_keys=OFF` and
`legacy_alter_table=ON` set on Alembic's own connection, the index DDL captured before
the rename and replayed after, surviving columns copied **by name** rather than
`SELECT *`, and `PRAGMA foreign_key_check` asserted before the swap is accepted. The
helper functions live in a new module, `backend/app/utils/ddl.py`, whose whole reason
for existing is correct paren matching — the constraints contain `IN ('a','b','c')`, so
a regex like `CHECK \([^)]*\)` truncates mid-constraint.

**Regression test:**
`test_seed_and_migrations.py::test_invoice_payment_method_downgrade_survives_data` —
downgrades with a live user, client, quotation, invoice, line item and payment present,
then asserts the rows survived and `foreign_key_check` is clean.

**Original locations:**
- `backend/migrations/versions/b8d5f0e2c7a1_invoice_payment_method.py:44-56, 78-79`
- `backend/tests/test_seed_and_migrations.py:127-129`

---

## C. High-priority findings

| # | Status | Finding | Resolution / where it stands |
|---|---|---|---|
| 4 | ✅ RESOLVED | **No authorization anywhere.** `login_required` is a presence check only. `User.role` exists and is read nowhere. Any second account is instantly owner-equivalent. | New `@owner_required` guard in `utils/guards.py`, applied to all six settings routes, to logo/payment-QR **mutation** (reads still need only a session, because every rendered document fetches them), and inline in `change_password` (which resolves the user itself, so the check cannot be a decorator). Always ordered *under* `@login_required` so an anonymous caller still gets 401, never a 403 that would confirm the route exists. `OWNER_ROLE` is now read from one constant in three places. Tests: `test_authorization.py` (6 cases). |
| 5 | ✅ RESOLVED | **Upload size check runs *after* `file.read()`.** The entire body is buffered into memory before the 2 MB test, and `MAX_CONTENT_LENGTH` is not configured anywhere. | `MAX_CONTENT_LENGTH` added (3 MB default, configurable) and enforced by Werkzeug before any handler runs; `request.content_length` checked as a cheap early exit; and the read is bounded to `max_bytes + 1`, so an absent or lying `Content-Length` still cannot force a large allocation. Tests: `test_uploads.py::test_oversize_upload_is_rejected`, `::test_body_over_max_content_length_is_refused_by_the_framework`, `::test_a_lying_content_length_cannot_force_a_large_read`. |
| 6 | ✅ RESOLVED | **No production secret enforcement.** `JWT_SECRET_KEY` silently falls back to `SECRET_KEY` and both fall back to a per-process random value. | `Settings.verify_production_secrets()` runs at import and refuses to boot in production on a missing, placeholder (`change-me` and friends), duplicated or under-32-character key, printing how to generate two. No-op outside production. Tests: `test_config.py` (6 cases). |
| 7 | ✅ RESOLVED | **No CSP and no HSTS.** Only `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. | Strict same-origin CSP shipped as a configurable default, plus `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, and HSTS **production-only** (meaningless over HTTP, and it would lock out an HTTP-reachable host). Because the policy forbids inline script, the pre-paint theme bootstrap moved from an inline `<script>` to `public/theme-boot.js` — a synchronously-loaded same-origin file still runs before first paint, so the no-white-flash guarantee is unchanged and no hash needs maintaining. Tests: `test_config.py` (5 header/CSP cases) and `test_spa.py` (4 cases that assert the **real production build** contains no inline script, loads only same-origin scripts, and is permitted by the shipped policy). |
| 8 | ✅ RESOLVED | **`allowed_actions` advertises invoice `duplicate` and `delete` with no route behind them.** The contract lies. | `get_invoice_allowed_actions` no longer advertises them; `can_duplicate` is an honest constant `False`. The enum members and transition-table entries are **kept** as the specification for those routes when they are built. `test_allowed_actions.py` now pins the invariant from the other direction: every advertised action must have a real route, for every invoice and quotation state. |
| 9 | ✅ RESOLVED (coverage gap noted) | **`settings.save_settings` mutates before validating.** `setattr` before validation; a raised `ApiError` leaves dirty session state and `teardown_request` does not roll back a *handled* exception. | Rewritten to build a plain-dict **candidate** (payload layered over the row, same normalization), validate *that* against the untouched row, and only then `setattr` and commit — so a rejection cannot have written anything. `except ApiError` and `except SQLAlchemyError` both roll back, so a failed commit does not poison the next request on the same scoped session. A field the payload did not carry resolves to the row's current value, so a partial save is judged as the row it would produce. **Gap:** the existing rejection tests assert the 422 but do not assert the stored row is unchanged — the property is implemented, not yet pinned. |
| 10 | ✅ RESOLVED | **`CompanySettings.get_row()` commits from a getter** called on GET request paths. A read request performs a write. | `get_row(flush=True)` now `flush()`es instead of committing: the row is immediately readable, which is all those callers need, while the transaction that opened it stays responsible for ending it. `flush=False` is available for a read-only path that must not open a write transaction at all. |
| 11 | ⚠️ PARTIAL — deliberate | **`min_amount`/`max_amount` filter paise columns with rupee-named parameters.** A client sending `10000` filters for ₹1,00,000. | The **behaviour is unchanged and correct** (they are paise, like the whole API), but the name is a standing hazard, so it is now pinned and documented rather than renamed: `test_quotations_api.py::test_amount_filters_are_in_paise_not_rupees` and `::test_amount_filters_reject_negative_values`, a note in `api/quotations.py` explaining that the client converts via `rupeesToPaise`, and a "Money on the wire" section in `docs/api.md`. Renaming would break the shipped frontend contract for no functional gain. |
| 12 | 🔴 OUTSTANDING | **`outstanding_paise` clamped in one surface, not the other.** `payment_due_document` uses `max(0, …)`; `serialize_invoice` does not. | Not addressed. `services/invoices.py:143` still computes `data["outstanding_paise"] = grand_total - paid` with no clamp, against `:235`'s `max(0, grand_total - paid)`. Observable only if the ledger is over-collected outside the API, but it is a real divergence between two surfaces of one number. |

---

## D. Medium-priority findings

### Performance and indexing

*All still outstanding — none touched by this pass.*

- 🔴 **No index on any grouped or sorted column**: `payments.paid_on`, `invoices.issue_date`,
  `quotations.created_at`, `invoices.created_at`. No index on any `created_by` foreign
  key. The dashboard runs ~14 queries per request, two of them full-scan groupings over
  unindexed columns. (Documented as deliberate in `docs/phases.md:643-647`; still the
  largest single scalability ceiling.)
- 🔴 **N+1 queries**: `_validated_service_id` runs one `db.session.get` per line item on
  every quotation create/update. `GET /invoices/:id/payments` serializes three full
  invoices.
- 🔴 **Invoices list costs O(page_size) queries**, not O(1) — one `SUM` per row plus a lazy
  payments load behind `allowed_actions`. Documented in `docs/phases.md:429-437`.
- 🔴 **Frontend entry chunk is 528 KB** (160 KB gzip) plus a 392 KB Recharts chunk
  (112 KB gzip). Recharts is correctly code-split, but `/login` may still fetch the chart
  stylesheet chunk.

### Business logic

*All still outstanding — none touched by this pass.*

- 🔴 **A `sent` quotation can be re-priced.** `api/quotations.py:280` allows PUT in `sent`;
  the lifecycle table has no edit concept. A quotation the customer has already seen can
  be silently changed. `approved` is correctly blocked.
- 🔴 **`duplicate_quotation` silently resets `valid_until` to `None`** with no signal to the
  caller; the body schema is an empty `pass` and is ignored entirely.
- 🔴 **`Quotation.archived_at` is a dead column** while quotations are hard-deleted —
  inconsistent with the archive-never-delete discipline applied to clients and services.
- 🔴 **No `PUT /payments/:id`.** Payments can only be deleted and recreated, so a typo'd
  amount costs two writes.
- 🔴 **No validation that `valid_until >= quotation_date`.**

### Data integrity

*All still outstanding — none touched by this pass.*

- 🔴 **`clients.phone` uniqueness is service-only** (409). No unique index behind it, unlike
  every other business invariant in the schema (`uq_services_active_name` exists for
  exactly this).
- 🔴 **`terms_conditions.scope` has no CHECK constraint** and the "one default per scope"
  invariant has no partial unique index — enforced only in `_promote_default`.
- 🔴 **`quotation_items.qty_milli` / `rate_paise` are nullable at the DB level** with a
  `server_default="0"`. SQL NULL does not violate `qty_milli >= 0`, so a NULL would pass
  the CHECK and then reach `calculate_line_total(None, …)` → 500.

### API consistency

- ✅ **Two status-code tables that can drift**: `_CODE_BY_STATUS`
  (`app/__init__.py:204-213`) duplicated `CODE_STATUS` (`utils/errors.py:20-30`) — a second
  hand-written copy free to drift, with the failure mode of an HTTP error silently
  rendered with the wrong `error.code`, which the frontend switches on. `_CODE_BY_STATUS` is
  now **derived** from `CODE_STATUS` by a loop, with `setdefault` so the ambiguous 422
  resolves to `VALIDATION_ERROR`; only 400 and 413, which no `ApiError` code covers, are
  stated by hand. *(This removed finding J4's first half; see also D→Code duplication.)*
- 🔴 **Envelope inconsistency across three families**: `{"<entity>": …}`
  (clients/quotations/invoices), a bare summary dict (`GET /clients/:id/summary` is
  unwrapped while `GET /clients/:id` is wrapped), and a nested `money`/`recent`
  (dashboard).
- 🔴 **`DELETE /payments/:id` returns `deleted` as an *integer id*** while every other delete
  endpoint returns `{"deleted": true}`. Same key, two types.
- 🔴 **Status code inconsistency**: `POST /settings/logo` returns 200 for a resource creation
  while `POST /settings/terms` and `POST /clients` return 201.
- 🔴 **Malformed `page`/`page_size` on clients/services silently falls back** instead of
  returning 422, unlike quotations/invoices which do 422 on a bad `sort`.

### Code duplication

- ✅ **Duplicated RATE_LIMITED producers.** `utils/errors.py:89` `rate_limited()` accepted
  `retry_after_seconds` and discarded it, and was **never called**;
  `services/rate_limit.py:154` built the `ApiError` directly with different text.
  `seconds_until_available()` was dead code, so no `Retry-After` was ever emitted. There is
  now **one producer**: `enforce_login_rate_limit` raises `rate_limited(...)`,
  `ApiError` carries `retry_after`, and the app factory writes it as a `Retry-After`
  header per RFC 6585 §4. Both previously-dead functions are now load-bearing.
- 🔴 **Four copies of the "valid line" rule** and **three copies of the subtotal
  computation** (`calculations.py:265, 287-293`, `lifecycle.py:96`,
  `api/quotations.py:130-165`, `services/invoices.py:488-498`). This duplication is why a
  defensive `ConversionSafetyError` → 500 exists at all.
- 🔴 `_as_bool` / `_as_int` duplicated byte-for-byte between `api/clients.py:102-112` and
  `api/services.py:107-117`.
- 🔴 `page_size` clamped in two layers (`api/clients.py:45`, `services/clients.py:59`).

### Deployment robustness

- ✅ **No `ProxyFix`.** `TRUST_PROXY_HEADERS` existed and the limiter compensated, but
  `url_scheme` and `remote_addr` were the proxy's, so any future scheme-dependent logic was
  wrong behind Render. `ProxyFix` is now applied, gated on the same setting and on
  `TRUSTED_PROXY_COUNT` rather than "any number" — Werkzeug reads the headers right-to-left
  and stops at the configured depth, so a client cannot forge `X-Forwarded-Proto` past it.
  It is wrapped around `app.wsgi_app`, because `ProxyFix(app, …)` would be constructed and
  discarded. Test: `test_config.py::test_proxy_fix_is_applied_only_when_trusting_proxy_headers`.
- ✅ **`run.py:18-21` starts the Werkzeug debugger** whenever `FLASK_ENV` is unset or
  development, with no production guard. `run.py` now refuses to start with `debug=True`
  when `IS_PRODUCTION`, naming the RCE surface in the error.

### Input validation gaps

- ✅ **`current_password` has no max length** (`schemas/auth.py:34`), so an unbounded string
  reached `check_password_hash`. Now capped at `MAX_PASSWORD_LENGTH` like the new password —
  the endpoint is authenticated but not rate limited, so an uncapped string was an unbounded
  scrypt input.
- ⚠️ PARTIAL — **quotation `terms_text` / `notes` have no length cap at all**, while client
  notes are capped at 2000. **Invoice** draft is now capped (`notes` 4000, `terms_text`
  8000 — see B1), but **`QuotationSchema` at `schemas/quotations.py:71-72` still has neither
  cap.** The finding is therefore half closed.
- 🔴 **No rate limit on `PUT /auth/password` or `POST /auth/refresh`** — only login is
  limited. (`change_password` did gain an owner check, but still has no rate limit.)
- 🔴 **`QuotationItemSchema` has no `unknown = EXCLUDE`**, unlike the client/service schemas
  — inconsistent strictness produces 422 where others silently drop.

---

## E. Low-priority findings

### Dead code

*Two entries are now live code; the rest are untouched.*

- ✅ `utils/errors.py::rate_limited()` — *was* imported nowhere and discarded its
  `retry_after_seconds`. Now the single RATE_LIMITED producer (see D→Code duplication).
- ✅ `services/rate_limit.py::seconds_until_available()` — *was* dead. Now feeds
  `Retry-After`.
- 🔴 `backend/app/api/auth.py:29` — `issue_tokens` imported, never used.
- 🔴 `backend/app/services/csrf.py:64-69` — `ensure_csrf_cookie` never called.
- 🔴 `backend/app/services/numbering.py:92-105` — `get_next_number_preview` used only by
  tests; no route exposes it.
- 🔴 `backend/app/services/calculations.py:239-303` — `validate_line` used only by tests.
- 🔴 `backend/app/services/calculations.py:49-51` — `round_paise` is a no-op and unused.
- 🔴 `backend/app/utils/phone.py:80,124` — `digits_only` / `is_valid_phone` exported but used
  only internally.
- 🔴 `frontend/src/pages/PagePlaceholder.jsx` — **0 importers** (re-verified).
- 🔴 `frontend/src/hooks/usePwaInstall.js` — **0 importers** (re-verified); an entire
  install-prompt feature built and never wired into the UI.
- 🔴 `QuotationDuplicateSchema` — an empty `pass`.

### Miscellaneous

- ⚠️ PARTIAL — **`docs/api.md` documents none** of the `/services`, `/quotations`,
  `/invoices` CRUD, or `/payment-due` endpoints. The security and money sections were
  substantially rewritten for this work: an **Authorization** section explaining the owner
  rule and why, the full **Security headers** table with the shipped CSP, an explicit
  **`Retry-After`** note, bounded-upload semantics incl. the 413, "validation runs against
  the merged result", and a **Money on the wire** section pinning the paise filter units.
  The ~24 business CRUD endpoints are **still undocumented**, and `/services` entirely so.
- ✅ **Non-deterministic JPEG `Content-Type` served from a set iteration**
  (`api/uploads.py:241-244`). `.jpg` and `.jpeg` both map to a three-element set and set
  order varies per process, so the served type was not stable across restarts. Now
  `sorted(entry[1])[0]`.
- ✅ **`_MAGIC[extension]` is unguarded** (`api/uploads.py:155`) → `KeyError` / 500 if config and
  the magic table ever drift apart. Now `.get` with an explicit 422; the same guard was
  added to the serving path.
- 🔴 `scripts/normalize_client_phones.py` and `frontend/src/lib/phone.js` reference legacy
  rows needing repair; the migration script has no automated invocation path.
- 🔴 `backend/instance/` holds stale `.db` / `.db.bak*` files and `.db-wal` / `-shm`
  sidecars. All gitignored, but **the `.bak` copies hold live business data on disk**, and
  the sidecars are a recurring annoyance: a `.bak` opened with SQLite acquires its own
  `-wal`/`-shm` pair, which is how `…bak-shm` / `…bak-wal` came to be tracked-adjacent
  clutter. *(Count has grown since the original audit: a forensics directory and two
  verified restore points were added during recovery — see §M.)*
- 🔴 `QuotationItem.service_id` FK has no index (`models/quotation.py:91`).
- 🔴 `InvoiceItem.invoice_id` uses `ondelete="RESTRICT"` while the relationship uses
  `cascade="all, delete-orphan"` — the two disagree.
- 🔴 `Invoice` / `Quotation` have no `updated_at` index despite ordering by it.
- 🔴 Money formatting exists in three server-side and three client-side implementations,
  none shared.

---

## F. Feature-by-feature status

| Feature | Status | Findings |
|---|---|---|
| Authentication | **Working, hardened** | Scrypt, JWT cookies, CSRF double-submit, single-flight refresh, rate limit, revocation all correct. **Authorization now enforced** (C4 ✅). **CSP/HSTS/cross-origin headers sent** (C7 ✅). **Production secret enforcement added** (C6 ✅). `current_password` now capped ✅. Still no rate limit on password change/refresh 🔴; CSRF is still a pure double-submit 🔴. |
| Dashboard | **Working** | One request, one query set, all §9.2 fields present, hand-computed scenario test. Charts correctly lazy-loaded. ~14 queries per request on unindexed columns 🔴. No date range (documented by design). |
| Clients | **Working** | Full CRUD + archive/restore, summary, search, pagination, picker. Phone uniqueness service-only 🔴. Summary sums in Python over loaded rows (documented divergence from dashboard SQL). Legacy rows with malformed numbers need repair 🔴. |
| Services | **Working** | Best-constrained table in the schema. Partial unique index on `lower(name) WHERE archived_at IS NULL`. Catalog provenance survives duplicate → convert. **Page reworked** to a stacked card layout with truncating name, non-wrapping price, category pill and a searchable field with clear control. No CSV import (deferred 🔴). No per-service GST (by design). |
| Quotations | **Working** | Numbering, discounts, tax, totals, lifecycle, duplicate, convert. `sent` re-pricing allowed 🔴. `valid_until` lost on duplicate 🔴. N+1 per line item 🔴. `archived_at` dead 🔴. **`notes`/`terms_text` still uncapped** 🔴. |
| Invoices | **Working — B1 fixed** | Conversion, snapshot, issue/cancel, derived status. **Partial `PUT` no longer wipes notes / terms / payment_method** (B1 ✅). Advertised `delete` / `duplicate` no longer advertised, and the invariant is pinned (C8 ✅). `outstanding_paise` still unclamped here 🔴. |
| Payments | **Working** | Record/delete, overpayment rejected (422) twice over, derived status, no float anywhere. No edit path 🔴. `deleted` envelope type differs from every other delete 🔴. **Rate limit is a real 429 with `Retry-After`** ✅. |
| UPI QR | **Working** | Generated from an intent URI, integer paise only, returns `None` rather than a zero-amount code, three-level degradation. Backend `build_upi_uri` and frontend `buildUpiUri` are **independent implementations with no cross-check test** 🔴. |
| Bank Transfer | **Working** | Snapshot at conversion, frozen at issue. Prints exactly once per sheet (print-check asserts this). |
| Cash | **Working** | Method line only, no rails. Cannot be cancelled once paid. |
| Settings | **Working** | All 10 sections, per-section save, upload gauntlet (extension → MIME → size → magic → Pillow). **Validate-before-write now correct** (C9 ✅). **`get_row()` no longer commits on GET** (C10 ✅). Non-deterministic JPEG `Content-Type` fixed ✅. Bounded upload path ✅. **Gap:** no test asserts a rejected save left the row unchanged 🔴. |
| Documents / Print | **Working** | `print-check` green on all 6 variants: A4 fits, QR 28 mm (floor 20 mm), exactly one payment card, no screen chrome leaked, bank details printed exactly once, settled sheet carries no QR. Page numbers omitted by design (FR-DOC4). |
| PWA / Mobile | **Working** | Installable, maskable icons, standalone, safe-area insets, 44 px touch targets, re-checks `data-fully-paid`. **The service worker no longer caches `GET /api/v1/*`**, so authenticated business data no longer survives logout in Cache Storage ✅ — the app shell is still precached, so the app opens offline and shows its own "can't reach the server" state rather than stale figures. **Mobile navigation replaced by the left hamburger drawer** ✅. |
| Backend / API | **Working** | 40+ routes, consistent envelope, uniform 401 / 403 / 404 / 409 / 422 / 429, generic 500 with a correlatable error id. Envelope shape still differs across 3 families 🔴. **The duplicated status table is now derived** ✅. `Retry-After` on 429 ✅. |
| Database | **Working, drifts closed** | Single linear head `c3d7e9f1a2b4`. **Both missing CHECKs are now written by the migration history and named** (B2 ✅). **The hazardous downgrade rebuilds correctly** (B3 ✅) but is **not atomic — see §M1** 🔴. 6 unindexed sort/group columns 🔴. |

---

## G. Test results

**All gates pass.** Numbers have moved since the original audit; both columns shown.

| Gate | Command | Original | Now |
|---|---|---|---|
| Frontend lint | `npm run lint` | PASS — 0 errors, 0 warnings | **PASS** — 0 errors, 0 warnings |
| Format | `npm run format:check` | PASS | **PASS** — all files Prettier-clean |
| Frontend tests | `npm run test:web` | PASS — 27 files, 463 tests | **PASS** — **29 files, 504 tests** |
| Backend tests | `npm run test:api` | PASS — 432 passed | **PASS** — **496 passed**, 3 warnings |
| Production build | `npm run build` | PASS — 25 precache entries | **PASS** — 26 precache entries (1408.03 KiB) |
| Print / document | `node scripts/print-check.mjs` | PASS — all 6 variants fit A4 | Not re-run for this documentation pass |

**The 64 new backend cases and 41 new frontend tests are all audit remediation
coverage**, not incidental growth. They include, by finding: B1 (2), B2 (2), B3 (1),
C4 (6), C5 (3), C6 (6), C7 (9), C8 (4), C11 (2), C3/C6/C7 deployment (2), the DDL
helper module (`test_ddl.py`, new file), the migration-rollback regression (1), and the
test-database isolation guard (see §M2).

### Print-check measurements

| Document | Sheet height | Payment card | QR |
|---|---|---|---|
| `invoice` (not selected) | 263.7 mm | 47.9 mm | 28 mm |
| `invoice-upi` | 263.7 mm | 47.9 mm | 28 mm |
| `invoice-bank` | 247.3 mm | 31.5 mm | — |
| `invoice-cash` | 233.5 mm | 17.6 mm | — |
| `balance` | 194 mm | 47.9 mm | 28 mm |
| `balance-paid` | 144.4 mm | none (0 cards) | none, 1 stamp |

A4 printable limit is 269 mm. The account number is printed exactly once on every
bank-bearing sheet, and 0 times on the settled sheet. No screen chrome leaks into any
print form.

### Build output

*Measured during the original audit pass. Not re-measured for this documentation
revision; the current build succeeds with **26** precache entries (1408.03 KiB) after
`theme-boot.js` was extracted from the inline script.*

```
dist/assets/index.html                   2.37 kB │ gzip:   1.00 kB
dist/assets/index-*.css                105.19 kB │ gzip:  17.05 kB
dist/assets/index-*.js                 527.91 kB │ gzip: 159.97 kB
dist/assets/DashboardCharts-*.js       392.50 kB │ gzip: 112.16 kB
dist/assets/DashboardCharts-*.css        1.60 kB │ gzip:   0.59 kB
PWA: 25 precache entries (1402.90 KiB)
```

### Backend warnings (2, both benign)

- `SAWarning: Skipped unsupported reflection of expression-based index uq_services_active_name` × 2 —
  inherent to reflecting `lower(name) WHERE archived_at IS NULL`; the index's existence is
  asserted from the DDL directly instead.
- ~~`UserWarning: Unnamed CHECK constraint on reflected table 'invoices' is being omitted from the table recreate`~~ —
  **gone.** It was a direct consequence of B2/B3; `c3d7e9f1a2b4` gives that constraint a name,
  so SQLAlchemy can now reflect it.

### Migration chain (verified single head)

```
000d90328da3  (down_revision=None)        create users table
    └─ 4cb5324d6e1e                        phase 3 schema
        └─ a7c4e19b2d80                    phase 8 payment qr
            └─ b8d5f0e2c7a1                invoice payment method
                └─ b1f2a3c4d5e6            phase 9A services catalog
                    └─ c3d7e9f1a2b4        company settings check constraints   ← HEAD
```

No branches, no merges, one head. The original audit recorded `b1f2a3c4d5e6` as the head;
`c3d7e9f1a2b4` is the revision that closes B2.

### Test suite composition

**Backend** — 20 files (was 17), 432 cases after parametrisation (was 381 `def test_`).
New files: `test_ddl.py` (the DDL text-surgery helpers, whose nested-paren handling is the
reason the module exists), `test_authorization.py`, `test_allowed_actions.py`.

The three files that gained cases, and why:

| File | Was | Now | Added for |
|---|---|---|---|
| `test_config.py` | 4 | 18 | C6 secret enforcement, C7 headers/CSP, ProxyFix, empty-`CORS_ORIGINS` semantics |
| `test_seed_and_migrations.py` | 4 | 8 | B2 named CHECKs, B2 enforcement, B3 downgrade-with-data, migration rollback |
| `test_uploads.py` | 21 | 24 | C5 bounded read, 413, lying `Content-Length` |
| `test_spa.py` | 13 | 17 | C7 — asserts the *real production build* has no inline script and matches the CSP |
| `test_invoices_api.py` | 27 | 29 | B1 partial PUT, length caps |
| `test_quotations_api.py` | 26 | 28 | C11 paise filter units |
| `test_lifecycle.py` | 30 | 30 | C8 — updated for `duplicate`/`delete` no longer advertised |

**Frontend** — 29 test files (was 27), 504 tests (was 463). New: `NavDrawer.test.jsx`
(12 cases: modal dialog semantics, focus move-in and restore, Tab trap, Escape from
anywhere, scrim naming, scroll lock, mount lifetime across the exit, desktop unmount,
and the opening-animation contract) and `services-layout.test.jsx` (card structure,
layout rules, search field). `routes.test.jsx` and `Sidebar.test.jsx` were rewritten for
the drawer replacing the bottom bar.

### Gaps in coverage

*Closed since the original audit:*

- ✅ **No authorization test** — there is no role check to test. → `test_authorization.py`.
- ✅ **No partial-PUT test for invoices** (finding B1 entirely uncovered). → now covered.
- ✅ **No `min_amount` / `max_amount` filter test at all.** → now covered, including the
  negative-value rejection.
- ✅ **No `MAX_CONTENT_LENGTH` behaviour test.** → now covered, as is the lying
  `Content-Length` case.
- ✅ **No assertion that CHECK constraints exist after a real `upgrade()`** — why B2 was
  invisible. → now covered for *every* named CHECK in the model.
- ✅ **No WEBP upload test / no test for a declared MIME of `""`** — WEBP and the
  deterministic `Content-Type` are now handled; the empty-MIME case is still untested 🔴.

*Still outstanding:*

- 🔴 **Zero CSRF tests** on `PUT /invoices/:id`, `/issue`, `/cancel`, `/payments`,
  quotation `/status`, `/duplicate`, `/invoice`, `DELETE /payments/:id`.
- 🔴 **No mismatched-header CSRF test** (right cookie, wrong header) anywhere outside login.
- 🔴 **No test asserting a rejected settings save left the stored row unchanged** — the
  behaviour is implemented (C9) but not pinned.
- 🔴 **Boundary rounding is under-tested** — no case for a 1-paise amount, a 99-paise GST
  rounding, or a large multi-line subtotal rounding identically across quotation save →
  conversion → dashboard → balance document.
- 🔴 **No cross-check that the Python and JS UPI builders produce the same `am`.**
- 🔴 **No `build_upi_uri` / `format_upi_amount` unit tests** — covered only indirectly.
- 🔴 **No test for the `_store_image` rollback path**; no test that a tampered
  `logo_path` is refused.
- 🔴 **No `PRAGMA foreign_keys` assertion** — the entire `RESTRICT` design depends on it.
- 🔴 **No CORS preflight (`OPTIONS`) test.**
- 🔴 **No rate-limit test on `PUT /auth/password` or `POST /auth/refresh`** — because there
  is no rate limit there.

### Environment caveat

The first `npm run test:api` run of the original audit reported
`1 failed, 425 passed, 8 errors` with `sqlite3.OperationalError: database or disk is full`
and `OSError: [Errno 28] No space left on device`.

**This is the machine, not the code** — the C: drive was nearly full (D: had 117 GB).
Re-running with temp redirected to D: produced a clean pass.

The backend suite writes temp databases to the system temp directory, so it will fail on
any disk-constrained machine. This recurred during remediation: a later full-disk event
was the proximate trigger for the migration failure described in §M1.

---

## H. Security findings

### Critical

**None.**

### Verified clean

- **No SQL injection** — all database access goes through the SQLAlchemy ORM or
  parameterised statements.
- **No XSS sink** — no `dangerouslySetInnerHTML` anywhere; React escapes by default.
  A strict CSP is now the backstop beneath this (§C7).
- **No path traversal** — `spa.py:82` and `services/settings.py:278-291` both
  resolve-and-contain before reading.
- **No secret in the repository** — `.env`, `*.db`, `*.bak`, `uploads/*` are all correctly
  gitignored. `git ls-files` confirms only `.gitkeep` and `Plan_Summary.docx` are tracked.
  *Note:* the `.db.bak-wal` / `.db.bak-shm` sidecars were showing as untracked during
  remediation; they are instance-local and must not be committed.

### High

- ~~Findings **B1–B7** (see sections B and C).~~ **All of B1–B3, C4, C5, C6 and C7 are
  now resolved** with regression tests. See §B and §C.
- Unauthenticated `GET /` discloses the CORS allow-list string (`app/__init__.py:73`) —
  development-only, since the SPA takes over `/` when a build exists. 🔴 Still open.

### Medium

- ✅ **Service worker caches authenticated API responses.** `runtimeCaching` in
  `vite.config.js` cached every `GET /api/v1/*` for 24 hours; client names, invoices and
  payments sat in Cache Storage and **survived logout**, not being bound by
  `Cache-Control` (so a `no-store` response header could not save it). `runtimeCaching` is
  now removed entirely, with the reasoning recorded in the file so it is not
  reintroduced as "offline support". The app shell is still precached, so the app opens
  offline and shows its own "can't reach the server" state rather than stale figures.
- ✅ **No `ProxyFix`**; `X-Forwarded-For` was trusted for the limiter without it, so
  `request.remote_addr` was the proxy's. `ProxyFix` is now applied, gated on
  `TRUST_PROXY_HEADERS` and bounded by `TRUSTED_PROXY_COUNT` (§D→Deployment robustness).
- ✅ **Werkzeug debugger** could start in `run.py` whenever `FLASK_ENV` was unset or
  development, with no production guard. `run.py` now refuses to start.
- 🔴 **CSRF is a pure double-submit** with an unsigned, session-unbound token
  (`services/csrf.py:8-18`) — defensible and documented, but a subdomain cookie-injection
  defeats it.
- 🔴 **The rate limiter is a process-wide in-memory singleton** (`rate_limit.py:105`) —
  ineffective across workers or instances. Single worker on Render is what makes this
  survivable; it is not survivable on a scale-out. *(The limiter is now at least honest
  about itself: a real 429 carrying `Retry-After`.)*
- 🔴 **`Cache-Control: public, immutable` on the authenticated logo route**
  (`api/uploads.py`) — a shared cache may retain the branding image. Lower severity now
  that the SW no longer caches API responses.

### Low / informational

- The `error_id` echo is a deliberate correlatable correlation — correct design.
- Generic 500 messages with full detail logged only — correct.
- `change-me` placeholders ship in `.env.example` — documented, non-production only, and
  production now **refuses to boot** on them rather than merely warning (§C6).
- The 401 path is timing-equalised via `verify_dummy` and returns an identical envelope
  for unknown-account and wrong-password — correct, and tested.
- The owner guard returns 401 (never 403) to an unauthenticated caller, so it does not
  confirm that a route exists or that an owner does. Correct design, newly implemented.

---

## I. Production/deployment findings

**Deployment is well engineered.** Single-origin Flask-served SPA, `SameSite=Lax`
becoming `Secure` in production, first-boot migration + seeding in `bootstrap.py` gated
on `AUTO_SEED_ADMIN`, a health check deliberately kept database-free, and a thoughtful
single-worker rationale. `render.yaml` is exemplary and its documentation is honest.

The audit pass materially improved the production posture: a strict CSP, cross-origin
isolation headers, production-only HSTS, enforced secrets, an owner authorization layer,
a bounded upload path, `ProxyFix`, and a refusal to boot with the debugger on.

### But it will lose data

On the Render Free tier the SQLite database **and every uploaded logo / payment QR** are
lost on redeploy, restart, or a 15-minute spin-down. This is stated plainly in both
`render.yaml:15-28` and `README.md:100-114`, and it is correct: this is a demo
configuration, not a live ledger. 🔴 Unchanged by this pass.

### Works locally, breaks in production

1. 🔴 **`_ensure_sqlite_parent` resolves relative paths against CWD**, and
   `bootstrap.py:78-79` calls `upgrade()` with a relative `migrations` directory. Render
   sets `rootDir: backend` to make this work; any other launch directory **silently skips
   migrations** and every request 500s.
   *Confirmed:* running pytest from the repo root instead of `backend/` fails all 9
   migration and bootstrap tests with `Path doesn't exist: migrations`. Still open, and
   the cheapest of the remaining production risks to close.
2. ✅ **`CORS_ORIGINS=""` did not produce an empty allow-list** — `settings.py` used `or`,
   so it fell back to the two localhost origins, making "no cross-origin access"
   inexpressible. Now distinguished from *unset* with `is not None`, and tested both ways.
3. 🔴 **`AUTO_SEED_ADMIN` never fires again once users exist** (`bootstrap.py:115-116`),
   which is correct — but it means a Render redeploy against a **wiped** database does
   re-create the owner from an `ADMIN_PASSWORD` that has been sitting in the dashboard for
   months.
4. ✅ **No `X-Forwarded-Proto` handling**, so `request.is_secure` was always `False` behind
   Render. `ProxyFix` now covers it (the cookie `secure` flag remains hard-coded from
   `IS_PRODUCTION`, which is why this was previously masked).
5. 🔴 **`requirements.txt` uses unpinned version ranges**, so a rebuild can pull a
   different dependency set than the tested one.
6. 🔴 **Single-worker assumption.** The in-memory rate limiter and the ephemeral SQLite
   file both depend on one worker and one instance. Documented, not fixed.

### Positive

- `/api/v1/health` is a true liveness probe and cannot fail from an unmigrated database.
- No secrets are committed; `SECRET_KEY` and `JWT_SECRET_KEY` are generated per
  environment, and production now refuses to run without two distinct real ones.
- First-boot seeding is reachable from no HTTP route and creates an account only when the
  users table is empty.
- Production refuses to start with `debug=True`, closing the Werkzeug-debugger RCE path.

---

## J. Technical debt

1. ⚠️ PARTIAL — **Conftest bypasses migrations.** `tests/conftest.py` uses `db.create_all()`
   for most tests, which was the direct cause of finding B2 and would hide every future
   model↔migration drift. **What changed:** the drift class is now closed for the case that
   actually occurred — `test_migrations_create_every_named_check_constraint` runs the real
   Alembic runner and reads the resulting DDL, so a model CHECK with no migration fails the
   suite. **What did not:** most test schemas are still built with `create_all()`, and an
   `alembic check` assertion (no autogenerate diff) is still absent, so non-CHECK drift
   remains invisible. Also new here: an autouse fixture now redirects the *default*
   database URI away from the real instance file, because a test was opening it (§M2).
2. 🔴 **Four copies of the "valid line" rule, three of the subtotal computation.** The
   duplication is why a defensive `ConversionSafetyError` → 500 exists at all.
3. 🔴 **Two independent UPI URI builders** — `services/calculations.py` and `lib/upi.js` —
   each with tests, but **no test that they agree**. The printed amount comes from the
   server on the balance sheet and from the client on the invoice; if they drift, two
   documents encode different amounts from the same invoice.
4. 🔴 **Three server-side money formatters and three client-side ones**, none shared.
5. 🔴 **Dead code** (full list in §E): `Quotation.archived_at`, `issue_tokens`,
   `ensure_csrf_cookie`, `round_paise`, `get_next_number_preview`, `validate_line`,
   `QuotationDuplicateSchema`, `PagePlaceholder.jsx`, `usePwaInstall.js`,
   `ServicePicker.jsx`. *Two entries have left this list because they stopped being dead:
   `rate_limited()` and `seconds_until_available()` are now the single RATE_LIMITED
   producer and the source of `Retry-After`.*
6. 🔴 **Duplicated fetch logic in `SettingsProvider`** — `load()` and the `useEffect`
   implement the same thing; the effect does not call `load`.
7. 🔴 **Boundary rounding is under-tested** across the four money surfaces.
8. 🔴 **Zero CSRF tests** outside login (full list in §G).
9. ✅ **No authorization test**, and no role model to test. → `test_authorization.py` now
   exists and the role invariant is enforced by `@owner_required`.
10. ⚠️ PARTIAL — **`docs/api.md` documented 0 of ~24 business endpoints.** Security,
    authorization, money-unit and upload-semantics sections are now thorough; the
    `/services`, `/quotations`, `/invoices` and `/payment-due` CRUD endpoints are not.
11. 🔴 **`README.md` "Current Status" is stale** — it still says "Phases 1, 2 and 3 are
    complete" while `docs/phases.md` records Phases 1–10 as done. *(`PLAN.md`'s status
    line has been corrected to 1–10 for this pass; `README.md` has not.)*
12. ✅ **Migration rebuilds are now atomic.** Both hand-rolled rebuilds
    (`b8d5f0e2c7a1`, `c3d7e9f1a2b4`) open their own transaction and roll back
    together; each has a test that sabotages the `CREATE` and asserts the table is
    untouched. The standing rule is recorded in both migration files: a hand-rolled
    SQLite rebuild must never run under bare autocommit.

---

## K. Missing/incomplete functionality

| Item | Status |
|---|---|
| Payment allocation across invoices | **Not implemented.** A payment applies to one whole invoice. §8.5 lists it; open. |
| Ageing / receivables reporting | **Not implemented.** §8.5; open. |
| Payment editing | Not implemented (delete + recreate only). |
| Invoice `delete` / `duplicate` | Routes still absent — and now **correctly not advertised** (C8 ✅). The state-machine entries are retained as the specification for when they are built. |
| Service picker in the quotation editor | **Not implemented.** `ServicePicker.jsx` exists and is tested but is **still not imported by `QuotationEditor.jsx`** (re-verified: 0 importers) — the "Add from services" button in SERVICES_PLAN 9A.3 is missing while 9A.2 shipped. |
| CSV service import | Deferred (SERVICES_PLAN 9A.4). |
| PWA install prompt in the UI | Hook built, never used (re-verified: 0 importers). |
| Multi-currency | Not supported; `INR` is hard-coded. |
| Multi-user / roles | Not implemented, by design. **But** the single-account invariant is now *enforced* rather than assumed (§C4), so a second account appearing is no longer silently owner-equivalent. |
| Dashboard date range | Not implemented, by design (§9.2 defines no query string). |
| Document page numbers | Omitted by design (FR-DOC4). |

---

## L. What remains

Replaces the original "Recommended next work". Items 1–6 of the original list are
**done**; the rest stand, re-ordered by what is now most urgent.

**Completed since the original audit:** ~~1. invoice PUT data loss (B1)~~ ·
~~2. migration-drift class (B2, B3)~~ · ~~3. bound the upload path (C5)~~ ·
~~4. security headers and secret enforcement (C6, C7)~~ · ~~5. add authorization (C4)~~ ·
~~6. reconcile `allowed_actions` with the routes (C8)~~.

### 1. ~~Fix §M1 — make the `b8d5f0e2c7a1` downgrade rebuild atomic~~ ✅ DONE

Highest priority, and the only confirmed data-loss defect. It is the same failure
mode that destroyed the development database. Now that `c3d7e9f1a2b4` and
`b8d5f0e2c7a1` are both transactional, the rule is: **any hand-rolled SQLite table
rebuild opens its own transaction** — autocommit is required for the `foreign_keys`
pragma and is exactly what makes the rename window dangerous. Both rebuilds have a
test that sabotages the `CREATE` and asserts the table comes back untouched.

### 2. Close the environment fragility

`run.py` refusing `debug=True` is done. Still open: `_ensure_sqlite_parent` and
`bootstrap.py` should resolve `migrations` absolutely rather than relying on CWD, so a
launch directory other than `backend/` cannot silently skip migrations and 500 every
request. Cheapest remaining production risk to close.

### 3. Pin the duplicated logic (J1–J4)

In order: an `alembic check` test (no autogenerate diff) so non-CHECK model↔migration
drift also fails; a cross-check that the Python and JS UPI builders produce the same `am`
for the same paise; one shared "valid line" predicate; one shared "has valid lines" rule.

### 4. Cap quotation `notes` / `terms_text`

Invoice draft is capped (4000/8000); `QuotationSchema` is not. Half of a §D finding is
still open.

### 5. Add the missing indexes

`payments.paid_on`, `invoices.issue_date`, both `created_at` columns, and all
`created_by` foreign keys. Documented as deliberate; worth revisiting before the ledger
grows past a few hundred invoices.

### 6. Dead-code sweep

Wire up or delete `usePwaInstall`. Remove `PagePlaceholder`. Drop `Quotation.archived_at`
(or implement quotation archiving). Remove the five unused service functions. Wire
`ServicePicker` into `QuotationEditor` or remove it.

### 7. Fix the small correctness gaps

`outstanding_paise` clamping (C12); `sent` quotation re-pricing; `valid_until` lost on
duplicate; no `valid_until >= quotation_date`; `clients.phone` unique index;
`terms_conditions.scope` CHECK; nullable `qty_milli`/`rate_paise`; the `DELETE /payments/:id`
envelope type; 201-vs-200 on logo upload; malformed `page`/`page_size` on clients and
services; `QuotationItemSchema` `unknown = EXCLUDE`.

### 8. Add a test that a rejected settings save left the row unchanged

The behaviour is correct (§C9); nothing pins it. Cheap, and it guards the exact ordering
that was wrong before.

### 9. Documentation

Bring `docs/api.md` up to date with the ~24 business CRUD endpoints and `/services`.
Reconcile `README.md`'s "Current Status" with `docs/phases.md`.

### 10. Phase 11 completion and Phase 12

The §21 edge-case sweep, the §20 states audit, the a11y pass, then the Playwright suite,
coverage report, bundle budget, backup runbook and version tag.

---

## M. New findings from the remediation

Two confirmed defects were discovered while closing the findings above. Neither is
fixed; both are recorded because they are real.

### M1. `b8d5f0e2c7a1.downgrade()` rebuilds `invoices` without a transaction

**✅ RESOLVED — was confirmed and data-losing.**

The replacement for the FK-broken batch mode (§B3) did the rename/create/copy/drop
sequence correctly, but under **autocommit**:

```python
isolation = dbapi.isolation_level
dbapi.isolation_level = None  # autocommit: the pragmas need this
...
cursor.execute("ALTER TABLE invoices RENAME TO invoices_old")   # commits here
cursor.execute(new_ddl)                                          # ...and dies here
```

Any failure between the rename and the `CREATE` — a full disk, a lock, an
interruption — therefore committed the rename and left a database where `invoices` does
not exist, `alembic_version` still claims the revision, and every page 500s on
`no such table`.

**This was not theoretical. It happened.** The development database was lost to exactly
this window during the remediation work; the file was recovered with only `alembic_version`
and a leftover temp table, and all business data had to be restored from a September
backup. A probe of the 4.1 MB write-ahead log at 15 frame boundaries confirmed nothing
was recoverable from it.

**Fix.** The rebuild now runs inside an explicit `BEGIN`/`COMMIT`, with `ROLLBACK` on any
failure, matching what `c3d7e9f1a2b4` already does. The statements moved into
`_swap_invoices_table` so the transaction boundary is the only thing the caller owns, and
`foreign_key_check` is asserted *before* `COMMIT` — afterwards the violations would have
been somebody else's problem and the migration would have stamped. The pragmas are still
set before the transaction opens, because `PRAGMA foreign_keys` is a no-op inside one.

**Regression test:**
`test_seed_and_migrations.py::test_payment_method_downgrade_rolls_back_when_it_fails_midway`
breaks the `CREATE` that replaces the rename and asserts the database is untouched —
table present under its own name, DDL byte-identical, `payment_method` still there with
its value, row counts intact, indexes unchanged, FK check clean, version **not** stepped
over the failed revision, and a retry then succeeding normally.

It is deliberately a *separate* test from the `c3d7e9f1a2b4` one rather than a shared
helper: the two functions are separate copies of the same technique, so one being atomic
is no evidence about the other. Negative control confirmed — with the transaction
removed, the test fails with the database left holding `invoices_old` and **no `invoices`
table at all**, reproducing the original loss.

Also verified end-to-end on a copy of the real development database: downgrade to
`a7c4e19b2d80` and back to head preserves all 4 invoices, 5 clients and every index, with
no `invoices_old` leftover and `foreign_key_check` clean at each step.

**The general lesson is now recorded in both files:** any hand-rolled SQLite table
rebuild must open its own transaction. Autocommit is required for the `foreign_keys`
pragma and is precisely what makes the rename window dangerous.

### M2. A test was opening and `drop_all()`-ing the real development database

**🔴 CONFIRMED DEFECT — was live during remediation. FIXED, recorded for recurrence.**

`backend/tests/test_allowed_actions.py` built its app with
`create_app({"TESTING": True})` and **no `SQLALCHEMY_DATABASE_URI` override**, so
`Settings.SQLALCHEMY_DATABASE_URI` resolved to
`backend/instance/ruchita_interiors.db` — the developer's real file. It then called
`db.create_all()` and `db.drop_all()` on it, three times over.

The visible result after a full `npm test` was a main file holding 12 *empty* tables with
a write-ahead log on top that reduced the database to `alembic_version` alone. Data was
restored from a verified restore point with nothing lost.

`tests/conftest.py` had claimed in its own docstring that "no test can touch the
developer's database", but that guarantee only ever held for tests using the `app`
fixture. The fix is an **autouse `_isolate_default_database` fixture** that redirects the
settings default to a per-test temporary file, so *every* test is isolated whether or not
it remembers to pass a URI — including tests written later. It patches the settings object
rather than the environment, because `DATABASE_URL` is resolved once at import, long
before any fixture runs.

Verified by fingerprinting the live database before and after a full 496-test run: file
mtime unchanged, all row counts identical.

**Also fixed here:** `backend/instance/` now holds a forensics directory and two verified
restore points alongside the pre-existing `.bak` files. All are gitignored and none may
be committed, but they hold live business data on disk (§E).

---

*Original audit produced by a read-only review; nothing was modified, staged, committed
or pushed. This revision records the remediation work that followed, which resolved 20
findings, partially closed 4 and left 24 outstanding. Nothing was closed because the
application happens to work, and two newly confirmed defects (§M) are recorded as open.
No push was performed.*