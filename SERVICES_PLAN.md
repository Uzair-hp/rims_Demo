# SERVICES_PLAN.md — Services Catalog (Addendum to PLAN.md v1.5)

| | |
|---|---|
| **Status** | PROPOSED — not yet approved. Nothing here supersedes PLAN.md until merged as Appendix B12+ |
| **Scope** | An internal **Services catalog** (standard rate card) and an **"Add from services"** picker in the quotation editor |
| **Fits into** | New **Phase 9A**, between Phase 9 (Dashboard) and Phase 10 (PWA), so the Phase 10–12 sweeps (offline, security, a11y, E2E) cover it |
| **Stack** | Unchanged: Flask 3 + SQLAlchemy 2 + Alembic + SQLite; React 19 JS/JSX + Vite, plain CSS tokens + CSS Modules, TanStack Query, React Hook Form + Zod |

---

## 1. What this is (and is not)

Ruchita Interiors keeps a list of the services it offers, each with a **standard rate**. When building a quotation, the owner picks a service and it becomes a normal line item, pre-filled with name, description, unit, quantity and rate.

**It is a rate card, not a locked price list.** The rate is editable on the quotation line, because interior work varies by site and size. The catalog stores the *standard* rate; the line stores the *agreed* rate. The UI shows when they differ.

Why not lock the rate? This is a single-user app (§1.3). The only person who could be blocked is the owner, so a lock adds friction and protects nothing.

**Not in scope:** inventory, vendors, stock, packages/bundles, per-service tax rates, a public website services page, automatic linkage to the footer "services strip" text in Settings. This is not "inventory" (§1.3) — there is no stock, purchasing or supplier concept.

---

## 2. Decisions this plan makes (confirm before building)

| # | Decision | Reason |
|---|---|---|
| S1 | Catalog rate is a **default**, editable per quotation line | Real jobs vary; a lock only blocks the owner |
| S2 | **Snapshot, never live-link:** the line copies name/description/unit/rate at add time | Same rule as §8.4. Changing a catalog rate must never alter an existing quotation or invoice |
| S3 | **Catalog rate must be > 0** | §10.3 blocks *Send* on any line with rate 0. A "free site visit" service would make quotations unsendable |
| S4 | **No per-service GST** | GST in this app is document-level (`gst_bp` on the quotation, §8.3/§10.2). A per-service rate would conflict with the calculation model |
| S5 | **Archive only, no hard delete** | Same as clients (FR-C4, D9). Old lines keep pointing at the service |
| S6 | Service `category`/`unit` are free text with suggestions from the existing Settings → Catalogue lists | Reuses FR-Q3 / FR-S5; no new lists to maintain |
| S7 | Service metadata on lines (`service_id`, `catalog_rate_paise`) is **informational only** and never enters `calculations.py` | Financial core (R1, D1) stays untouched |
| S8 | Services never appear on printed documents as a "catalog" concept | A printed line looks exactly like any other line |
| S9 | No seeded rates | The owner's real prices are not known; invented rates would be wrong |

---

## 3. Functional requirements

Priority: **M** must, **S** should.

- **FR-SV1 (M)** CRUD for services: name (required, ≤200), category (≤100), description (≤2000), unit (default `job`), default quantity (default 1, ≤3 decimals), standard rate (paise, > 0, ≤ 10¹²).
- **FR-SV2 (M)** Archive (soft delete) with confirmation, and **restore**. Archived services are hidden from the list by default and from the picker always. Hard delete is never exposed.
- **FR-SV3 (M)** Duplicate names are blocked among **active** services (case-insensitive) → 409 with a clear message. An archived name can be reused.
- **FR-SV4 (M)** Server-side search by name/category/description (`q`) and category filter; sorted by category then name.
- **FR-SV5 (M)** Editing a service affects **new quotation lines only**. The edit form says so.
- **FR-SV6 (M)** "Add from services" in the quotation editor; each pick appends one pre-filled, fully editable line. Same service can be added more than once (e.g. two rooms).
- **FR-SV7 (M)** A line added from the catalog carries a quiet "Catalog" marker and, when its rate differs from the standard rate at add time, a "Standard ₹X" hint. Both are app-UI only, never printed.
- **FR-SV8 (M)** Conversion to invoice copies `service_id` and `catalog_rate_paise` onto `invoice_items` (§8.4 snapshot). Duplicate quotation (FR-Q11) copies them as-is.
- **FR-SV9 (S)** One-time CLI import from a CSV (`flask seed-services services.csv`) so the owner does not type the whole list by hand.
- **FR-SV10 (S)** Empty state in the picker when the catalog is empty, linking to the Services page.

---

## 4. Data model

### 4.1 New table `services`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | NOT NULL, ≤200 |
| category | TEXT | free text, ≤100, nullable |
| description | TEXT | ≤2000; copied to the line description |
| unit | TEXT | NOT NULL, default `'job'` |
| default_qty_milli | INTEGER | NOT NULL, default `1000`, CHECK ≥ 0 |
| rate_paise | INTEGER | NOT NULL, CHECK > 0 AND ≤ 10¹² |
| archived_at | DATETIME | NULL = active |
| created_at / updated_at | DATETIME | UTC |

Indexes: `(archived_at, category, name)`; **partial unique** `lower(name) WHERE archived_at IS NULL` (same pattern as the invoices partial index).

### 4.2 Columns added to `quotation_items` and `invoice_items`

| Column | Type | Notes |
|---|---|---|
| service_id | INTEGER NULL | FK → services, **RESTRICT** (safe: services are never hard-deleted) |
| catalog_rate_paise | INTEGER NULL | standard rate at the moment the line was added; display metadata only |

Migration rules:
- One Alembic migration, both columns nullable, **no backfill** (existing lines are simply "not from catalog").
- SQLite: use `batch_alter_table` for the FK columns; verify `downgrade` then `upgrade` on empty and seeded DBs (same gate as Phase 3).
- `snapshot.py` (invoice conversion) copies both new fields.

### 4.3 Line-add contract

The client sends `service_id` and `catalog_rate_paise` inside each item of the existing `PUT /quotations/:id` payload (full-replace semantics are unchanged). The server validates types and range, and that `service_id` exists (archived allowed, so an old draft that already contains an archived service can still be saved). These two fields never influence `line_total_paise`, subtotal, discount, GST or grand total.

---

## 5. API (new blueprint `services`, mirrors `clients`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/services?q=&category=&include_archived=false&page=&page_size=` | Paginated (max 100). Sort: category, name. |
| POST | `/services` | Create. 422 on validation, 409 on duplicate active name. |
| GET | `/services/:id` | Works for archived services too. |
| PUT | `/services/:id` | Update. `updated_at` check → 409 on concurrent-tab edit (§21 #26). |
| DELETE | `/services/:id` | **Archives**; a hard-delete is never exposed. |
| POST | `/services/:id/restore` | Clears `archived_at`; 409 if already active; 409 if the name now collides with an active service. |

All endpoints require auth; mutations require CSRF (§16). Error envelope is the standard one (§9.1). The picker uses the list endpoint with `page_size=100` and `q`. A catalog of more than 100 active services is not expected; if it happens, search-as-you-type already covers it.

Changes to existing endpoints: `quotations` PUT/GET item shape gains the two optional fields; `invoices` GET item shape gains them (read-only).

---

## 6. Frontend

**Files (follow §23 conventions)**
```
frontend/src/
├─ api/endpoints/services.js
├─ features/services/
│  ├─ ServicesPage.jsx (+ .module.css)
│  ├─ ServiceFormModal.jsx        # RHF + Zod
│  └─ ServicePicker.jsx           # reusable, like ClientPicker
├─ hooks/useServices.js           # TanStack Query wrappers + invalidation
└─ lib/validation.js              # + serviceSchema (Zod mirrors backend rules)
backend/app/
├─ models/service.py
├─ api/services.py
├─ schemas/service.py
├─ services/services.py           # business rules (archive/restore/dup-name)
└─ seed/seed_services.py          # optional CSV import CLI
backend/tests/test_services.py
```

**Route & navigation**
- Route `/services`; page #11 in §6 of PLAN.md.
- Desktop sidebar: Dashboard, Quotations, Invoices, Clients, **Services**, Settings.
- Mobile: the bottom nav is already full (5 slots), so Services goes in the **More** sheet (Clients, Services, Settings, Logout).

**Services page**
- Search box, category chip scroller (the only permitted horizontal scroll, §7), "Show archived" toggle.
- Table on desktop, cards on mobile. Columns: name, category, unit, standard rate (₹, `MoneyInput`/`format.js`), status.
- New / Edit via `ServiceFormModal`. No separate detail page in v1 (there is no history section to show).
- Archive asks for confirmation (FR-U1). Archived rows show a badge and a Restore action.
- Edit form helper text: "Changes apply to new quotation lines only."

**Quotation editor integration**
- "Add from services" button beside the existing "Add item". The custom free-text line stays; the catalog supplements it.
- `ServicePicker` opens as a modal (sheet on mobile): search + category chips + list. Tapping a service appends a line and the picker stays open with an added-count and a Done button, so several services can be added in one visit.
- Pre-filled line: category = service category, name, description, unit, qty = default qty, rate = standard rate. All editable.
- Marker/hint per FR-SV7. Money math stays in `lib/calc.js` and `services/calculations.py` only.
- Offline: mutations disabled with the existing offline banner (§17); the picker can read cached services but adding a line to a draft still saves through the normal editor path.

---

## 7. Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | Catalog rate edited after a quotation used the service | Existing lines unchanged (S2); hint compares to the snapshot, not the live rate |
| 2 | Service archived while a draft still contains it | Draft keeps the line and can be saved (archived ids allowed on PUT); it just cannot be added again |
| 3 | Same service added twice | Allowed; two independent lines |
| 4 | Rate 0 or negative on a service | 422; S3 |
| 5 | Duplicate active name (case-insensitive) | 409 |
| 6 | Restore collides with a new active name | 409 with message |
| 7 | Unknown `service_id` in a quotation PUT | 422 |
| 8 | Empty catalog | Picker shows empty state with link to Services |
| 9 | Two tabs editing one service | `updated_at` mismatch → 409 "changed elsewhere — reload" |
| 10 | Duplicate quotation | Items copied including `service_id` / `catalog_rate_paise` unchanged |
| 11 | Long descriptions / names | Same caps as items (2000 / 200); wraps in the table |
| 12 | Quantity with decimals | Milli-unit integer, same as items (≤3 decimals) |

---

## 8. Build order (Phase 9A)

**9A.1 — Backend catalog.** Model, Alembic migration (services + item columns), schema, service layer, blueprint, `test_services.py`. *Exit:* CRUD/archive/restore/search green; migration down/up green on empty and seeded DB.

**9A.2 — Services page.** API endpoints module, `useServices`, `ServicesPage`, `ServiceFormModal`, sidebar + More-sheet entries, empty/loading/error states (§20). *Exit:* create, search, filter, edit, archive, restore in the browser at 360 px and 1280 px.

**9A.3 — Quotation integration.** Item fields in schemas/API, `snapshot.py` copy on conversion, duplicate copy, `ServicePicker`, "Add from services" button, marker/hint. *Exit:* pick service → editable line → totals unchanged in paise-exact terms → convert → invoice lines carry the fields.

**9A.4 — Hardening & docs.** Optional CSV import CLI, README note, PLAN.md amendments (section 10 below), status mirror in `docs/phases.md`. *Exit:* the phase gate below.

---

## 9. Tests and exit gate

**Backend (`test_services.py` + additions)**
- CRUD validation: name required; rate ≤ 0 rejected; overflow rejected; malformed JSON → 422 envelope
- Partial unique name: active dup → 409; archived name reusable; restore collision → 409
- Search by name/category; category filter; pagination
- Auth required (401) and missing CSRF (403)
- **Snapshot:** change service rate → existing quotation item and invoice item unchanged
- Conversion copies `service_id` and `catalog_rate_paise`; duplicate quotation copies them
- Quotation PUT with unknown `service_id` → 422; with archived service id → accepted
- **`test_calculations.py` unchanged and green** (proves S7)
- Migration down/up on empty and seeded DB

**Frontend**
- `ServicePicker`: search, category filter, tap adds a line with defaults, stays open, Done closes
- `ServiceFormModal`: validation (name, rate > 0, quantity)
- Editor: marker shown; "Standard ₹X" hint appears only when the rate differs
- `ServicesPage`: list, search, archive confirm, restore

**Gate (PLAN.md §25 + B11)**
1. `npm run verify` green.
2. App loaded in a real browser at `http://127.0.0.1:5173` via `npm run dev:start`, exercising: create a service, add it to a quotation, edit its rate on the line, save, approve, convert, and confirm the invoice shows the agreed rate, then change the catalog rate and confirm both documents are unchanged.
3. Servers still reachable after the starting command exits.

**Acceptance checklist**
- [ ] Service CRUD with validation; rate must be > 0
- [ ] Archive asks for confirmation; restore works; archived hidden from picker
- [ ] Duplicate active names blocked; archived names reusable
- [ ] "Add from services" pre-fills a fully editable line; custom lines still work
- [ ] Editing a catalog rate never changes existing quotations or invoices
- [ ] Marker and "Standard ₹X" hint show in app UI and never on printed documents
- [ ] Totals identical whether a line came from the catalog or was typed by hand
- [ ] Conversion and duplicate preserve the service fields
- [ ] Mobile: Services reachable from More sheet; zero horizontal scroll at 360 px

---

## 10. Amendments to apply to PLAN.md when approved

| Where | Change |
|---|---|
| §4 | Add a **4.10 Services** block with FR-SV1–SV10 |
| §6 | Add page #11 Services (`/services`); picker added to modals list |
| §7 | Add Services to sidebar and to the mobile More sheet |
| §8.3 | Add `services` table; add `service_id`, `catalog_rate_paise` to `quotation_items` / `invoice_items`; extend ER diagram |
| §8.4 | Note that invoice conversion copies the two service fields |
| §9 | Add the `services` blueprint and endpoints; note item-shape change |
| §23 | Add the files listed in section 6 above |
| §24/§25 | Add Phase 9A and its acceptance checklist |
| Appendix B | **B12:** Services catalog is a default-rate list; snapshot-only; rate > 0; no per-service GST; archive-only |
| Header | Reconcile status (see below) |

**Housekeeping found while reading PLAN.md:** the header status says "Phases 1, 2 and 3 are complete; Phase 4 is next", but §25 shows Phases 4 to 9 ticked as done (with test counts). One of them is stale. Fix it when merging so the next agent does not start the wrong phase.
