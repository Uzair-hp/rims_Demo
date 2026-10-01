import { NavLink } from 'react-router-dom'
import BrandLockup from './BrandLockup.jsx'
import Icon from '../ui/Icon.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { NAV_ITEMS } from '../../app/navigation.js'
import { useAuth } from '../../features/auth/AuthProvider.jsx'
import { useSettings } from '../../features/settings/SettingsProvider.jsx'
import styles from './Sidebar.module.css'

/**
 * Desktop sidebar, shown from `lg` up (§18.6). Mobile and tablet get the bottom
 * bar instead, so the same destination is never listed twice on one screen.
 *
 * `collapsed` narrows the rail to icons only; the toggle persists via
 * `useSidebarCollapsed` in the shell. The collapsed state is desktop-only — the
 * whole sidebar is hidden below `lg`, so mobile navigation is unaffected.
 *
 * @param {{ onNavigate?: () => void, collapsed?: boolean, onToggleCollapse?: () => void, mobileOpen?: boolean, onCloseMobile?: () => void }} props
 */
export default function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
}) {
  const { user, signOut } = useAuth()
  // Phase 3 exit criterion: the uploaded company logo renders in the app shell.
  // Before a logo is uploaded (or if the file 404s), BrandLockup keeps the
  // bundled vector — the slot is never empty.
  const { logoSrc } = useSettings()

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${mobileOpen ? styles.mobileOpen : ''} no-print`.trim()}>
      <div className={styles.head}>
        <div className={styles.brand}>
          {/*
            The app's one primary brand placement: the mark with the company name
            directly beneath it (§18.6). `alt=""` because the name is visible
            right below the mark — repeating it in the alt text would make a
            screen reader say it twice for one logo.

            The wordmark folds away in the collapsed rail, where
            `--size-sidebar-collapsed` (76px) has no width for it — the same
            treatment the nav labels get, and a clipped "Ruchita Inte…" under the
            mark would be worse than no name. The mark carries the identity on its
            own, and the page heading still names the document.
          */}
          <BrandLockup variant="stack" height={30} logoSrc={logoSrc} alt="" showWordmark={!collapsed} />
        </div>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={mobileOpen ? onCloseMobile : onToggleCollapse}
          aria-label={mobileOpen ? 'Close navigation menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={mobileOpen ? true : collapsed}
          title={mobileOpen ? 'Close navigation menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={mobileOpen ? 'x' : collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
        </button>
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
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={20} />
                <span className={styles.linkLabel}>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.footer}>
        <ThemeToggle className={styles.footerButton} />
        {/*
          Logout lives here rather than on Settings: it is the one action that must
          be reachable from anywhere, and on mobile this sidebar is not rendered at
          all, so BottomNav carries the same control (§7).
        */}
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            <img
              src={logoSrc || '/brand/logo.svg'}
              alt=""
              className={styles.avatarImg}
              onError={(event) => {
                // Fall back to the bundled mark once; guard against a loop if the
                // fallback itself is missing.
                if (!event.currentTarget.src.endsWith('/brand/logo.svg')) {
                  event.currentTarget.src = '/brand/logo.svg'
                }
              }}
            />
          </span>
          <span className={styles.accountText}>
            <span className={styles.accountName}>{user?.name || 'Signed in'}</span>
            <span className={styles.accountMeta}>{user?.email || ''}</span>
          </span>
        </div>
        <button
          type="button"
          className={styles.signOut}
          onClick={signOut}
          title={collapsed ? 'Sign out' : undefined}
        >
          <Icon name="logOut" size={18} />
          <span className={styles.signOutLabel}>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
