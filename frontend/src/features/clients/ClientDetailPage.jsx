/**
 * Ruchita Interiors — client detail page (§9.2).
 *
 * Profile card, totals strip, and sections for Quotations, Invoices and
 * Payments. Archived clients show a Restore action. Empty sections render
 * inline-safe messages rather than crashing.
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { archiveClient, restoreClient, fetchClient, fetchClientSummary } from '../../api/endpoints/clients.js'
import ClientFormModal from './ClientFormModal.jsx'
import { formatPaise } from '../../lib/money.js'
import { useClients } from './useClients.js'
import styles from './ClientDetailPage.module.css'

export default function ClientDetailPage() {
  const { id } = useParams()
  const { refetch } = useClients()
  const [client, setClient] = useState(null)
  const [summary, setSummary] = useState(null)
  const [status, setStatus] = useState('loading')
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([fetchClient(id), fetchClientSummary(id)])
      .then(([c, s]) => {
        if (cancelled) return
        setClient(c)
        setSummary(s)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [id])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleArchive = async () => {
    if (!archiveTarget) return
    try {
      await archiveClient(archiveTarget.id)
      setArchiveTarget(null)
      refetch()
    } catch {
      /* ignore */
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    try {
      await restoreClient(restoreTarget.id)
      setRestoreTarget(null)
      refetch()
    } catch {
      /* ignore */
    }
  }

  const handleSaved = (saved) => {
    setClient(saved)
    setFormOpen(false)
    setEditing(null)
    refetch()
  }

  const loading = status === 'loading'
  const isError = status === 'error'

  if (isError) {
    return (
      <div className={styles.page}>
        <PageHeader title="Client" description="Could not be loaded." />
        <p className={styles.message} role="alert">
          Client could not be loaded.
        </p>
      </div>
    )
  }

  if (loading || !client) {
    return (
      <div className={styles.page}>
        <PageHeader title="Client" description="Loading..." />
        <div
          style={{ height: '3.5rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)' }}
        />
      </div>
    )
  }

  const s = summary || {
    total_quotations_value: 0,
    total_invoices_value: 0,
    total_payments_value: 0,
    quotations_count: 0,
    invoices_count: 0,
    payments_count: 0,
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={client.name}
        description="Client profile with contact details and linked documents."
      />
      <div className={styles.profile}>
        <div className={styles.profileInfo}>
          <h1 className={styles.profileName}>{client.name}</h1>
          <div className={styles.profileMeta}>
            {client.phone ? (
              <span className={styles.metaItem}>
                <Icon name="phone" size={16} /> {client.phone}
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
          {client.gstin ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-ink-muted)', margin: 0 }}>
              GSTIN: {client.gstin}
            </p>
          ) : null}
          {client.notes ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-ink-muted)', margin: 0 }}>
              {client.notes}
            </p>
          ) : null}
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

      {client.is_archived ? null : (
        <div className={styles.totals}>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Quotations</p>
            <p className={styles.totalValue}>{s.quotations_count}</p>
          </Card>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Quotation value</p>
            <p className={styles.totalValue}>{formatPaise(s.total_quotations_value)}</p>
          </Card>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Invoices</p>
            <p className={styles.totalValue}>{s.invoices_count}</p>
          </Card>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Invoice value</p>
            <p className={styles.totalValue}>{formatPaise(s.total_invoices_value)}</p>
          </Card>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Payments</p>
            <p className={styles.totalValue}>{s.payments_count}</p>
          </Card>
          <Card className={styles.totalCard}>
            <p className={styles.totalLabel}>Paid</p>
            <p className={styles.totalValue}>{formatPaise(s.total_payments_value)}</p>
          </Card>
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Quotations</h2>
        {s.quotations_count === 0 ? (
          <p className={styles.emptyList}>
            No quotations yet.{' '}
            <Link to={`/quotations/new?client=${client.id}`} className={styles.link}>
              Create one
            </Link>
            .
          </p>
        ) : (
          <p className={styles.emptyList}>
            {s.quotations_count} quotation(s) — linked documents appear here.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Invoices</h2>
        {s.invoices_count === 0 ? (
          // Invoices cannot be created from here: an invoice only exists by
          // converting an approved quotation (FR-I1), so the honest destination
          // is this client's quotations, where the conversion action lives.
          <p className={styles.emptyList}>
            No invoices yet. Invoices are created from an approved quotation —{' '}
            <Link to="/quotations" className={styles.link}>
              see this client&rsquo;s quotations
            </Link>
            .
          </p>
        ) : (
          <p className={styles.emptyList}>{s.invoices_count} invoice(s) — linked documents appear here.</p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Payments</h2>
        {s.payments_count === 0 ? (
          <p className={styles.emptyList}>No payments recorded yet.</p>
        ) : (
          <p className={styles.emptyList}>{s.payments_count} payment(s) recorded.</p>
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
