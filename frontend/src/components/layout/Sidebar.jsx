import { NavLink } from 'react-router-dom'
import BrandLockup from './BrandLockup.jsx'
import Icon from '../ui/Icon.jsx'
import { NAV_ITEMS } from '../../app/navigation.js'
import { useTheme } from '../../app/useTheme.js'
import { useAuth } from '../../features/auth/AuthProvider.jsx'
import { useSettings } from '../../features/settings/SettingsProvider.jsx'
import styles from './Sidebar.module.css'

/**
 * Desktop sidebar, shown from `lg` up (§18.6). Mobile and tablet get the bottom
 * bar instead, so the same destination is never listed twice on one screen.
 *
 * @param {{ onNavigate?: () => void }} props
 */
export default function Sidebar({ onNavigate }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const { user, signOut } = useAuth()
  // Phase 3 exit criterion: the uploaded company logo renders in the app shell.
  // Before a logo is uploaded (or if the file 404s), BrandLockup keeps the
  // bundled vector — the slot is never empty.
  const { logoSrc } = useSettings()

  return (
    <aside className={`${styles.sidebar} no-print`}>
      <div className={styles.brand}>
        <BrandLockup variant="plate" height={30} logoSrc={logoSrc} />
      </div>

      <nav className={styles.nav} aria-label="Primary">
        <ul className={styles.list}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`.trim()}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.footer}>
        <button type="button" className={styles.footerButton} onClick={toggleTheme}>
          <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={20} />
          <span>{resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </button>
        {/*
          Logout lives here rather than on Settings: it is the one action that must
          be reachable from anywhere, and on mobile this sidebar is not rendered at
          all, so BottomNav carries the same control (§7).
        */}
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            <Icon name="user" size={18} />
          </span>
          <span className={styles.accountText}>
            <span className={styles.accountName}>{user?.name || 'Signed in'}</span>
            <span className={styles.accountMeta}>{user?.email || ''}</span>
          </span>
          <button type="button" className={styles.signOut} onClick={signOut}>
            <Icon name="logOut" size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
