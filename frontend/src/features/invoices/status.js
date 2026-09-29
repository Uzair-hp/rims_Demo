/**
 * Ruchita Interiors — invoice status + action labels (§13.2, §18.6).
 *
 * One place for the human labels, mirroring `features/quotations/status.js`.
 * The set of *allowed* actions always comes from the server (`allowed_actions`);
 * this only maps those keys to button copy, icons and variants.
 *
 * Invoice lifecycle status (draft / issued / cancelled) and payment status
 * (unpaid / partially paid / paid) are deliberately separate. `StatusBadge` is
 * driven by payment status, because that is the thing a user scans a list for;
 * document status is shown as text beside it, and cancelling is the one case
 * worth a badge of its own.
 */

export const INVOICE_STATUS_LABELS = {
  draft: 'Draft',
  issued: 'Issued',
  cancelled: 'Cancelled',
}

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
}

export const PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'All invoices' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
]

export function invoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || status || 'Unknown'
}

export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status || 'Unknown'
}

/**
 * Human labels for the payment method enum (§8.3 / `PaymentSchema`).
 *
 * Lives here rather than inside the detail page so the payment sheet and the
 * history list cannot drift apart. The keys match the model CHECK constraint
 * exactly, so a new backend method shows up here as the raw key rather than
 * silently rendering blank.
 */
export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
}

/** Options for the payment sheet's method select, in the order an owner uses. */
export const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

/**
 * Presentation for each invoice action the server may permit.
 *
 * `record_payment` arrives in Phase 8. `duplicate` and `delete` are still
 * advertised by the lifecycle service for an issued invoice but have no endpoint
 * at all, so they stay unmapped and the page gives them no button — the same
 * mechanism that let `record_payment` appear without any change to the page's
 * action loop.
 */
export const INVOICE_ACTION_META = {
  issue: { label: 'Issue', icon: 'check', variant: 'primary' },
  cancel: { label: 'Cancel', icon: 'x', variant: 'secondary' },
  record_payment: { label: 'Record payment', icon: 'wallet', variant: 'primary' },
}
