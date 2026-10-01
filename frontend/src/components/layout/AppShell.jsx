import { useCallback, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import BottomNav from './BottomNav.jsx'
import BrandLockup from './BrandLockup.jsx'
import ApiStatus from './ApiStatus.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import Sheet from '../ui/Sheet.jsx'
import SheetList from '../ui/SheetList.jsx'
import Icon from '../ui/Icon.jsx'
import { CREATE_ACTIONS, MORE_NAV_ITEMS } from '../../app/navigation.js'
import { useSidebarCollapsed } from '../../app/useSidebarCollapsed.js'
import { useAuth } from '../../features/auth/AuthProvider.jsx'
import styles from './AppShell.module.css'

/**
 * Authenticated application chrome (§18.6).
 *
 * - `lg` and up: fixed ink sidebar, no bottom bar.
 * - Below `lg`: sticky top bar and a five-slot bottom bar, both hidden in print.
 * - The shell owns the skip link and the single `<main>` landmark.
 */
export default function AppShell() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { collapsed, toggleCollapsed } = useSidebarCollapsed()
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()

  const closeSheets = useCallback(() => {
    setMoreOpen(false)
    setNewOpen(false)
  }, [])

  // Close the sheet first: RequireAuth unmounts the shell on the redirect to
  // /login, and leaving focus behind in a removed element breaks the next Tab.
  const handleSignOut = useCallback(() => {
    closeSheets()
    signOut()
  }, [closeSheets, signOut])

  return (
    <div className={styles.shell}>
      <a className={`${styles.skipLink} no-print`} href="#main-content">
        Skip to main content
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onNavigate={() => setMobileMenuOpen(false)}
      />
      {mobileMenuOpen ? (
        <button
          type="button"
          className={`${styles.mobileBackdrop} no-print`}
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
        />
      ) : null}

      <div className={`${styles.content} ${collapsed ? styles.contentCollapsed : ''}`.trim()}>
        <TopBar mobileMenuOpen={mobileMenuOpen} onToggleMobileMenu={() => setMobileMenuOpen((open) => !open)} />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <ApiStatus />
          <Outlet />
        </main>
      </div>

      <BottomNav onOpenMore={() => setMoreOpen(true)} onOpenNew={() => setNewOpen(true)} />

      <div className={`${styles.desktopNew} no-print`}>
        <button type="button" className={styles.fab} onClick={() => setNewOpen(true)} aria-label="Create new">
          <Icon name="plus" size={22} />
        </button>
      </div>

      <Sheet
        open={moreOpen}
        onClose={closeSheets}
        title="More"
        description="Everything that does not fit in the bottom bar."
      >
        <SheetList items={MORE_NAV_ITEMS} onSelect={closeSheets} />
        <div className={styles.sheetFooter}>
          <div className={styles.sheetBrand}>
            <BrandLockup variant="text" />
          </div>
          <ThemeToggle className={styles.sheetAction} />
          <span className={styles.sheetMeta} data-route={pathname}>
            {user?.email || ''}
          </span>
          {/*
            Sign out is repeated in the More sheet because the sidebar is not
            rendered below `lg`. It is the one action that must be reachable on
            every screen size, so it is not left behind in Settings.
          */}
          <button type="button" className={styles.sheetAction} onClick={handleSignOut}>
            <Icon name="logOut" size={20} />
            Sign out
          </button>
        </div>
      </Sheet>

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
