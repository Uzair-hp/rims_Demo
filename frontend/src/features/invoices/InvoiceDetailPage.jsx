/**
 * Ruchita Interiors — invoice detail page (§13.2, FR-I6).
 *
 * Read-only view of a single invoice: the line items, the full totals breakdown,
 * an **Amount Paid / Outstanding** highlight (the thing the user opens an invoice
 * to find), and payment history. Header actions come entirely from the server's
 * `allowed_actions`, so the page can only offer what the API permits (D11).
 *
 * Payment *management* arrived in Phase 8: `record_payment` is now mapped in
 * `status.js`, so the action loop below renders it automatically for any issued
 * invoice without touching this component, and payments can be recorded and
 * deleted (corrected) here.
 *
 * Every mutation re-renders from the invoice the server returned, because
 * `paid_paise` / `outstanding_paise` / `payment_status` are derived on read
 * (§11) and the client must not recompute them (D2).
 */

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import TextField from '../../components/ui/TextField.jsx'
import InvoicePreview from '../documents/InvoicePreview.jsx'
import { useSettings } from '../settings/SettingsProvider.jsx'
import { cancelInvoice, fetchInvoice, issueInvoice, updateInvoice } from '../../api/endpoints/invoices.js'
import { deletePayment, recordPayment } from '../../api/endpoints/payments.js'
import { calcLineTotal } from '../../lib/calc.js'
import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import TotalsPanel from '../quotations/TotalsPanel.jsx'
import PaymentSheet from './PaymentSheet.jsx'
import {
  INVOICE_ACTION_META,
  invoiceStatusLabel,
  paymentStatusLabel,
  PAYMENT_METHOD_LABELS,
} from './status.js'
import styles from './InvoiceDetailPage.module.css'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const { settings, logoSrc, qrSrc } = useSettings()

  const [invoice, setInvoice] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  // FR-P8: the invoice's payment *presentation*, chosen before issue. The empty
  // option is 'Not selected' -> the document offers both electronic rails.
  // Deliberately narrower than the payment ledger's method list: cheque and card are
  // ways to be paid, not instructions to print.
  const PAYMENT_METHOD_OPTIONS = [
    { value: 'upi', label: 'UPI' },
    { value: 'bank_transfer', label: 'Bank transfer' },
    { value: 'cash', label: 'Cash' },
  ]

  const paymentMethodLabel = (m) => PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label || 'Not selected'

  const [draft, setDraft] = useState({ due_date: '', notes: '', terms_text: '', payment_method: '' })
  const [editing, setEditing] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState(null)
  const [confirmDeletePayment, setConfirmDeletePayment] = useState(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    fetchInvoice(id)
      .then((row) => {
        if (cancelled) return
        setInvoice(row)
        setDraft({
          due_date: row.due_date || '',
          notes: row.notes || '',
          terms_text: row.terms_text || '',
          payment_method: row.payment_method || '',
        })
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
    // `record_payment` opens the sheet rather than calling the API: it needs a
    // form, and the action loop has no way to express that.
    if (action === 'record_payment') {
      setPaymentError(null)
      setPaymentSheetOpen(true)
      return
    }
    setActionError(null)
    setBusy(action)
    try {
      if (action === 'issue') {
        setInvoice(await issueInvoice(id))
      } else if (action === 'cancel') {
        setInvoice(await cancelInvoice(id))
      }
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Record a payment, then adopt the invoice the server returned.
   *
   * The response carries the refreshed invoice precisely so this does not have to
   * add the amount to anything locally — the derived figures are the server's.
   */
  const handleRecordPayment = async (payload) => {
    setSavingPayment(true)
    setPaymentError(null)
    try {
      const { invoice: updated } = await recordPayment(id, payload)
      setInvoice(updated)
      setPaymentSheetOpen(false)
    } catch (e) {
      // Kept inside the sheet so the user can correct the amount in place rather
      // than losing everything they typed.
      setPaymentError(e.message || 'The payment could not be recorded.')
    } finally {
      setSavingPayment(false)
    }
  }

  const handleDeletePayment = async (paymentId) => {
    setActionError(null)
    setBusy('delete_payment')
    try {
      const { invoice: updated } = await deletePayment(paymentId)
      setInvoice(updated)
      setConfirmDeletePayment(null)
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async () => {
    setSavingDraft(true)
    setActionError(null)
    try {
      const saved = await updateInvoice(id, {
        due_date: draft.due_date || null,
        notes: draft.notes || null,
        terms_text: draft.terms_text || null,
        // Empty string is the "Not Selected" state, which the server stores as NULL
        // and the document renders as UPI + bank transfer. Not the same as omitting
        // the key: the admin is clearing a choice here, not leaving it untouched.
        payment_method: draft.payment_method || null,
      })
      setInvoice(saved)
      setDraft({
        due_date: saved.due_date || '',
        notes: saved.notes || '',
        terms_text: saved.terms_text || '',
        payment_method: saved.payment_method || '',
      })
      setEditing(false)
    } catch (e) {
      setActionError(e)
    } finally {
      setSavingDraft(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Invoices" title="Invoice" />
        <Skeleton height="16rem" />
      </div>
    )
  }

  if (loadState === 'error' || !invoice) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Invoices" title="Invoice" />
        <p className={styles.message} role="alert">
          This invoice could not be loaded.{' '}
          <Link to="/invoices" className={styles.link}>
            Back to invoices
          </Link>
          .
        </p>
      </div>
    )
  }

  const inv = invoice
  const allowed = inv.allowed_actions || []
  const isDraft = inv.status === 'draft'
  const totals = {
    subtotalPaise: inv.subtotal_paise || 0,
    discountPaise: inv.discount_paise || 0,
    taxablePaise: (inv.subtotal_paise || 0) - (inv.discount_paise || 0),
    gstPaise: inv.gst_paise || 0,
    otherChargesPaise: inv.other_charges_paise || 0,
    grandTotalPaise: inv.grand_total_paise || 0,
  }
  const payments = inv.payments || []

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Invoices"
        title={inv.number || `Invoice #${inv.id}`}
        description={`For ${inv.client_snapshot?.name || 'client'}`}
        actions={
          <>
            <Button variant="ghost" size="sm" icon="chevronLeft" to="/invoices">
              Back
            </Button>
            <Button variant="ghost" size="sm" icon="eye" onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
            <Button variant="ghost" size="sm" icon="printer" to={`/print/invoice/${inv.id}`}>
              Print
            </Button>
            {/* §8.5 Balance / Payment Due. Offered only when there is something to
                collect: a fully paid invoice has no balance to demand, and the
                server refuses the document anyway, so the button is hidden rather
                than shown-and-failing. Cancelled and draft invoices are excluded
                for the same reason — neither is payable. */}
            {inv.status === 'issued' && (inv.outstanding_paise || 0) > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                icon="fileText"
                to={`/print/payment-due/${inv.id}`}
                title="Printable reminder for the outstanding balance. Records nothing."
              >
                Balance invoice
              </Button>
            ) : null}
            {allowed.map((action) => {
              const meta = INVOICE_ACTION_META[action]
              // `duplicate` and `delete` are still advertised by the lifecycle
              // service with no endpoint, so they have no entry and are skipped.
              if (!meta) return null
              const isCancel = action === 'cancel'
              return (
                <Button
                  key={action}
                  variant={meta.variant}
                  size="sm"
                  icon={meta.icon}
                  loading={busy === action}
                  onClick={() => (isCancel ? setConfirmCancel(true) : runAction(action))}
                >
                  {meta.label}
                </Button>
              )
            })}
          </>
        }
      />

      <div className={styles.statusRow}>
        <StatusBadge status={inv.payment_status}>{paymentStatusLabel(inv.payment_status)}</StatusBadge>
        <span className={styles.docStatus}>{invoiceStatusLabel(inv.status)}</span>
        {inv.issue_date ? <span className={styles.meta}>Issued {formatDate(inv.issue_date)}</span> : null}
        {inv.due_date ? <span className={styles.meta}>Due {formatDate(inv.due_date)}</span> : null}
      </div>

      {inv.status === 'cancelled' ? (
        <p className={styles.cancelledNote}>
          This invoice was cancelled and no longer counts toward billing. The quotation it came from was
          released and can be invoiced again.
        </p>
      ) : null}

      {/* A payment makes Cancel impossible (§11), and the action simply stops
          being advertised. Without this the button would appear to vanish and the
          page would look broken rather than explained. */}
      {inv.status === 'issued' && payments.length > 0 ? (
        <p className={styles.cancelNote}>
          Cancel is unavailable because a payment has been recorded. Delete the payment below if it was
          entered in error — the invoice status and outstanding will be recalculated.
        </p>
      ) : null}

      {actionError ? (
        <p className={styles.message} role="alert">
          {actionError.message || 'That action could not be completed.'}
        </p>
      ) : null}

      {/* A partially-paid invoice is the one case where the customer's copy of the
          original document is misleading: the invoice prints its grand total, and
          the QR on it asks for what is still owed rather than that total, so a
          printed invoice cannot over-collect. The note says so explicitly, because
          a customer comparing a paper invoice against a QR amount needs the
          explanation rather than the discrepancy. */}
      {inv.status === 'issued' && (inv.paid_paise || 0) > 0 && (inv.outstanding_paise || 0) > 0 ? (
        <p className={styles.balanceNote}>
          A balance invoice is available for the remaining {formatPaise(inv.outstanding_paise)}. It re-states
          this invoice&rsquo;s figures and asks only for what is still owed &mdash; it does not create a
          second invoice, and it records nothing on its own.
        </p>
      ) : null}

      {/* §4.4 FR-I6: amount paid and outstanding are the headline figures. */}
      <div className={styles.moneyStrip}>
        <div className={styles.moneyTile}>
          <span className={styles.moneyLabel}>Grand total</span>
          <span className={styles.moneyValue}>{formatPaise(inv.grand_total_paise)}</span>
        </div>
        <div className={styles.moneyTile}>
          <span className={styles.moneyLabel}>Amount paid</span>
          <span className={styles.moneyValue}>{formatPaise(inv.paid_paise)}</span>
        </div>
        <div className={`${styles.moneyTile} ${styles.moneyTileDue}`}>
          <span className={styles.moneyLabel}>Outstanding</span>
          <span className={styles.moneyValue}>{formatPaise(inv.outstanding_paise)}</span>
        </div>
      </div>

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
                {(inv.items || []).map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td>
                      <span className={styles.itemName}>{it.name}</span>
                      {it.category ? <span className={styles.itemCat}>{it.category}</span> : null}
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

          <h2 className={styles.cardTitle}>Payment history</h2>
          {payments.length === 0 ? (
            <p className={styles.emptyPayments}>
              {inv.status === 'issued'
                ? `No payments recorded yet. This invoice is fully outstanding at ${formatPaise(inv.outstanding_paise)}.`
                : 'No payments recorded yet. Payments can only be recorded once the invoice is issued.'}
            </p>
          ) : (
            <ul className={styles.paymentList}>
              {payments.map((payment) => (
                <li key={payment.id} className={styles.paymentRow}>
                  <span className={styles.paymentAmount}>{formatPaise(payment.amount_paise)}</span>
                  <span className={styles.paymentMeta}>
                    {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                    {payment.notes ? ` · ${payment.notes}` : ''}
                  </span>
                  <span className={styles.paymentDate}>{formatDate(payment.paid_on)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={`Delete payment of ${formatPaise(payment.amount_paise)}`}
                    onClick={() => setConfirmDeletePayment(payment)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {isDraft ? (
            <div className={styles.draftBlock}>
              <h2 className={styles.cardTitle}>Draft details</h2>
              {!editing ? (
                <>
                  <p className={styles.blockText}>Due date: {formatDate(inv.due_date) || 'not set'}</p>
                  <p className={styles.blockText}>Payment method: {paymentMethodLabel(inv.payment_method)}</p>
                  {inv.notes ? <p className={styles.blockText}>Notes: {inv.notes}</p> : null}
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>
                    Edit draft details
                  </Button>
                </>
              ) : (
                <>
                  <TextField
                    label="Due date"
                    type="date"
                    value={draft.due_date}
                    onChange={(v) => setDraft((d) => ({ ...d, due_date: v }))}
                    hint="Optional"
                  />
                  <TextField
                    as="textarea"
                    label="Notes"
                    rows={3}
                    value={draft.notes}
                    onChange={(v) => setDraft((d) => ({ ...d, notes: v }))}
                    hint="Internal, not printed"
                  />
                  <TextField
                    as="textarea"
                    label="Terms"
                    rows={4}
                    value={draft.terms_text}
                    onChange={(v) => setDraft((d) => ({ ...d, terms_text: v }))}
                    hint="Shown on the invoice document"
                  />
                  <TextField
                    as="select"
                    label="Payment method"
                    value={draft.payment_method}
                    onChange={(v) => setDraft((d) => ({ ...d, payment_method: v }))}
                    hint={
                      draft.payment_method
                        ? 'Decides which payment details print on this invoice. Fixed once issued.'
                        : 'Optional. Left unset, the invoice offers both UPI and bank transfer.'
                    }
                  >
                    <option value="">Not selected</option>
                    {PAYMENT_METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </TextField>
                  <div className={styles.draftActions}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="check"
                      loading={savingDraft}
                      onClick={saveDraft}
                    >
                      Save details
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </Card>

        <aside className={styles.aside}>
          <Card className={styles.clientCard}>
            <h2 className={styles.cardTitle}>Client</h2>
            <p className={styles.clientName}>{inv.client_snapshot?.name || '—'}</p>
            {inv.client_snapshot?.phone ? (
              <p className={styles.clientMeta}>{inv.client_snapshot.phone}</p>
            ) : null}
            {inv.client_snapshot?.email ? (
              <p className={styles.clientMeta}>{inv.client_snapshot.email}</p>
            ) : null}
            {inv.client_id ? (
              <Link to={`/clients/${inv.client_id}`} className={styles.link}>
                View client
              </Link>
            ) : null}
            {inv.quotation_id ? (
              <Link to={`/quotations/${inv.quotation_id}`} className={styles.link}>
                View source quotation
              </Link>
            ) : null}
          </Card>

          <TotalsPanel totals={totals} gstBp={inv.gst_bp} otherChargesLabel={inv.other_charges_label} />
        </aside>
      </div>

      <InvoicePreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        document={inv}
        settings={settings}
        logoSrc={logoSrc}
        qrSrc={qrSrc}
      />

      <PaymentSheet
        open={paymentSheetOpen}
        onClose={() => setPaymentSheetOpen(false)}
        outstandingPaise={inv.outstanding_paise}
        onSubmit={handleRecordPayment}
        submitting={savingPayment}
        error={paymentError}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this invoice?"
        message="The invoice is kept for history but stops counting toward billing, and the quotation is released so it can be invoiced again. This cannot be undone."
        confirmLabel="Cancel invoice"
        danger
        onConfirm={() => {
          setConfirmCancel(false)
          runAction('cancel')
        }}
        onClose={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmDeletePayment)}
        title="Delete this payment?"
        message={
          confirmDeletePayment
            ? `Removing ${formatPaise(confirmDeletePayment.amount_paise)} is a correction, not a normal action. The invoice's amount paid, outstanding and payment status will all be recalculated, and the cancellation option becomes available again.`
            : ''
        }
        confirmLabel="Delete payment"
        danger
        onConfirm={() => handleDeletePayment(confirmDeletePayment.id)}
        onClose={() => setConfirmDeletePayment(null)}
      />
    </div>
  )
}
