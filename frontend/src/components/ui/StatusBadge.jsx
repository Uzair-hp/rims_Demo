import styles from './StatusBadge.module.css'

/**
 * Payment status (§11). These are *derived* from the ledger, never stored.
 */
const PAYMENT_CLASS = {
  unpaid: styles.unpaid,
  partially_paid: styles.partial,
  paid: styles.paid,
}

const STATUS_LABEL = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
}

/**
 * Quotation status (§18.6), the single source for the badge treatment so the
 * list, the detail page, the Dashboard's recent quotations and the status
 * breakdown chart can never disagree about what "Approved" looks like.
 *
 * `converted` is amber. §18.6 originally specified "ink solid + gold
 * left-border" for it, on the reasoning that a converted quotation is a brand
 * moment. Amber was chosen deliberately instead, to make the five statuses a
 * readable scale from neutral through to committed, and §18.6 has been updated
 * to match. Note the cost, recorded so it is not lost: amber is also
 * `--color-warning`, which is the Partially *Paid* invoice badge, and §18.5
 * keeps warning deliberately "orange-leaning to stay clear of gold". The two
 * never appear in the same badge or the same chart, but the family overlap is
 * real and worth revisiting in the Phase 11 contrast pass.
 */
const QUOTATION_CLASS = {
  draft: styles.qDraft,
  sent: styles.qSent,
  approved: styles.qApproved,
  rejected: styles.qRejected,
  converted: styles.qConverted,
}

/**
 * A §18.5 status indicator. Payment status drives the colour; an archived client
 * is shown with its own muted badge regardless of any payment state.
 *
 * Both status vocabularies are looked up in one map on purpose. They are
 * disjoint sets of strings, so a single lookup cannot mis-colour one as the
 * other, and an unrecognised status falls back to neutral rather than guessing.
 *
 * @param {{ status?: string, archived?: boolean, children?: import('react').ReactNode, className?: string }} props
 */
export default function StatusBadge({ status, archived = false, children, className = '', ...rest }) {
  if (archived) {
    return (
      <span className={`${styles.badge} ${styles.archived} ${className}`.trim()} {...rest}>
        {children || 'Archived'}
      </span>
    )
  }
  const variant = PAYMENT_CLASS[status] || QUOTATION_CLASS[status] || styles.neutral
  const label = children || STATUS_LABEL[status] || status || 'Unknown'
  return (
    <span className={`${styles.badge} ${variant} ${className}`.trim()} {...rest}>
      {label}
    </span>
  )
}
