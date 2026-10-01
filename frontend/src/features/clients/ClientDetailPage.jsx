/**
 * Ruchita Interiors — client detail page (§9.2, FR-C3).
 *
 * Profile card, a billed / received / outstanding strip, and the three
 * relationship sections FR-C3 asks for: Quotations, Invoices and Payments.
 * Archived clients show a Restore action and keep their full history — archiving
 * hides a client from lists and pickers, it does not erase what they owe (FR-C4).
 *
 * **The summary payload is the server's contract, read literally.**
 * `GET /clients/:id/summary` returns
 * `{ client, quotations[], invoices[], payments[], totals: { billed_paise,
 * received_paise, outstanding_paise } }` (`services/clients.py`). The page used to
 * read `quotations_count` / `total_invoices_value` / `total_payments_value`, none
 * of which the API has ever sent: every figure rendered as `₹0.00` and every
 * section as a placeholder, while the data sat unused in `summary`. Keys are
 * therefore read exactly as the service writes them, and no money figure is
 * recomputed here — `paid_paise` / `outstanding_paise` / `payment_status` are
 * derived on the server (§11, D2), so an invoice page and this page can never
 * disagree.
 *
 * Everything is keyed off the `id` in the route, never the client's name, so two
 * clients with similar names cannot borrow each other's rows. Changing clients
 * clears the previous client's data before the next fetch, so nothing stale is
 * ever on screen (FR-C3, FR-C4).
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { archiveClient, restoreClient, fetchClient, fetchClientSummary } from '../../api/endpoints/clients.js'
import ClientFormModal from './ClientFormModal.jsx'
import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import { formatPhone } from '../../lib/phone.js'
import { statusLabel } from '../quotations/status.js'
import { PAYMENT_METHOD_LABELS, paymentStatusLabel } from '../invoices/status.js'
import styles from './ClientDetailPage.module.css'

/** The three money figures, read from the server's own totals (§11). */
function SummaryTotals({ totals }) {
  const billed = totals.billed_paise ?? 0
  const received = totals.received_paise ?? 0
  const outstanding = totals.outstanding_paise ?? 0

  return (
    <div className={styles.totals}>
      <Card className={styles.totalCard}>
        <p className={styles.totalLabel}>Billed</p>
        <p className={styles.totalValue}>{formatPaise(billed)}</p>
      </Card>
      <Card className={styles.totalCard}>
        <p className={styles.totalLabel}>Received</p>
        <p className={styles.totalValue}>{formatPaise(received)}</p>
      </Card>
      <Card className={`${styles.totalCard} ${outstanding > 0 ? styles.totalDue : ''}`}>
        <p className={styles.totalLabel}>Outstanding</p>
        <p className={styles.totalValue}>{formatPaise(outstanding)}</p>
      </Card>
    </div>
  )
}

/**
 * A related-record row: identity on the left, money and status on the right.
 * The whole row is one link to the document, matching the list rows on the
 * Invoices and Quotations pages.
 */
function RecordRow({ to, number, date, secondary, total, due, badge, badgeStatus }) {
  return (
    <li>
      <Card as="article" interactive>
        <Link to={to} className={styles.row}>
          <div className={styles.summary}>
            <span className={styles.number}>{number}</span>
            <span className={styles.date}>{date}</span>
            {secondary ? <span className={styles.meta}>{secondary}</span> : null}
          </div>
          <div className={styles.rowMeta}>
            <span className={styles.total}>{formatPaise(total)}</span>
            {due > 0 ? <span className={styles.outstanding}>{formatPaise(due)} due</span> : null}
            {badge ? <StatusBadge status={badgeStatus}>{badge}</StatusBadge> : null}
          </div>
        </Link>
      </Card>
    </li>
  )
}

/** Placeholder list of shimmer rows, so an empty section keeps its shape. */
function RowSkeletons({ rows = 3 }) {
  return (
    <ul className={styles.list}>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i}>
          <Skeleton height="3.75rem" />
        </li>
      ))}
    </ul>
  )
}

export default function ClientDetailPage() {
  const { id } = useParams()
  const [client, setClient] = useState(null)
  const [summary, setSummary] = useState(null)
  const [status, setStatus] = useState('loading')
  const [summaryError, setSummaryError] = useState(false)
  const [reload, setReload] = useState(0)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false

    // Cleared up front, not left to be overwritten: switching from one client to
    // another must never leave the previous client's totals on screen while the
    // next request is in flight.
    setClient(null)
    setSummary(null)
    setSummaryError(false)
    setStatus('loading')

    // The profile and the relationship history are independent requests, so a
    // failure of one does not blank the other. `Promise.allSettled` rather than
    // `all`: losing the history should degrade the three sections, not throw away
    // a client that loaded fine.
    Promise.allSettled([fetchClient(id), fetchClientSummary(id)]).then(([clientResult, summaryResult]) => {
      if (cancelled) return

      if (clientResult.status === 'rejected') {
        setStatus('error')
        return
      }
      setClient(clientResult.value)
      setStatus('ready')

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value)
      } else {
        setSummaryError(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [id, reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const reloadData = useCallback(() => setReload((n) => n + 1), [])

  const handleArchive = async () => {
    if (!archiveTarget) return
    try {
      await archiveClient(archiveTarget.id)
      setArchiveTarget(null)
      // The archive flag and the "Restore" affordance both live on the profile,
      // so this page re-reads rather than patching one field locally.
      reloadData()
    } catch {
      /* ignore */
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    try {
      await restoreClient(restoreTarget.id)
      setRestoreTarget(null)
      reloadData()
    } catch {
      /* ignore */
    }
  }

  const handleSaved = () => {
    setFormOpen(false)
    setEditing(null)
    // Re-read rather than adopting the saved client: an edit can change nothing
    // about the documents, but it can change the name shown on every row, and the
    // server owns that snapshot.
    reloadData()
  }

  // Only a rejected request is an error. `!client` while still loading is a
  // pending fetch, not a failure, and must not be collapsed into one.
  if (status === 'error' || (!client && status !== 'loading')) {
    return (
      <div className={styles.page}>
        <PageHeader title="Client" description="Could not be loaded." />
        <p className={styles.message} role="alert">
          This client could not be loaded.{' '}
          <Link to="/clients" className={styles.link}>
            Back to clients
          </Link>
          .
        </p>
      </div>
    )
  }

  // Read the server's shape exactly as `client_summary` writes it. The fallbacks
  // keep a partial payload from throwing mid-render; they are not a source of
  // data, and `undefined` money is never formatted as a real ₹0 figure.
  const quotations = summary?.quotations ?? []
  const invoices = summary?.invoices ?? []
  const payments = summary?.payments ?? []
  const totals = summary?.totals ?? { billed_paise: 0, received_paise: 0, outstanding_paise: 0 }
  const loading = status === 'loading'

  return (
    <div className={styles.page}>
      <PageHeader
        title={client?.name || 'Client'}
        description="Client profile with contact details and linked documents."
      />

      {loading ? (
        <Skeleton height="7rem" />
      ) : (
        <div className={styles.profile}>
          <div className={styles.profileInfo}>
            {/* Not an `<h1>`: `PageHeader` already carries the page's single h1
                (§18.2), and two of them is an outline and screen-reader defect. */}
            <h2 className={styles.profileName}>{client.name}</h2>
            <div className={styles.profileMeta}>
              {client.phone ? (
                <span className={styles.metaItem}>
                  <Icon name="phone" size={16} /> {formatPhone(client.phone)}
                </span>
              ) : null}
              {client.email ? (
                <span className={styles.metaItem}>
                  <Icon name="mail" size={16} /> {client.email}
                </span>
              ) : null}
              {client.address ? (
                <span className={styles.metaItem}>
                  <Icon name="mapPin" size={16} /> {client.address}
                </span>
              ) : null}
            </div>
            {client.project_address ? (
              <p className={styles.profileNote}>Project site: {client.project_address}</p>
            ) : null}
            {client.gstin ? <p className={styles.profileNote}>GSTIN: {client.gstin}</p> : null}
            {client.notes ? <p className={styles.profileNote}>{client.notes}</p> : null}
          </div>
          <div className={styles.profileActions}>
            {client.is_archived ? (
              <>
                <Button size="sm" variant="primary" icon="rotateCw" onClick={() => setRestoreTarget(client)}>
                  Restore
                </Button>
                <StatusBadge archived className={styles.archivedBadge}>
                  Archived
                </StatusBadge>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="edit"
                  onClick={() => {
                    setEditing(client)
                    setFormOpen(true)
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon="archive" onClick={() => setArchiveTarget(client)}>
                  Archive
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {summaryError ? (
        <p className={styles.message} role="alert">
          This client&rsquo;s document history could not be loaded.
        </p>
      ) : null}

      <SummaryTotals totals={totals} />

      {!loading && !summaryError ? (
        <p className={styles.counts}>
          {quotations.length} quotation{quotations.length === 1 ? '' : 's'} · {invoices.length} invoice
          {invoices.length === 1 ? '' : 's'} · {payments.length} payment{payments.length === 1 ? '' : 's'}
        </p>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Quotations</h2>
        {loading ? (
          <RowSkeletons />
        ) : quotations.length === 0 ? (
          <EmptyState
            icon="fileText"
            tone="muted"
            title="No quotations yet"
            message="Create a priced estimate for this client and it will be listed here."
            actionLabel="New quotation"
            actionIcon="plus"
            actionTo={`/quotations/new?client=${client.id}`}
          />
        ) : (
          <ul className={styles.list}>
            {quotations.map((quotation) => (
              <RecordRow
                key={quotation.id}
                to={`/quotations/${quotation.id}`}
                number={quotation.number || `Quotation #${quotation.id}`}
                date={quotation.quotation_date ? `Quoted ${formatDate(quotation.quotation_date)}` : 'No date'}
                secondary={quotation.valid_until ? `Valid until ${formatDate(quotation.valid_until)}` : null}
                total={quotation.grand_total_paise}
                badge={statusLabel(quotation.status)}
                badgeStatus={quotation.status}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Invoices</h2>
        {loading ? (
          <RowSkeletons />
        ) : invoices.length === 0 ? (
          // Invoices cannot be created from here: an invoice only exists by
          // converting an approved quotation (FR-I1), so the honest destination
          // is this client's quotations, where the conversion action lives.
          <EmptyState
            icon="receipt"
            tone="muted"
            title="No invoices yet"
            message="Invoices are created from an approved quotation, so the next step is an approved one here."
            actionLabel="Go to quotations"
            actionIcon="fileText"
            actionTo="/quotations"
          />
        ) : (
          <ul className={styles.list}>
            {invoices.map((invoice) => (
              <RecordRow
                key={invoice.id}
                to={`/invoices/${invoice.id}`}
                number={invoice.number || `Invoice #${invoice.id}`}
                date={
                  invoice.issue_date
                    ? `Issued ${formatDate(invoice.issue_date)}${
                        invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''
                      }`
                    : 'Not issued'
                }
                total={invoice.grand_total_paise}
                due={invoice.outstanding_paise}
                badge={paymentStatusLabel(invoice.payment_status)}
                badgeStatus={invoice.payment_status}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Payments</h2>
        {loading ? (
          <RowSkeletons />
        ) : payments.length === 0 ? (
          <EmptyState
            icon="wallet"
            tone="muted"
            title="No payments recorded"
            message="Payments are recorded against an issued invoice, from the invoice itself."
            actionLabel="Go to invoices"
            actionIcon="receipt"
            actionTo="/invoices"
          />
        ) : (
          <ul className={styles.list}>
            {payments.map((payment) => (
              <RecordRow
                key={payment.id}
                to={`/invoices/${payment.invoice_id}`}
                number={
                  payment.invoice_number
                    ? `Payment against ${payment.invoice_number}`
                    : `Payment #${payment.id}`
                }
                date={payment.paid_on ? `Paid ${formatDate(payment.paid_on)}` : 'No date'}
                secondary={[PAYMENT_METHOD_LABELS[payment.method] || payment.method, payment.reference]
                  .filter(Boolean)
                  .join(' · ')}
                total={payment.amount_paise}
              />
            ))}
          </ul>
        )}
      </section>

      <ClientFormModal
        open={formOpen}
        mode={editing ? 'edit' : 'create'}
        client={editing}
        onSaved={handleSaved}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive client?"
        message="Archived clients are hidden from lists and pickers, but their quotations and invoices keep their history."
        confirmLabel="Archive"
        danger
        onConfirm={handleArchive}
        onClose={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore client?"
        message="This client will reappear in lists and pickers."
        confirmLabel="Restore"
        onConfirm={handleRestore}
        onClose={() => setRestoreTarget(null)}
      />
    </div>
  )
}
