/**
 * Ruchita Interiors — shared document header (§14.3).
 *
 * One header, mounted by **both** printed documents: the quotation / tax invoice
 * (`DocumentPaper`) and the Balance / Payment Due notice (`PaymentDuePaper`). They were
 * previously separate implementations, and they had already drifted — the balance sheet
 * had no tagline, no email, no website, no GSTIN and no icons at all, so a customer holding
 * a tax invoice and a payment reminder for it was looking at two different letterheads.
 * A component is the fix; a CSS tweak on one of them would only re-open the gap.
 *
 * Layout, which is the point of the whole file:
 *
 * - **Left**: the mark, the business name, then the tagline. The name is the largest type
 *   on the sheet and the tagline sits under it, because it describes the business rather
 *   than any one address.
 * - **Right**: the contact block, a vertical list where every row is `[icon] [text]`.
 *
 * The contact list is a **grid** (`auto 1fr`) rather than a stack of flex rows. In a flex
 * row the text is one anonymous item, so a long address wraps inside its own box and
 * happens to line up — until a row with a short value sets a narrower baseline and the
 * icons drift out of their column. A grid gives every row one icon column and one text
 * column by construction, which is what "icons in one aligned column" means.
 *
 * Icons inherit `currentColor` and carry no brand colour of their own (§18.4); the gold
 * here is the *ink* gold, chosen so a header icon still passes AA against white paper.
 * `overflow-wrap: anywhere` on the text cell is what makes a long address wrap under the
 * text instead of pushing the row wider than the page box.
 *
 * Presentational: it fetches nothing and holds no document state.
 *
 * @param {{
 *   settings?: object | null,
 *   logoSrc?: string | null,
 * }} props
 */

import { useState } from 'react'
import Icon from '../../components/ui/Icon.jsx'
import styles from './DocumentHeader.module.css'

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

export default function DocumentHeader({ settings = null, logoSrc = null }) {
  const s = settings || {}
  const [logoFailed, setLogoFailed] = useState(false)
  const logoSrcResolved = logoSrc || BUNDLED_LOGO
  const showLogo = !logoFailed

  const companyAddress = joinAddress(
    s.address_line1,
    s.address_line2,
    joinAddress(s.city, s.state, s.pincode),
  )

  const contact = [
    { key: 'address', icon: 'mapPin', text: companyAddress },
    { key: 'phone', icon: 'phone', text: s.phone },
    { key: 'email', icon: 'mail', text: s.email },
    { key: 'website', icon: 'globe', text: s.website },
    // The GSTIN is a registration number, not an office address, so it gets the seal
    // rather than the building glyph used on the client's own address.
    { key: 'gstin', icon: 'badgeCheck', text: s.gstin ? `GSTIN: ${s.gstin}` : '' },
  ].filter((row) => row.text)

  return (
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
        {/* Sits under the business name rather than in the contact column: it describes
            the business, not the address. No fallback — an unset tagline is an absence,
            and printing placeholder copy on a customer's tax document is worse than
            printing nothing. */}
        {s.tagline ? <p className={styles.tagline}>{s.tagline}</p> : null}
      </div>

      <div className={styles.company}>
        <address className={styles.companyMeta} aria-label={`${s.company_name || 'Company'} contact details`}>
          {contact.map((row) => (
            <span key={row.key} className={styles.metaLine}>
              <Icon name={row.icon} size={15} strokeWidth={1.5} className={styles.metaIcon} />
              <span className={styles.metaText}>{row.text}</span>
            </span>
          ))}
        </address>
      </div>
    </header>
  )
}

export { joinAddress }
