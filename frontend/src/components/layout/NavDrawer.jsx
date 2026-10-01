import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Sidebar from './Sidebar.jsx'
import { CREATE_ACTIONS } from '../../app/navigation.js'
import { useIsDesktop } from '../../hooks/useMediaQuery.js'
import styles from './NavDrawer.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * How long the panel stays mounted after a close request. It matches
 * `--duration-slow` (220ms) plus a little slack, so the panel is still in the DOM
 * for the whole slide-out and the slide is never cut off mid-travel. The animation
 * itself is CSS (§18.10); this constant only decides when the node goes away.
 */
const EXIT_MS = 260

/**
 * Mobile navigation drawer (§18.6) — the phone-sized counterpart to the desktop
 * sidebar.
 *
 * It is not a second navigation system: the destinations, icons, branding, theme
 * control and sign out all come from `Sidebar` and `app/navigation.js`, so the
 * drawer cannot drift from the rail. Only the shell around it is new — a
 * left-hand panel, a scrim, and the interaction rules the sidebar never needed
 * because it is always on screen:
 *
 * - Escape, or a click on the scrim, closes it (§18.3).
 * - The page behind it does not scroll while it is open.
 * - Focus moves into the panel on open and returns to the hamburger on close.
 *
 * The panel is unmounted when closed, so its links are never a second set of
 * navigation landmarks for assistive technology to walk through (§18.2).
 *
 * `CREATE_ACTIONS` rides along because the bottom bar's "New" slot used to be the
 * only way to reach them on a phone, and the desktop FAB is `lg`-only.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function NavDrawer({ open, onClose }) {
  const isDesktop = useIsDesktop()
  const [mounted, setMounted] = useState(open)
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)

  // Mount on open, and stay mounted through the slide-out on close so the closing
  // transition has something to animate.
  //
  // Opening is a render-phase adjustment rather than an effect: the panel has to
  // exist in the very first frame `open` turns true, and setting state during
  // render is React's own answer for "a prop changed, my state must follow".
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return undefined
    const timer = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [open, mounted])

  // Growing past `lg` brings the sidebar back, so an open drawer would be a second
  // copy of the rail on one screen.
  useEffect(() => {
    if (isDesktop && open) onClose()
  }, [isDesktop, open, onClose])

  useEffect(() => {
    if (!mounted) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    restoreFocusRef.current = document.activeElement

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      // Tab stays inside the panel while it is open, so focus cannot land on the
      // page behind a modal drawer. Every match is a control the panel owns, so
      // there is nothing to filter out for visibility.
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    // On the document rather than on the panel: Escape must close the drawer even
    // if focus has ended up outside it.
    document.addEventListener('keydown', handleKeyDown)

    const target = panelRef.current?.querySelector(FOCUSABLE)
    if (target) target.focus({ preventScroll: true })

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (restoreFocusRef.current instanceof HTMLElement) restoreFocusRef.current.focus()
    }
  }, [mounted, onClose])

  if (!mounted || isDesktop) return null

  return createPortal(
    <div className={styles.root}>
      {/*
        The scrim. Labelled distinctly from the drawer's own close button so the
        two are not the same accessible name for a screen-reader user, and taken
        out of the tab order because Escape and the close button already cover the
        keyboard (§18.2).
      */}
      <button
        type="button"
        className={`${styles.backdrop} ${open ? styles.backdropOpen : ''}`.trim()}
        onClick={onClose}
        aria-label="Close navigation overlay"
        tabIndex={-1}
      />

      <div
        id="primary-navigation"
        ref={panelRef}
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <Sidebar variant="drawer" onNavigate={onClose} onClose={onClose} createActions={CREATE_ACTIONS} />
      </div>
    </div>,
    document.body,
  )
}
