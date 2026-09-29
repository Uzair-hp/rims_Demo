import styles from './StatusBadge.module.css'

const STATUS_CLASS = {
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
 * §18.5 status indicator. Payment status drives the colour; an archived client is
 * shown with its own muted badge regardless of any payment state.
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
  const variant = STATUS_CLASS[status] || styles.neutral
  const label = children || STATUS_LABEL[status] || status || 'Unknown'
  return (
    <span className={`${styles.badge} ${variant} ${className}`.trim()} {...rest}>
      {label}
    </span>
  )
}
