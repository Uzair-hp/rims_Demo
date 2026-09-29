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
import styles from './DocumentPaper.module.css'

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
}) {
  // §21.23: a missing or broken logo falls back to a typographic wordmark rather
  // than leaving an empty brand slot. Tracked locally so an upload that fails to
  // load degrades the same way as "no logo at all".
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = Boolean(logoSrc) && !logoFailed

  const s = settings || {}
  const number = numberOverride || doc.number || ''
  const client = doc.client_snapshot || {}
  const items = doc.items || []

  const subtotal = doc.subtotal_paise || 0
  const discount = doc.discount_paise || 0
  const gst = doc.gst_paise || 0
  const otherCharges = doc.other_charges_paise || 0
  const grandTotal = doc.grand_total_paise || 0
  const taxable = subtotal - discount
  const isPercentDiscount = (doc.discount_type || 'percent') === 'percent'
  const discountLabel = isPercentDiscount ? `Discount (${(doc.discount_bp || 0) / 100}%)` : 'Discount'
  const gstLabel = `GST ${(doc.gst_bp || 0) / 100}%`

  const companyAddress = joinAddress(
    s.address_line1,
    s.address_line2,
    joinAddress(s.city, s.state, s.pincode),
  )
  const clientAddress = joinAddress(client.address, client.city, client.state, client.pincode)

  return (
    <article className={styles.paper} data-document-paper aria-label="Quotation document">
      {/* 1. Header band: brand left, company contact right, gold rule beneath (§14.3). */}
      <header className={styles.header}>
        <div className={styles.brand}>
          {showLogo ? (
            <img
              src={logoSrc}
              alt={`${s.company_name || 'Company'} logo`}
              className={styles.logo}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            // Wordmark fallback (§21.23): the brand serif, never a bare gold fill
            // on a light surface — that is the contrast case §18.4 forbids.
            <span className={styles.wordmark}>{s.company_name || 'Ruchita Interiors'}</span>
          )}
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
            <span className={styles.microLabel}>Date</span>
            <span className={styles.dateValue}>{formatDate(doc.quotation_date) || '—'}</span>
          </p>
          <p className={styles.dateLine}>
            <span className={styles.microLabel}>Valid until</span>
            <span className={styles.dateValue}>{formatDate(doc.valid_until) || '—'}</span>
          </p>
        </div>
        <div className={styles.heading}>
          <TitleLevel className={styles.docTitle}>Quotation</TitleLevel>
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
        </dl>
      </section>

      {/* 6. Terms — the quotation's own snapshot, not the current default (§8.4). */}
      {doc.terms_text ? (
        <section className={styles.terms} data-document-terms>
          <h2 className={styles.blockLabel}>Terms &amp; Conditions</h2>
          <TermsList text={doc.terms_text} />
        </section>
      ) : null}

      {/* 7. Signatory + 8. Footer, both read live from Settings (§15). */}
      <section className={styles.signatory} data-document-signatory>
        <p className={styles.signatoryLabel}>For {s.company_name || 'Ruchita Interiors'}</p>
        <p className={styles.signatoryName}>{s.signatory_name || 'Authorised Signatory'}</p>
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
      <td className={`${styles.colNum} ${styles.num}`}>
        {milliToInput(item.qty_milli) || '0'}
        {item.unit ? <span className={styles.unitSuffix}> {item.unit}</span> : null}
      </td>
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
