# Payment method and UPI QR — implementation plan

Status: **implemented and verified.** Decisions below are the ones that were made,
with the reasoning, so a later reader can tell a decision from an accident.

References: `PLAN.md` (FR-P6, FR-P7, FR-P8), `docs/phases.md`, §8.4, §8.5, §11.

---

## 1. The distinction the whole design turns on

Two fields that both sound like "the payment method", and are deliberately not the
same thing:

- **Invoice payment method** (`invoices.payment_method`) — *how payment options are
  presented on this document.* Chosen before issue, frozen at issue, never touched
  again. A property of the document, like `terms_text`.
- **Payment ledger method** (`payments.method`) — *how the client actually paid.*
  Recorded when money arrives, may differ, and may differ twice on one invoice.

An invoice issued as `upi` and later settled half by `bank_transfer` and half by
`cash` is entirely normal, and must print as `upi` forever. That sentence is the
requirement; everything below is machinery for it.

---

## 2. The two decisions that were open

### 2.1 Where the method is stored — a new nullable column

Chosen: `invoices.payment_method VARCHAR(16)`, nullable, with
`CHECK (payment_method IS NULL OR payment_method IN ('upi','bank_transfer','cash'))`.

The alternative was a key inside the existing `bank_snapshot` JSON, which needs no
migration. Rejected because:

- A payment *presentation* choice is a first-class document fact, not a bank-detail
  string. Putting it in a blob loses the database-level `CHECK` that makes an invalid
  value impossible rather than merely rejected in one code path.
- `NULL` is the "Not Selected" state, so the migration is purely additive — no
  backfill, no data movement on a table that already holds every issued invoice.
- One nullable column is not a cost worth paying for a correctness guarantee.

Migration `b8d5f0e2c7a1`, `down_revision = 'a7c4e19b2d80'`, via `batch_alter_table`
because SQLite cannot `ADD COLUMN` outside batch mode.

### 2.2 What the invoice's QR encodes — the grand total

The tension: requirement 7 asks for a QR on the invoice, requirement 3 demands the
invoice never change after payment, and an amount-bearing QR must encode *some*
amount.

| Encodes | Static? | Right on a partly-paid invoice? |
|---|---|---|
| Outstanding balance | **No** — moves with every payment | Yes |
| **Grand total** | **Yes** | No — over-collects |

Chosen: the **grand total**. It is the amount the sheet itself states as owed, so
the code and the document agree, and a reprint is byte-identical forever. Collecting
a reduced sum is the Balance / Payment Due document's job, and that document is
regenerated per payment.

Requirement 8 corroborates this: it says the Balance QR encodes the outstanding
amount "not the original invoice total", which only makes sense as a contrast
against the invoice QR encoding the total.

Consequence, stated plainly: a printed invoice with a QR can ask for more than is
outstanding. That is why the sheet prints "Verify the amount before paying" — the
stale reprint is safe to act on.

---

## 3. The presentation matrix

Driven entirely by the stored value. `NULL` is a first-class state, not an error.

| `payment_method` | printed |
|---|---|
| `upi` | UPI ID, payee name, 26mm QR, "Scan to Pay", verify note. **No** bank details. |
| `bank_transfer` | account holder, bank name, account number, IFSC, branch. **No** QR, **no** UPI ID. |
| `cash` | `Payment Method: Cash` alone. No QR, UPI ID, or bank details. |
| `NULL` | **Both** electronic rails. Cash is never offered as a default. |

Where the details come from, unchanged in principle:

- **UPI ID and payee name** — live from `CompanySettings` at render time, the §8.4
  exception Phase 8 already made. An invoice pointing at a closed account is a worse
  failure than one pointing at a replacement. The exception stays narrow: the
  *method* is frozen; the *address it points at* is live.
- **Bank details** — from the invoice's `bank_snapshot`, so later Settings edits
  cannot rewrite an issued invoice.

A `upi` invoice with no UPI ID configured prints no rail at all. It does not fall
back to bank details, because that would contradict the choice on the document, and
a "Scan to Pay" line with no code points nowhere.

---

## 4. Staticity, enforced four ways

1. **Structural** — `update_invoice_draft` raises unless `status == 'draft'`, so
   `payment_method` cannot be altered once issued. This is the entire freeze
   mechanism; there is no second lock.
2. **Architectural** — nothing in `record_payment` touches the `invoices` row. Only
   `payments` receives an INSERT.
3. **Snapshot** — bank details come from `bank_snapshot`, frozen at conversion.
4. **Derived-only figures** — `paid_paise`, `outstanding_paise` and
   `payment_status` are computed on read and never persisted, so a payment cannot
   rewrite a stored amount even in principle.

`test_payment_method_is_derived_and_never_written_to_the_invoice` snapshots every
`invoices` column before and after a payment and asserts none changed. It is the
executable statement of this section and fails first if anything ever writes to the
invoice during a payment.

`latest_payment_method` remains in the API for the application UI, and is explicitly
**not** printed. Putting a ledger-derived method on a permanent document is the exact
confusion the split removes: a sheet that silently re-presents itself in the method
it was last paid by.

---

## 5. Where the code is

| Concern | File |
|---|---|
| Migration | `backend/migrations/versions/b8d5f0e2c7a1_invoice_payment_method.py` |
| Column + CHECK | `backend/app/models/invoice.py` |
| Validation (`OneOf`, `allow_none`) | `backend/app/schemas/quotations.py` |
| Draft-edit whitelist | `backend/app/services/invoices.py` |
| Selector (draft editor) | `frontend/src/features/invoices/InvoiceDetailPage.jsx` |
| Presentation matrix | `frontend/src/features/documents/DocumentPaper.jsx` |
| QR gutter, one-column collapse | `frontend/src/features/documents/DocumentPaper.module.css` |
| Backend tests | `backend/tests/test_payments.py` (6 new) |
| Document tests | `frontend/src/features/invoices/invoices.test.jsx` |
| Selector tests | `frontend/src/features/invoices/invoice-payment-method.test.jsx` |
| A4 harness | `scripts/print-check.mjs` |

No new endpoint, no new route, no new API module. The selector rides the existing
`PUT /invoices/:id`.

---

## 6. Two traps hit while implementing, worth keeping

### 6.1 `TextField` already unwraps the event

`TextField`'s `onChange` receives `event.target.value`, not the event. A handler
written as `(e) => ... e.target.value` throws on the first keystroke of every other
field on the page too. `select` is the first `as="select"` field in the app, which is
why this had never surfaced.

### 6.2 A 26mm gutter around a card that is already 26mm

The first instinct was a fixed `flex: 0 0 26mm` column for the QR, so the details
would start at a fixed offset. But `UpiQrCard`'s print variant is *itself* a row —
code left, VPA/payee right — and owns its own 26mm. Pinning the wrapper to 26mm
squeezes that internal row into a 26mm-wide column, so the VPA wraps one word per
line and the payment block measured **104.1mm**, pushing the sheet to 325.4mm: over
A4. The gutter has to be `flex: 0 0 auto`, the card's natural width.

Only the print harness caught this. jsdom has no layout, and the unit tests were
green throughout.

---

## 7. Verification

`npm run verify` green: lint, Prettier, **319 frontend** tests (was 308), **354
backend** tests (was 348), production build.

`node scripts/print-check.mjs` renders five documents through real Chrome with the
real production CSS bundle and fails the run if a sheet exceeds the 269mm printable
height, if screen chrome survives into print, or if the QR drops below 20mm:

| Document | Sheet | Payment block | QR |
|---|---|---|---|
| Invoice, Not Selected | 257.8mm **fits** | 36.6mm | 26mm |
| Invoice, UPI | 254.7mm **fits** | 33.4mm | 26mm |
| Invoice, Bank transfer | 242.9mm **fits** | 21.6mm | none |
| Invoice, Cash | 233.2mm **fits** | 11.9mm | none |
| Balance / Payment Due | 201.7mm **fits** | 26.0mm | 26mm |

All four invoice presentations are measured, not reasoned about: a bank-transfer
invoice renders its rows full-width in two columns where Not Selected renders them in
one column beside a code, so the wrap behaviour genuinely differs.

---

## 8. A third trap, in the harness itself

`print-check.mjs` resolved CSS Module hashes from a hard-coded list, so editing any
rule in a stylesheet it merely *reads* changed the hash and broke the harness. A tool
that fails for unrelated edits trains you to ignore its failures.

The hashes are now derived at runtime from an anchor class verified to be unique to
each module (`_paymentQr` → DocumentPaper, `_qrCard` → PaymentDuePaper,
`_qrColumn` → UpiQrCard), which self-checks that the anchors stay unique. This is the
same class of bug as §6.1 and §6.2: something that looks like a working measurement
and is not.
