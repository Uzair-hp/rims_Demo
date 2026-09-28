import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import styles from './SheetList.module.css'

/**
 * List of sheet rows: an icon, a label, an optional phase hint, and a chevron.
 * Rows navigate, so they are links rather than buttons.
 *
 * @param {{ items: Array<{ to: string, label: string, icon: string, hint?: string, onSelect?: () => void }>, onSelect?: () => void }} props
 */
export default function SheetList({ items, onSelect }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className={styles.row} onClick={onSelect}>
            <span className={styles.rowIcon}>
              <Icon name={item.icon} size={20} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{item.label}</span>
              {item.hint ? <span className={styles.rowHint}>{item.hint}</span> : null}
            </span>
            <Icon name="chevronRight" size={18} className={styles.chevron} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
