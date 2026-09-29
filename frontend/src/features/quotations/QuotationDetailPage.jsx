/**
 * Ruchita Interiors — quotation detail page (§13, §18.5).
 *
 * Read-only view of a single quotation: header actions driven entirely by the
 * server's `allowed_actions`, the line-item table, the totals breakdown, and the
 * client + status summary. Destructive actions confirm first (§20). Lifecycle
 * calls return the refreshed quotation, so the view updates without a reload.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import QuotationPreview from '../documents/QuotationPreview.jsx'
import { useSettings } from '../settings/SettingsProvider.jsx'
import {
  changeQuotationStatus,
  convertQuotationToInvoice,
  deleteQuotation,
  duplicateQuotation,
  fetchQuotation,
} from '../../api/endpoints/quotations.js'
import { calcLineTotal } from '../../lib/calc.js'
import { formatPaise } from '../../lib/money.js'
import TotalsPanel from './TotalsPanel.jsx'
import { ACTION_META, statusLabel } from './status.js'
import styles from './QuotationDetailPage.module.css'

const STATUS_ACTIONS = new Set(['send', 'approve', 'reject', 'reopen'])

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function QuotationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { settings, logoSrc } = useSettings()

  const [quotation, setQuotation] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    fetchQuotation(id)
      .then((q) => {
        if (cancelled) return
        setQuotation(q)
        setLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [id])
  /* eslint-enable react-hooks/set-state-in-effect */

  const runAction = async (action) => {
    setActionError(null)
    setBusy(action)
    try {
      if (STATUS_ACTIONS.has(action)) {
        const updated = await changeQuotationStatus(id, action)
        setQuotation(updated)
      } else if (action === 'duplicate') {
        const copy = await duplicateQuotation(id)
        navigate(`/quotations/${copy.id}/edit`)
      } else if (action === 'create_invoice') {
        const invoice = await convertQuotationToInvoice(id)
        navigate(`/invoices/${invoice.id}`)
      } else if (action === 'delete') {
        await deleteQuotation(id)
        navigate('/quotations')
      }
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(null)
    }
  }

  if (loadState === 'loading') {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Quotations" title="Quotation" />
        <Skeleton height="16rem" />
      </div>
    )
  }

  if (loadState === 'error' || !quotation) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Quotations" title="Quotation" />
        <p className={styles.message} role="alert">
          This quotation could not be loaded.{' '}
          <Link to="/quotations" className={styles.link}>
            Back to quotations
          </Link>
          .
        </p>
      </div>
    )
  }

  const q = quotation
  const allowed = q.allowed_actions || []
  const canEdit = q.status === 'draft' || q.status === 'sent'
  const totals = {
    subtotalPaise: q.subtotal_paise || 0,
    discountPaise: q.discount_paise || 0,
    taxablePaise: (q.subtotal_paise || 0) - (q.discount_paise || 0),
    gstPaise: q.gst_paise || 0,
    otherChargesPaise: q.other_charges_paise || 0,
    grandTotalPaise: q.grand_total_paise || 0,
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Quotations"
        title={q.number || `Quotation #${q.id}`}
        description={`For ${q.client_snapshot?.name || 'client'} · ${formatDate(q.quotation_date)}`}
        actions={
          <>
            <Button variant="ghost" size="sm" icon="chevronLeft" to="/quotations">
              Back
            </Button>
            {canEdit ? (
              <Button variant="secondary" size="sm" icon="edit" to={`/quotations/${q.id}/edit`}>
                Edit
              </Button>
            ) : null}
            {/* Phase 6: the document actions. Preview opens the overlay in place;
                Print hands off to the chrome-less /print route (§14.2). */}
            <Button variant="ghost" size="sm" icon="eye" onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
            <Button variant="ghost" size="sm" icon="printer" to={`/print/quotation/${q.id}`}>
              Print
            </Button>
            {allowed.map((action) => {
              const meta = ACTION_META[action]
              if (!meta) return null
              const isDelete = action === 'delete'
              return (
                <Button
                  key={action}
                  variant={meta.variant}
                  size="sm"
                  icon={meta.icon}
                  loading={busy === action}
                  onClick={() => (isDelete ? setConfirmDelete(true) : runAction(action))}
                >
                  {meta.label}
                </Button>
              )
            })}
          </>
        }
      />

      <div className={styles.statusRow}>
        <StatusBadge status={q.status}>{statusLabel(q.status)}</StatusBadge>
        {q.is_expired ? (
          <span className={styles.expired}>Expired — validity period has passed</span>
        ) : q.valid_until ? (
          <span className={styles.validUntil}>Valid until {formatDate(q.valid_until)}</span>
        ) : null}
      </div>

      {actionError ? (
        <p className={styles.message} role="alert">
          {actionError.message || 'That action could not be completed.'}
        </p>
      ) : null}

      <div className={styles.grid}>
        <Card className={styles.itemsCard}>
          <h2 className={styles.cardTitle}>Line items</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className={styles.num}>
                    Qty
                  </th>
                  <th scope="col" className={styles.num}>
                    Rate
                  </th>
                  <th scope="col" className={styles.num}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {(q.items || []).map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td>
                      <span className={styles.itemName}>{it.name}</span>
                      {it.description ? <span className={styles.itemDesc}>{it.description}</span> : null}
                    </td>
                    <td className={styles.num}>
                      {(it.qty_milli / 1000).toString()}
                      {it.unit ? ` ${it.unit}` : ''}
                    </td>
                    <td className={styles.num}>{formatPaise(it.rate_paise)}</td>
                    <td className={styles.num}>
                      {formatPaise(it.line_total_paise ?? calcLineTotal(it.qty_milli, it.rate_paise))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {q.terms_text ? (
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>Terms</h3>
              <p className={styles.blockText}>{q.terms_text}</p>
            </div>
          ) : null}
          {q.notes ? (
            <div className={styles.block}>
              <h3 className={styles.blockTitle}>Notes</h3>
              <p className={styles.blockText}>{q.notes}</p>
            </div>
          ) : null}
        </Card>

        <aside className={styles.aside}>
          <Card className={styles.clientCard}>
            <h2 className={styles.cardTitle}>Client</h2>
            <p className={styles.clientName}>{q.client_snapshot?.name || '—'}</p>
            {q.client_snapshot?.phone ? <p className={styles.clientMeta}>{q.client_snapshot.phone}</p> : null}
            {q.client_snapshot?.email ? <p className={styles.clientMeta}>{q.client_snapshot.email}</p> : null}
            {q.client_id ? (
              <Link to={`/clients/${q.client_id}`} className={styles.link}>
                View client
              </Link>
            ) : null}
          </Card>

          <TotalsPanel totals={totals} gstBp={q.gst_bp} otherChargesLabel={q.other_charges_label} />
        </aside>
      </div>

      <QuotationPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        document={q}
        settings={settings}
        logoSrc={logoSrc}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete quotation?"
        message="This permanently removes the quotation. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          setConfirmDelete(false)
          runAction('delete')
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
