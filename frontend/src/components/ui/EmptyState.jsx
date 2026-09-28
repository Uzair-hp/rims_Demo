import Icon from './Icon.jsx'
import Button from './Button.jsx'
import styles from './EmptyState.module.css'

/**
 * Placeholder state for pages whose data arrives in a later phase, and for real
 * empty lists. §20 requires an icon, a title, one line of guidance and — where
 * the next step is obvious — a single action.
 *
 * The action is a link (`actionTo`) when it navigates and a button
 * (`onAction`) when it does something — never both (§20).
 *
 * @param {{
 *   icon?: string,
 *   title: string,
 *   message?: string,
 *   actionLabel?: string,
 *   actionTo?: string,
 *   onAction?: () => void,
 *   actionIcon?: string,
 *   tone?: 'neutral' | 'muted',
 *   className?: string,
 * }} props
 */
export default function EmptyState({
  icon = 'inbox',
  title,
  message,
  actionLabel,
  actionTo,
  onAction,
  actionIcon = 'plus',
  tone = 'neutral',
  className = '',
}) {
  return (
    <div className={`${styles.state} ${tone === 'muted' ? styles.muted : ''} ${className}`.trim()}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      {message ? <p className={styles.message}>{message}</p> : null}
      {actionLabel ? (
        <Button
          variant="secondary"
          icon={actionIcon}
          to={actionTo}
          onClick={onAction}
          className={styles.action}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
