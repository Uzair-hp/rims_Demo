import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import { titleForPath } from '../../app/navigation.js'
import ThemeToggle from './ThemeToggle.jsx'
import styles from './TopBar.module.css'

/**
 * Mobile and tablet top bar: back, page title, one optional action.
 * Only rendered below `lg`, where the sidebar is not on screen (§18.6).
 *
 * The title is a `<p>`, not a heading: every route owns exactly one `<h1>` in
 * its PageHeader, and a second heading here would duplicate it for screen
 * readers (§18.2).
 *
 * @param {{ actions?: import('react').ReactNode, mobileMenuOpen?: boolean, onToggleMobileMenu?: () => void }} props
 */
export default function TopBar({ actions, mobileMenuOpen = false, onToggleMobileMenu }) {
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
        <button
          type="button"
          className={styles.menuButton}
          onClick={onToggleMobileMenu}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
        >
          <Icon name={mobileMenuOpen ? 'x' : 'menu'} size={22} />
        </button>
        {isRoot ? (
          <span className={styles.placeholder} aria-hidden="true" />
        ) : (
          <Link to="/" className={styles.iconButton} aria-label="Back to dashboard">
            <Icon name="chevronLeft" size={22} />
          </Link>
        )}
      </div>

      <p className={styles.title}>{titleForPath(pathname)}</p>

      <div className={styles.side}>
        <ThemeToggle showLabel={false} />
        {actions ?? null}
      </div>
    </header>
  )
}
