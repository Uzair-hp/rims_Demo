import { NavLink } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import { BOTTOM_NAV_ITEMS } from '../../app/navigation.js'
import styles from './BottomNav.module.css'

/**
 * Mobile and tablet bottom bar (§18.6). Slots: Dashboard, Quotations, Invoices,
 * More, New. Each slot is at least 44px wide and the bar respects the home
 * indicator inset.
 *
 * @param {{ onOpenMore: () => void, onOpenNew: () => void }} props
 */
export default function BottomNav({ onOpenMore, onOpenNew }) {
  return (
    <nav className={`${styles.bar} no-print`} aria-label="Primary">
      {BOTTOM_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `${styles.slot} ${isActive ? styles.active : ''}`.trim()}
        >
          <Icon name={item.icon} size={22} />
          <span className={styles.slotLabel}>{item.label}</span>
        </NavLink>
      ))}

      <button type="button" className={styles.slot} onClick={onOpenMore}>
        <Icon name="more" size={22} />
        <span className={styles.slotLabel}>More</span>
      </button>

      <button type="button" className={styles.slot} onClick={onOpenNew}>
        <span className={styles.newIcon}>
          <Icon name="plus" size={22} />
        </span>
        <span className={styles.slotLabel}>New</span>
      </button>
    </nav>
  )
}
