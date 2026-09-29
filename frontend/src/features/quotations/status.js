/**
 * Ruchita Interiors — quotation status + action labels (§13, §18.5).
 *
 * One place for the human labels so the list, detail and editor never disagree.
 * The set of *allowed* actions always comes from the server (`allowed_actions`);
 * this only maps those keys to button copy, icons and variants.
 */

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted',
}

export const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'converted', label: 'Converted' },
]

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || 'Unknown'
}

/**
 * Presentation for each lifecycle action the server may permit. `icon` values are
 * limited to the glyphs the shared Icon set actually ships (§18.4).
 */
export const ACTION_META = {
  send: { label: 'Send', icon: 'check', variant: 'primary' },
  approve: { label: 'Approve', icon: 'check', variant: 'primary' },
  reject: { label: 'Reject', icon: 'x', variant: 'secondary' },
  reopen: { label: 'Reopen', icon: 'rotateCw', variant: 'secondary' },
  duplicate: { label: 'Duplicate', icon: 'fileText', variant: 'secondary' },
  delete: { label: 'Delete', icon: 'trash', variant: 'danger' },
  create_invoice: { label: 'Create invoice', icon: 'receipt', variant: 'primary' },
}
