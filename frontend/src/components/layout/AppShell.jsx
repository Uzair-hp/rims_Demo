import { useCallback, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import NavDrawer from './NavDrawer.jsx'
import ApiStatus from './ApiStatus.jsx'
import Sheet from '../ui/Sheet.jsx'
import SheetList from '../ui/SheetList.jsx'
import Icon from '../ui/Icon.jsx'
import { CREATE_ACTIONS } from '../../app/navigation.js'
import { useSidebarCollapsed } from '../../app/useSidebarCollapsed.js'
import styles from './AppShell.module.css'

/**
 * Authenticated application chrome (§18.6).
 *
 * - `lg` and up: fixed ink sidebar, no mobile chrome.
 * - Below `lg`: sticky top bar with a hamburger that opens the left navigation
 *   drawer, hidden in print.
 * - The shell owns the skip link and the single `<main>` landmark.
 */
export default function AppShell() {
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [lastPath, setLastPath] = useState(pathname)
  const { collapsed, toggleCollapsed } = useSidebarCollapsed()

  // A route change closes the drawer even when it did not come from a link inside
  // it — a back/forward navigation or a redirect would otherwise leave the panel
  // open over a page it has nothing to do with.
  //
  // Adjusting during render rather than in an effect: the panel must be gone in
  // the same frame the path changes, and React re-renders immediately without
  // committing an intermediate frame that still shows it.
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setNavOpen(false)
  }

  const closeNav = useCallback(() => setNavOpen(false), [])
  const closeSheets = useCallback(() => setNewOpen(false), [])

  return (
    <div className={styles.shell}>
      <a className={`${styles.skipLink} no-print`} href="#main-content">
        Skip to main content
      </a>

      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />

      <div className={`${styles.content} ${collapsed ? styles.contentCollapsed : ''}`.trim()}>
        <TopBar onOpenMenu={() => setNavOpen(true)} menuOpen={navOpen} />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <ApiStatus />
          <Outlet />
        </main>
      </div>

      <NavDrawer open={navOpen} onClose={closeNav} />

      <div className={`${styles.desktopNew} no-print`}>
        <button type="button" className={styles.fab} onClick={() => setNewOpen(true)} aria-label="Create new">
          <Icon name="plus" size={22} />
        </button>
      </div>

      <Sheet
        open={newOpen}
        onClose={closeSheets}
        title="Create new"
        description="Quotations open in Phase 2. Clients open in Phase 4."
      >
        <SheetList items={CREATE_ACTIONS} onSelect={closeSheets} />
      </Sheet>
    </div>
  )
}
