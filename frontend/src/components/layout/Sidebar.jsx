import { NavLink } from 'react-router-dom'
import BrandLockup from './BrandLockup.jsx'
import Icon from '../ui/Icon.jsx'
import { NAV_ITEMS } from '../../app/navigation.js'
import { useTheme } from '../../app/useTheme.js'
import { useAuth } from '../../features/auth/AuthProvider.jsx'
import { useSettings } from '../../features/settings/SettingsProvider.jsx'
import styles from './Sidebar.module.css'

/**
 * The navigation plate: brand, primary destinations, theme and account.
 *
 * `variant="desktop"` is the fixed rail shown from `lg` up (§18.6).
 * `variant="drawer"` is the same plate inside the mobile drawer — same
 * `NAV_ITEMS`, same icons, same active-route highlighting, rendered by
 * `NavDrawer` below `lg`. One component means the two can never list different
 * destinations or drift apart visually; only the head control differs (collapse
 * toggle on the rail, close button in the drawer) and only `onNavigate` differs
 * (absent on the rail, "close me" in the drawer).
 *
 * `collapsed` narrows the rail to icons only; the toggle persists via
 * `useSidebarCollapsed` in the shell. The collapsed state is desktop-only — the
 * rail is hidden below `lg`, and the drawer is always full width, so neither can
 * be left collapsed on a phone.
 *
 * @param {{
 *   onNavigate?: () => void,
 *   collapsed?: boolean,
 *   onToggleCollapse?: () => void,
 *   variant?: 'desktop' | 'drawer',
 *   onClose?: () => void,
 *   createActions?: Array<{ to: string, label: string, icon: string }>,
 * }} props
 */
export default function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  variant = 'desktop',
  onClose,
  createActions = [],
}) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const { user, signOut } = useAuth()
  // Phase 3 exit criterion: the uploaded company logo renders in the app shell.
  // Before a logo is uploaded (or if the file 404s), BrandLockup keeps the
  // bundled vector — the slot is never empty.
  const { logoSrc } = useSettings()

  const isDrawer = variant === 'drawer'

  return (
    <aside
      className={`${styles.sidebar} ${isDrawer ? styles.drawer : ''} ${collapsed ? styles.collapsed : ''} no-print`.trim()}
    >
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
        {isDrawer ? (
          // The drawer's counterpart to the collapse toggle: the plate is always
          // full width on a phone, so there is nothing to collapse.
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={onClose}
            aria-label="Close navigation"
            title="Close navigation"
          >
            <Icon name="x" size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
          </button>
        )}
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

        {/*
          The create shortcuts the removed bottom bar carried on its "New" slot.
          Only the drawer renders them: the desktop plate reaches the same actions
          through the FAB, and listing them twice on a wide screen would be noise.
          The items come from `CREATE_ACTIONS`, so there is still one definition.
        */}
        {createActions.length > 0 ? (
          <>
            <p className={styles.groupHeading}>Create</p>
            <ul className={styles.list}>
              {createActions.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} onClick={onNavigate} className={styles.link}>
                    <Icon name={item.icon} size={20} />
                    <span className={styles.linkLabel}>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.footerButton}
          onClick={toggleTheme}
          title={collapsed ? (resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme') : undefined}
        >
          <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={20} />
          <span className={styles.footerLabel}>
            {resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
          </span>
        </button>
        {/*
          Logout lives here rather than on Settings: it is the one action that must
          be reachable from anywhere. Below `lg` the same plate is the drawer, so
          the control is on screen at every size without a second copy (§7).
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
