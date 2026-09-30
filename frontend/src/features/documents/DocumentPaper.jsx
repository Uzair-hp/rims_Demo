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
 *   qrSrc?: string | null,
 *   titleLevel?: 1 | 2,
 *   numberOverride?: string,
 *   isUnsaved?: boolean,
 * }} props
 */

import { useState } from 'react'
import { calcLineTotal, milliToInput } from '../../lib/calc.js'
import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import Icon from '../../components/ui/Icon.jsx'
import styles from './DocumentPaper.module.css'

/**
 * The official brand lockup shipped in `public/brand/`, used when Settings has no
 * uploaded logo.
 */
const BUNDLED_LOGO = '/brand/logo.svg'

/** Join the non-empty parts of an address into a single printable line. */
function joinAddress(...parts) {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(', ')
}

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
  qrSrc = null,
  titleLevel: TitleLevel = 'h1',
  numberOverride = null,
  isUnsaved = false,
  docKind = 'quotation',
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  const logoSrcResolved = logoSrc || BUNDLED_LOGO
  const showLogo = !logoFailed

  const [qrFailed, setQrFailed] = useState(false)
  const showQr = Boolean(qrSrc) && !qrFailed

  const isInvoice = docKind === 'invoice'
  const title = isInvoice ? 'Tax Invoice' : 'Quotation'
  const documentLabel = isInvoice ? 'Invoice document' : 'Quotation document'

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

  const paid = doc.paid_paise || 0
  const outstanding = doc.outstanding_paise ?? Math.max(0, grandTotal - paid)

  const companyAddress = joinAddress(
    s.address_line1,
    s.address_line2,
    joinAddress(s.city, s.state, s.pincode),
  ) || 'local adderss, no adderss, mumbai, maharashtra, 402822'

  const clientAddress = joinAddress(client.address, client.city, client.state, client.pincode)

  const bank = doc.bank_snapshot || null
  const signatory = doc.signatory_name || s.signatory_name || 'Authorised Signatory'
  const bankLines = bank
    ? [
        bank.account_name && { label: 'Account name', value: bank.account_name },
        bank.account_number && { label: 'Account number', value: bank.account_number },
        bank.bank_name && { label: 'Bank', value: bank.bank_name },
        bank.branch && { label: 'Branch', value: bank.branch },
        bank.ifsc && { label: 'IFSC', value: bank.ifsc },
        bank.upi_id && { label: 'UPI ID', value: bank.upi_id },
      ].filter(Boolean)
    : []

  return (
    <article className={styles.paper} data-document-paper aria-label={documentLabel}>
      {/* 1. Header band */}
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
            <span className={styles.wordmark}>{s.company_name || 'Ruchita Interiors'}</span>
          )}
          {showLogo ? <p className={styles.companyName}>{s.company_name || 'Ruchita Interiors'}</p> : null}
          <p className={styles.tagline}>{s.tagline || 'all time greate'}</p>
        </div>

        <div className={styles.company}>
          <address className={styles.companyMeta}>
            {companyAddress ? (
              <span className={styles.metaLine}>
                <Icon name="mapPin" size={13} className={styles.metaIcon} />
                <span>{companyAddress}</span>
              </span>
            ) : null}
            {s.phone ? (
              <span className={styles.metaLine}>
                <Icon name="phone" size={13} className={styles.metaIcon} />
                <span>{s.phone}</span>
              </span>
            ) : null}
            {s.email ? (
              <span className={styles.metaLine}>
                <Icon name="mail" size={13} className={styles.metaIcon} />
                <span>{s.email}</span>
              </span>
            ) : null}
            {s.website ? (
              <span className={styles.metaLine}>
                <Icon name="globe" size={13} className={styles.metaIcon} />
                <span>{s.website}</span>
              </span>
            ) : null}
            {s.gstin ? (
              <span className={`${styles.metaLine} ${styles.gstin}`}>
                <Icon name="building" size={13} className={styles.metaIcon} />
                <span>GSTIN: {s.gstin}</span>
              </span>
            ) : null}
          </address>
        </div>
      </header>

      {/* 2. Title strip */}
      <div className={styles.titleStrip}>
        <div className={styles.dates}>
          <p className={styles.dateLine}>
            <Icon name="calendar" size={13} className={styles.labelIcon} />
            <span className={styles.microLabel}>{isInvoice ? 'Issue date' : 'Date'}</span>
            <span className={styles.dateValue}>
              {formatDate(isInvoice ? doc.issue_date : doc.quotation_date) || '—'}
            </span>
          </p>
          <p className={styles.dateLine}>
            <Icon name="calendar" size={13} className={styles.labelIcon} />
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

      {/* 3. Client block */}
      <section className={styles.clientBlock}>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>
            <Icon name="user" size={13} className={styles.labelIcon} />
            <span>Bill To</span>
          </h2>
          <p className={styles.clientName}>{client.name || '—'}</p>
          {clientAddress ? (
            <p className={styles.clientLine}>
              <Icon name="mapPin" size={12} className={styles.inlineIcon} />
              <span>{clientAddress}</span>
            </p>
          ) : null}
          {client.phone ? (
            <p className={styles.clientLine}>
              <Icon name="phone" size={12} className={styles.inlineIcon} />
              <span>{client.phone}</span>
            </p>
          ) : null}
          {client.email ? (
            <p className={styles.clientLine}>
              <Icon name="mail" size={12} className={styles.inlineIcon} />
              <span>{client.email}</span>
            </p>
          ) : null}
          {client.gstin ? (
            <p className={styles.clientLine}>
              <Icon name="building" size={12} className={styles.inlineIcon} />
              <span>GSTIN: {client.gstin}</span>
            </p>
          ) : null}
        </div>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>
            <Icon name="mapPin" size={13} className={styles.labelIcon} />
            <span>Project / Site Address</span>
          </h2>
          {client.project_address ? (
            <p className={styles.clientLine}>
              <Icon name="mapPin" size={12} className={styles.inlineIcon} />
              <span>{client.project_address}</span>
            </p>
          ) : (
            <p className={styles.clientLine}>—</p>
          )}
        </div>
      </section>

      {/* 4. Items table */}
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

      {/* 5. Totals block */}
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

      {/* 6. Payment details & QR code */}
      {isInvoice && (bankLines.length > 0 || showQr) ? (
        <section className={styles.bank} data-document-bank>
          <div className={styles.bankHeader}>
            <h2 className={styles.blockLabel}>
              <Icon name="wallet" size={13} className={styles.labelIcon} />
              <span>Payment Details</span>
            </h2>
            {showQr ? (
              <div className={styles.bankQrHeader}>
                <Icon name="qrCode" size={13} className={styles.labelIcon} />
                <span>Scan to Pay</span>
              </div>
            ) : null}
          </div>
          <div className={styles.bankBody}>
            {bankLines.length > 0 ? (
              <dl className={styles.bankRows}>
                {bankLines.map((line) => (
                  <div key={line.label} className={styles.bankRow}>
                    <dt>{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className={styles.bankPlaceholder} />
            )}

            {showQr ? (
              <div className={styles.bankQr} data-document-qr>
                <h3 className={styles.bankQrLabel}>UPI QR code</h3>
                <img
                  className={styles.bankQrImage}
                  src={qrSrc}
                  alt="UPI payment QR code"
                  onError={() => setQrFailed(true)}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 7. Terms & Conditions */}
      {doc.terms_text ? (
        <section className={styles.terms} data-document-terms>
          <h2 className={styles.blockLabel}>
            <Icon name="fileText" size={13} className={styles.labelIcon} />
            <span>Terms &amp; Conditions</span>
          </h2>
          <TermsList text={doc.terms_text} />
        </section>
      ) : null}

      {/* 8. Signatory */}
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
