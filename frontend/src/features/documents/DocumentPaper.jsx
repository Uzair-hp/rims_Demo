/**
 * Ruchita Interiors — branded document sheet (§14.3, FR-DOC1, FR-DOC2).
 *
 * A presentational A4 sheet for a quotation. It fetches nothing and holds no
 * state: the caller passes the server's document payload plus the company
 * settings row, so what renders is always the authoritative data rather than a
 * client-side copy (§10.1, D2).
 *
 * Layout order is the §14.3 spec, in order: header band, title strip, client
 * block, items table, totals block, terms, signatory, footer. The invoice
 * variant's extra blocks (amount paid, balance due, bank details) are Phase 7 —
 * this component renders the quotation family only.
 *
 * Multi-page behaviour (§14.4) lives in CSS, not JS: the `<thead>` repeats on
 * every page (`display: table-header-group`), rows refuse to break across pages,
 * and the totals block is never orphaned. Page numbers are deliberately omitted
 * rather than faked (FR-DOC4).
 *
 * `titleLevel` exists for one reason: the print route needs a single `<h1>`, and
 * the preview overlay must drop to `<h2>` so the editor's page heading stays the
 * only level-one heading on screen.
 *
 * @param {{
 *   document: object,
 *   settings?: object,
 *   logoSrc?: string | null,
 *   titleLevel?: 1 | 2,
 *   numberOverride?: string,
 *   isUnsaved?: boolean,
 * }} props
 */

import { useState } from 'react'
import { calcLineTotal, milliToInput } from '../../lib/calc.js'
import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import UpiQrCard from '../payments/UpiQrCard.jsx'
import styles from './DocumentPaper.module.css'

/**
 * The official brand lockup shipped in `public/brand/`, used when Settings has no
 * uploaded logo. It is the same source the sidebar and login page fall back to,
 * and being a static asset it is precached by vite-plugin-pwa — so it is present
 * for the print/PDF renderer, which does not share the app's JS lifecycle.
 */
const BUNDLED_LOGO = '/brand/logo.svg'

/**
 * Whether this document is payable.
 *
 * A quotation is not, so it never shows a UPI QR — a payment instruction on a
 * document that is not yet a bill is the kind of thing that gets paid by mistake.
 */
function isInvoiceDocKind(docKind) {
  return docKind === 'invoice'
}

/**
 * FR-P8: the invoice's payment *presentation*, and how each choice reads on paper.
 *
 * `doc.payment_method` is the admin's choice of which instructions to print, made
 * while the invoice was a Draft and frozen at issue by the server's draft-only edit
 * guard. It is NOT `latest_payment_method`, which the server derives from the
 * payment ledger and which must never influence a printed document: an invoice
 * issued as UPI still prints UPI after the client pays by bank transfer.
 *
 * The four states, and what each is allowed to show:
 *   upi            -> UPI id, payee, QR, "Scan to Pay". Never bank details.
 *   bank_transfer  -> account holder, bank, account number, IFSC. Never a QR or VPA.
 *   cash           -> the method line alone. No rails at all.
 *   null           -> both electronic rails, so the client can pay either way. Cash is
 *                     never presented as an instruction here; it is a choice the admin
 *                     makes deliberately, not a default.
 */
const PAYMENT_PRESENTATION = {
  upi: { label: 'UPI', showUpi: true, showBank: false },
  bank_transfer: { label: 'Bank transfer', showUpi: false, showBank: true },
  cash: { label: 'Cash', showUpi: false, showBank: false },
  default: { label: 'UPI + Bank transfer', showUpi: true, showBank: true },
}

function paymentPresentation(method) {
  return PAYMENT_PRESENTATION[method] || PAYMENT_PRESENTATION.default
}

/** Join the non-empty parts of an address into a single printable line. */
function joinAddress(...parts) {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(', ')
}

/**
 * Group consecutive items by category, preserving order.
 *
 * A category subheader is only emitted for runs that actually have a category
 * (§14.3: "grouping subheader row when present"), so uncategorised quotes stay
 * a single clean table instead of a stack of empty header rows.
 *
 * @param {Array<object>} items
 * @returns {Array<{ category: string, items: Array<object>, startIndex: number }>}
 */
export function groupItemsByCategory(items) {
  const groups = []
  let index = 0
  for (const item of items || []) {
    const category = (item.category || '').trim()
    const last = groups[groups.length - 1]
    if (category && last && last.category === category) {
      last.items.push(item)
    } else {
      groups.push({ category, items: [item], startIndex: index })
    }
    index += 1
  }
  return groups
}

export default function DocumentPaper({
  document: doc,
  settings = null,
  logoSrc = null,
  titleLevel: TitleLevel = 'h1',
  numberOverride = null,
  isUnsaved = false,
  docKind = 'quotation',
}) {
  // §21.23: the brand mark degrades through three steps rather than disappearing.
  // A configured upload wins; failing that we fall back to the bundled official
  // vector, which is a static public asset and therefore always available to the
  // browser's print/PDF renderer (an authenticated API route is a worse bet when
  // the print pipeline fetches images). Only if that also fails do we fall back
  // to a typographic wordmark.
  const [logoFailed, setLogoFailed] = useState(false)
  const logoSrcResolved = logoSrc || BUNDLED_LOGO
  const showLogo = !logoFailed

  // Phase 7: one sheet, two document kinds. The shared spine — header, client
  // block, items, tax breakdown, terms, signatory, footer — is identical; only
  // the title, the date pair and the money rows below the grand total differ.
  const isInvoice = isInvoiceDocKind(docKind)
  const title = isInvoice ? 'Tax Invoice' : 'Quotation'
  const documentLabel = isInvoice ? 'Invoice document' : 'Quotation document'

  const s = settings || {}
  const number = numberOverride || doc.number || ''

  // The payment QR is now **generated** from a UPI intent URI rather than fetched
  // as an uploaded image (Phase 8 shipped the static version; see PLAN.md FR-P6,
  // amended). Two consequences worth stating on the sheet itself:
  //
  // 1. It needs a UPI ID, not an image. With none configured there is nothing to
  //    encode, so the subsection is dropped and the UPI ID in the bank rows above
  //    remains the way to pay — an omitted QR reads as a gap, a broken image reads
  //    as a defect.
  // 2. The amount is the *outstanding* balance, read live from the ledger. That is
  //    the behaviour Phase 8's static image could not have: a customer's own printed
  //    copy of a partially-paid invoice can no longer over-collect. The cost, stated
  //    plainly below the QR, is that paper is a snapshot — if the balance moves after
  //    printing, the printed amount is stale. Hence "Verify the amount before
  //    paying" rather than silence.
  // The live UPI ID, from Settings and never from `bank_snapshot` (the 8.4 exception
  // Phase 8 already made): a QR or an address is an instruction to send money
  // somewhere, not a term of the invoice, and a frozen one would keep directing
  // customers at an account the owner has since closed.
  const liveUpiId = (s.upi_id || '').trim()
  const client = doc.client_snapshot || {}
  const items = doc.items || []

  const subtotal = doc.subtotal_paise || 0
  const discount = doc.discount_paise || 0
  const gst = doc.gst_paise || 0
  const otherCharges = doc.other_charges_paise || 0
  const grandTotal = doc.grand_total_paise || 0
  // Printed label only — see the §11 note below. The stored subtotal and discount
  // are both the server's, so this cannot drift from the document it prints.
  const taxable = subtotal - discount
  const isPercentDiscount = (doc.discount_type || 'percent') === 'percent'
  const discountLabel = isPercentDiscount ? `Discount (${(doc.discount_bp || 0) / 100}%)` : 'Discount'
  const gstLabel = `GST ${(doc.gst_bp || 0) / 100}%`

  // §11 figures. The invoice's paid and outstanding amounts are computed by the
  // server and passed through untouched (D2): the sheet prints what the ledger
  // says, never a running total of its own. The `??` is the quotation fallback
  // only — a quotation has no ledger, so it has no `outstanding_paise` to print,
  // and the derived value is a placeholder that is never rendered (see the
  // invoice-only money rows below).
  //
  // `taxable` is the one subtraction on this sheet, and it is a display
  // convenience rather than a re-derivation: both operands are server-computed
  // columns of this document, and the value is a printed label, never a write.
  // The document's own money — what is owed and what remains — comes from the
  // server only.
  const paid = doc.paid_paise || 0
  const outstanding = doc.outstanding_paise ?? Math.max(0, grandTotal - paid)

  const companyAddress = joinAddress(
    s.address_line1,
    s.address_line2,
    joinAddress(s.city, s.state, s.pincode),
  )
  const clientAddress = joinAddress(client.address, client.city, client.state, client.pincode)

  // §8.4: an invoice prints the bank details and signatory it snapshotted at
  // conversion. A quotation has no snapshot, so it falls back to live Settings.
  //
  // One deliberate exception to §8.4's immutability: the payment QR is NOT
  // snapshotted, and is read live from Settings on every render. Everything else
  // here is frozen because it states the terms the invoice was issued under, so
  // reprinting it must keep saying the same thing. A QR is not a statement of
  // terms — it is an instruction to send money somewhere. Owners change bank
  // accounts and close UPI handles, and a frozen QR would keep directing
  // customers to an account that no longer exists, which is worse than the
  // document not matching the Settings page byte for byte. The `payment_qr_path`
  // column is consequently absent from `bank_snapshot` by design, and
  // `backend/tests/test_invoices_api.py` pins that.
  const bank = doc.bank_snapshot || null
  const signatory = doc.signatory_name || s.signatory_name || 'Authorised Signatory'
  // Deliberately omits `upi_id`, which the snapshot also carries. The UPI address is
  // read live and printed once in the hint below: printing the frozen one here as
  // well would print two different addresses whenever the owner has since changed
  // theirs, and the customer would have no way to tell which to pay.
  const bankLines = bank
    ? [
        bank.account_name && { label: 'Account name', value: bank.account_name },
        bank.account_number && { label: 'Account number', value: bank.account_number },
        bank.bank_name && { label: 'Bank', value: bank.bank_name },
        bank.branch && { label: 'Branch', value: bank.branch },
        bank.ifsc && { label: 'IFSC', value: bank.ifsc },
      ].filter(Boolean)
    : []

  // FR-P8: the presentation matrix, applied to the invoice's stored choice. `cash`
  // is the only state with no rail, so it prints the method line on its own; the
  // `showQr` guard is what keeps a QR from appearing on a bank-transfer or cash
  // invoice even though a UPI ID exists in Settings.
  const presentation = paymentPresentation(isInvoice ? doc.payment_method : null)
  const showUpi = isInvoice && presentation.showUpi && Boolean(liveUpiId)
  const showBank = isInvoice && presentation.showBank
  // The invoice's own QR encodes the GRAND TOTAL, never the outstanding balance.
  // An outstanding amount is not knowable when the document is issued and moves
  // with every payment, so encoding it would mean a reprint of the same invoice
  // asked for a different sum - which is what §8.4 forbids of a tax document. The
  // Balance / Payment Due document exists precisely to collect a reduced sum, and
  // it is regenerated per collection.
  const showQr = showUpi
  // Only worth naming a method when the choice actually changes what is printed.
  // "UPI + Bank transfer" is a self-describing block of two rail sections; a Cash
  // invoice's only instruction is the word itself.
  const showMethod = isInvoice && !presentation.showUpi && !presentation.showBank
  const payeeName = (s.company_name || '').trim()
  const bankRows = showBank ? bankLines : []

  return (
    <article className={styles.paper} data-document-paper aria-label={documentLabel}>
      {/* 1. Header band: brand left, company contact right, gold rule beneath (§14.3). */}
      <header className={styles.header}>
        <div className={styles.brand}>
          {showLogo ? (
            <img
              src={logoSrcResolved}
              alt={`${s.company_name || 'Company'} logo`}
              className={styles.logo}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            // Wordmark fallback (§21.23): the brand serif, never a bare gold fill
            // on a light surface — that is the contrast case §18.4 forbids.
            <span className={styles.wordmark}>{s.company_name || 'Ruchita Interiors'}</span>
          )}
          {/* The company name is printed whether or not a logo loaded. It used to
              be an either/or with the mark, which meant uploading a logo silently
              removed the business name from every issued document (§14.3 asks for
              both). */}
          {showLogo ? <p className={styles.companyName}>{s.company_name || 'Ruchita Interiors'}</p> : null}
        </div>

        <div className={styles.company}>
          {s.tagline ? <p className={styles.tagline}>{s.tagline}</p> : null}
          <address className={styles.companyMeta}>
            {companyAddress ? <span>{companyAddress}</span> : null}
            {s.phone ? <span>{s.phone}</span> : null}
            {s.email ? <span>{s.email}</span> : null}
            {s.website ? <span>{s.website}</span> : null}
            {s.gstin ? <span className={styles.gstin}>GSTIN: {s.gstin}</span> : null}
          </address>
        </div>
      </header>

      {/* 2. Title strip: document kind + number right, dates left. */}
      <div className={styles.titleStrip}>
        <div className={styles.dates}>
          <p className={styles.dateLine}>
            <span className={styles.microLabel}>{isInvoice ? 'Issue date' : 'Date'}</span>
            <span className={styles.dateValue}>
              {formatDate(isInvoice ? doc.issue_date : doc.quotation_date) || '—'}
            </span>
          </p>
          <p className={styles.dateLine}>
            <span className={styles.microLabel}>{isInvoice ? 'Due date' : 'Valid until'}</span>
            <span className={styles.dateValue}>
              {formatDate(isInvoice ? doc.due_date : doc.valid_until) || '—'}
            </span>
          </p>
        </div>
        <div className={styles.heading}>
          <TitleLevel className={styles.docTitle}>{title}</TitleLevel>
          <p className={styles.docNumber}>{isUnsaved ? 'Draft — not yet saved' : number || 'Draft'}</p>
        </div>
      </div>

      {/* 3. Client block: bill-to beside the project/site address (§14.3). */}
      <section className={styles.clientBlock}>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>Bill To</h2>
          <p className={styles.clientName}>{client.name || '—'}</p>
          {clientAddress ? <p className={styles.clientLine}>{clientAddress}</p> : null}
          {client.phone ? <p className={styles.clientLine}>{client.phone}</p> : null}
          {client.email ? <p className={styles.clientLine}>{client.email}</p> : null}
          {client.gstin ? <p className={styles.clientLine}>GSTIN: {client.gstin}</p> : null}
        </div>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>Project / Site Address</h2>
          {client.project_address ? (
            <p className={styles.clientLine}>{client.project_address}</p>
          ) : (
            <p className={styles.clientLine}>—</p>
          )}
        </div>
      </section>

      {/* 4. Items table. `thead` repeats per page; rows never break (§14.4). */}
      <table className={styles.items} data-document-items>
        <thead>
          <tr>
            <th scope="col" className={styles.colIndex}>
              #
            </th>
            <th scope="col" className={styles.colCategory}>
              Category
            </th>
            <th scope="col" className={styles.colItem}>
              Item &amp; Description
            </th>
            <th scope="col" className={styles.colUnit}>
              Unit
            </th>
            <th scope="col" className={styles.colNum}>
              Qty
            </th>
            <th scope="col" className={styles.colNum}>
              Rate
            </th>
            <th scope="col" className={styles.colNum}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className={styles.emptyRow}>
                No items yet.
              </td>
            </tr>
          ) : (
            groupItemsByCategory(items).map((group, groupIndex) => (
              <GroupRows
                key={`${group.category || 'ungrouped'}-${groupIndex}`}
                group={group}
                startIndex={group.startIndex}
              />
            ))
          )}
        </tbody>
      </table>

      {/* 5. Totals block. Kept whole so it is never orphaned on a page (§14.4). */}
      <section className={styles.totalsBlock} data-document-totals>
        <dl className={styles.totals}>
          <div className={styles.totalRow}>
            <dt>Subtotal</dt>
            <dd>{formatPaise(subtotal)}</dd>
          </div>
          {discount > 0 ? (
            <div className={styles.totalRow}>
              <dt>{discountLabel}</dt>
              <dd>−{formatPaise(discount)}</dd>
            </div>
          ) : null}
          <div className={styles.totalRow}>
            <dt>Taxable Value</dt>
            <dd>{formatPaise(taxable)}</dd>
          </div>
          <div className={styles.totalRow}>
            <dt>{gstLabel}</dt>
            <dd>{formatPaise(gst)}</dd>
          </div>
          {otherCharges > 0 ? (
            <div className={styles.totalRow}>
              <dt>{doc.other_charges_label || 'Other Charges'}</dt>
              <dd>{formatPaise(otherCharges)}</dd>
            </div>
          ) : null}
          <div className={`${styles.totalRow} ${styles.totalGrand}`}>
            <dt>Grand Total</dt>
            <dd>{formatPaise(grandTotal)}</dd>
          </div>
          {/* §11: Amount Paid and Balance Due appear only on an invoice, and only
              once the money has actually been recorded. */}
          {isInvoice && paid > 0 ? (
            <div className={styles.totalRow}>
              <dt>Amount Paid</dt>
              <dd>−{formatPaise(paid)}</dd>
            </div>
          ) : null}
          {isInvoice ? (
            <div className={`${styles.totalRow} ${styles.totalBalance}`}>
              <dt>Balance Due</dt>
              <dd>{formatPaise(outstanding)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* 5b. Payment (§8.5).
       *
       * The **original invoice carries no amount-bearing QR**. That is a
       * deliberate reversal of the earlier decision on this sheet, and the
       * reason is the document's own nature: an invoice is a permanent financial
       * record, so anything derived from the payment ledger must not appear on
       * it. A QR encoding the outstanding balance would change the moment a
       * payment was recorded, which means reprinting the same invoice would ask a
       * customer for a different figure - the exact behaviour §8.4 exists to
       * prevent, and the one thing a tax document must never do.
       *
       * So the division of responsibility is:
       *   - this sheet: the payment *instructions* (UPI ID, bank details) and the
       *     current status. Static. Safe to reprint any time, forever.
       *   - the Balance / Payment Due document: the amount-bearing QR for what is
       *     still owed. Derived, never stored, regenerated per collection.
       *
       * The UPI ID and bank details are read live from Settings rather than the
       * snapshot for the reason above; a closed account must not stay on
       * issued documents. The *amounts* on this sheet are all the server's.
       */}
      {isInvoice && (showMethod || showUpi || bankRows.length > 0) ? (
        <section className={styles.payment} data-document-payment>
          <h2 className={styles.blockLabel}>Payment</h2>
          <div className={styles.paymentBody}>
            {showQr ? (
              <div className={styles.paymentQr}>
                <UpiQrCard
                  variant="print"
                  vpa={liveUpiId}
                  payeeName={payeeName}
                  amountPaise={doc.grand_total_paise}
                  note={number}
                />
              </div>
            ) : null}
            <div className={styles.paymentDetails}>
              {showMethod ? (
                <p className={styles.paymentMethodLine}>
                  <strong>Payment Method: {presentation.label}</strong>
                </p>
              ) : null}
              {/*
               * The UPI VPA and payee name are deliberately NOT repeated as rows
               * here. `UpiQrCard`'s print variant already prints the VPA as text
               * beneath the code — for a customer paying without a scanner — and
               * duplicating it would print the same address twice on a document
               * meant to be read once, carefully.
               */}
              {bankRows.length > 0 ? (
                <dl className={styles.paymentRows}>
                  {bankRows.map((line) => (
                    <div key={line.label} className={styles.paymentRow}>
                      <dt>{line.label}</dt>
                      <dd>{line.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {showUpi ? (
                <p className={styles.paymentHint}>
                  Scan to Pay. Please verify the amount before paying
                  {number ? `, and quote ${number}.` : '.'}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* 6. Terms — the document's own snapshot, not the current default (§8.4). */}
      {doc.terms_text ? (
        <section className={styles.terms} data-document-terms>
          <h2 className={styles.blockLabel}>Terms &amp; Conditions</h2>
          <TermsList text={doc.terms_text} />
        </section>
      ) : null}

      {/* 7. Signatory + 8. Footer. An invoice prints the signatory it snapshotted
          at conversion; a quotation has no snapshot and reads live Settings. */}
      <section className={styles.signatory} data-document-signatory>
        <p className={styles.signatoryLabel}>For {s.company_name || 'Ruchita Interiors'}</p>
        <p className={styles.signatoryName}>{signatory}</p>
        <div className={styles.signatureLine} aria-hidden="true" />
      </section>

      {s.footer_text ? <footer className={styles.footer}>{s.footer_text}</footer> : null}
    </article>
  )
}

/**
 * One category group: an optional subheader row, then its item rows.
 *
 * The `#` column counts across the whole document rather than restarting per
 * group, so a grouped quote is still readable line by line.
 */
function GroupRows({ group, startIndex }) {
  return (
    <>
      {group.category ? (
        <tr className={styles.categoryRow}>
          <td className={styles.colIndex} />
          <td className={styles.colCategory} colSpan={6}>
            {group.category}
          </td>
        </tr>
      ) : null}
      {group.items.map((item, offset) => (
        <ItemRow key={item.id ?? `${startIndex}-${offset}`} item={item} index={startIndex + offset + 1} />
      ))}
    </>
  )
}

function ItemRow({ item, index }) {
  const lineTotal = item.line_total_paise ?? calcLineTotal(item.qty_milli, item.rate_paise)
  return (
    <tr className={styles.itemRow}>
      <td className={`${styles.colIndex} ${styles.num}`}>{index}</td>
      {/* The category is carried by the group's subheader row, not repeated on
          every line: printing it twice would be noise on the page. The cell stays
          so the column widths and the totals alignment are unchanged. */}
      <td className={styles.colCategory}>{''}</td>
      <td className={styles.colItem}>
        <span className={styles.itemName}>{item.name}</span>
        {item.description ? <span className={styles.itemDescription}>{item.description}</span> : null}
      </td>
      <td className={styles.colUnit}>{item.unit || ''}</td>
      {/* Quantity only. The unit used to be repeated here as well as in its own
          column, which contradicted the 14.3 column spec and — because this cell
          is `white-space: nowrap` — made a two-word unit like "running ft" an
          unbreakable token wide enough to widen the whole table. */}
      <td className={`${styles.colNum} ${styles.num}`}>{milliToInput(item.qty_milli) || '0'}</td>
      <td className={`${styles.colNum} ${styles.num}`}>{formatPaise(item.rate_paise)}</td>
      <td className={`${styles.colNum} ${styles.num}`}>{formatPaise(lineTotal)}</td>
    </tr>
  )
}

/**
 * Render terms text as a numbered list.
 *
 * `terms_text` is plain text, not HTML (§8.3), so it is split on newlines and
 * rendered as list items. Non-empty lines only — a blank line in a textarea
 * should not become an empty numbered term.
 */
function TermsList({ text }) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  return (
    <ol className={styles.termList}>
      {lines.map((line, index) => (
        <li key={index} className={styles.termItem}>
          {line}
        </li>
      ))}
    </ol>
  )
}
