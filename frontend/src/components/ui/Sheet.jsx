import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import styles from './Sheet.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Bottom sheet on small screens, centred dialog from `lg` up.
 *
 * Built here rather than pulled from a component library because §18.3 requires
 * the app's own focus, keyboard and motion behaviour, and because the same sheet
 * will host the client picker in Phase 4.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   title: string,
 *   description?: string,
 *   children?: import('react').ReactNode,
 *   footer?: import('react').ReactNode,
 *   size?: 'default' | 'wide',
 *   labelledById?: string,
 * }} props
 */
export default function Sheet({ open, onClose, title, description, children, footer, size = 'default' }) {
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      )
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
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return undefined
    restoreFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    if (panel) {
      const target = panel.querySelector(FOCUSABLE) || panel
      target.focus({ preventScroll: true })
    }
    return () => {
      document.body.style.overflow = previousOverflow
      if (restoreFocusRef.current instanceof HTMLElement) restoreFocusRef.current.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className={styles.root} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close menu"
        tabIndex={-1}
      />
      <div
        className={`${styles.panel} ${size === 'wide' ? styles.wide : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>{title}</h2>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
