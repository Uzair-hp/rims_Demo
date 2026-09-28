import PageHeader from '../components/ui/PageHeader.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import styles from './PagePlaceholder.module.css'

/**
 * Shared body for the routes whose real content belongs to a later phase.
 *
 * §20 requires a purposeful empty state rather than a blank page or a spinner,
 * so each placeholder states what the screen will do, when it arrives, and — if
 * the next step exists today — one action.
 *
 * @param {{
 *   title: string,
 *   description: string,
 *   icon: string,
 *   emptyTitle: string,
 *   emptyMessage: string,
 *   actionLabel?: string,
 *   actionTo?: string,
 *   actionIcon?: string,
 *   extra?: import('react').ReactNode,
 * }} props
 */
export default function PagePlaceholder({
  title,
  description,
  icon,
  emptyTitle,
  emptyMessage,
  actionLabel,
  actionTo,
  actionIcon,
  extra,
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title={emptyTitle}
        message={emptyMessage}
        actionLabel={actionLabel}
        actionTo={actionTo}
        actionIcon={actionIcon}
        tone="muted"
        className={styles.placeholder}
      />
      {extra}
    </>
  )
}
