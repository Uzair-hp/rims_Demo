import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import { titleForPath } from '../../app/navigation.js'
import styles from './TopBar.module.css'

/**
 * Mobile and tablet top bar: menu, back, page title, one optional action.
 * Only rendered below `lg`, where the sidebar is not on screen (§18.6).
 *
 * The hamburger opens the navigation drawer. It is the left-most control, ahead of
 * the back link: on a phone the drawer is how you change section, while back
 * returns you to where you came from within one.
 *
 * The title is a `<p>`, not a heading: every route owns exactly one `<h1>` in
 * its PageHeader, and a second heading here would duplicate it for screen
 * readers (§18.2).
 *
 * @param {{ actions?: import('react').ReactNode, onOpenMenu?: () => void, menuOpen?: boolean }} props
 */
export default function TopBar({ actions, onOpenMenu, menuOpen = false }) {
  const { pathname } = useLocation()
  const isRoot = pathname === '/'
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])

  return (
    <header className={`${styles.topbar} no-print ${scrolled ? styles.scrolled : ''}`.trim()}>
      <div className={styles.side}>
        {/*
          The drawer trigger. `aria-expanded`/`aria-controls` tie the button to the
          panel it owns, so a screen reader announces the drawer's state rather than
          just its presence (§18.2).
        */}
        <button
          type="button"
          className={styles.iconButton}
          onClick={onOpenMenu}
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
        >
          <Icon name="menu" size={22} />
        </button>
        {isRoot ? null : (
          <Link to="/" className={styles.iconButton} aria-label="Back to dashboard">
            <Icon name="chevronLeft" size={22} />
          </Link>
        )}
      </div>

      <p className={styles.title}>{titleForPath(pathname)}</p>

      <div className={styles.side}>{actions ?? null}</div>
    </header>
  )
}
