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
 * Presentation for each invoice action the server may permit.
 *
 * Deliberately limited to the two actions Phase 7 actually implements. The
 * lifecycle service advertises more for an issued invoice — `record_payment`
 * (Phase 8), and `duplicate`/`delete` (no endpoint at all) — and anything absent
 * from this map gets no button, so the page can never offer an action the API
 * would reject. Adding the endpoint later means adding an entry here.
 */
export const INVOICE_ACTION_META = {
  issue: { label: 'Issue', icon: 'check', variant: 'primary' },
  cancel: { label: 'Cancel', icon: 'x', variant: 'secondary' },
}
