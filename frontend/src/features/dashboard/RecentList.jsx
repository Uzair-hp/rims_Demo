import { Link } from 'react-router-dom'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { invoiceStatusLabel, paymentStatusLabel } from '../../features/invoices/status.js'
import { statusLabel } from '../quotations/status.js'
import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import styles from './RecentList.module.css'

/**
 * One of the three FR-D2 recent lists.
 *
 * All three are the same shape — a heading, a "view all" link, and at most five
 * rows that link to a detail page — so they share this component rather than
 * each getting its own. The server already capped each list at five and ordered
 * them newest first; nothing here re-sorts or re-counts.
 *
 * Below 768 px each row stacks (primary / secondary / tertiary lines, S19) so a
 * number, a client and three money figures never have to share one squeezed
 * table row.
 */

/** Money is right-aligned and tabular on desktop, stacked and full-width on mobile. */
function Money({ paise, tone }) {
  return <span className={`${styles.money} ${tone ? styles[tone] : ''}`}>{formatPaise(paise)}</span>
}

function QuotationRow({ row }) {
  return (
    <li className={styles.row}>
      <div className={styles.primary}>
        <Link className={styles.link} to={`/quotations/${row.id}`}>
          {row.number}
        </Link>
        <StatusBadge status={row.status}>{statusLabel(row.status)}</StatusBadge>
      </div>
      <div className={styles.secondary}>
        <span className={styles.client}>{row.client_name}</span>
        <span className={styles.date}>{formatDate(row.date)}</span>
        <Money paise={row.grand_total_paise} />
      </div>
    </li>
  )
}

function InvoiceRow({ row }) {
  return (
    <li className={styles.row}>
      <div className={styles.primary}>
        <Link className={styles.link} to={`/invoices/${row.id}`}>
          {row.number}
        </Link>
        {/* Payment status, not lifecycle status: the figure a reader wants from
            an invoice row is whether it is paid (§13.3). */}
        <StatusBadge status={row.payment_status}>{paymentStatusLabel(row.payment_status)}</StatusBadge>
      </div>
      <div className={styles.secondary}>
        <span className={styles.client}>{row.client_name}</span>
        <span className={styles.date}>{formatDate(row.date)}</span>
        <Money paise={row.grand_total_paise} />
        <Money paise={row.outstanding_paise} tone={row.outstanding_paise > 0 ? 'due' : ''} />
      </div>
      <span className={styles.lifecycle}>{invoiceStatusLabel(row.status)}</span>
    </li>
  )
}

function ClientRow({ row }) {
  return (
    <li className={styles.row}>
      <div className={styles.primary}>
        <Link className={styles.link} to={`/clients/${row.id}`}>
          {row.name}
        </Link>
      </div>
      <div className={styles.secondary}>
        {row.phone ? <span className={styles.client}>{row.phone}</span> : null}
        <span className={styles.date}>{formatDate(row.created_at)}</span>
      </div>
    </li>
  )
}

const KINDS = {
  quotations: {
    rows: QuotationRow,
    empty: 'No quotations yet.',
    to: '/quotations',
    allLabel: 'All quotations',
  },
  invoices: { rows: InvoiceRow, empty: 'No invoices yet.', to: '/invoices', allLabel: 'All invoices' },
  clients: { rows: ClientRow, empty: 'No clients yet.', to: '/clients', allLabel: 'All clients' },
}

export default function RecentList({ kind, rows, title }) {
  const config = KINDS[kind]
  if (!config) return null
  const Row = config.rows

  return (
    <section className={styles.list} aria-labelledby={`recent-${kind}`}>
      <div className={styles.head}>
        <h2 className={styles.title} id={`recent-${kind}`}>
          {title}
        </h2>
        <Link className={styles.all} to={config.to}>
          {config.allLabel}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>{config.empty}</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
