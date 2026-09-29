/**
 * Ruchita Interiors — print / preview toolbar (§14.2).
 *
 * The controls that surround a document but never belong on it: Back, Print /
 * Save as PDF, and the document's own number and status for orientation (§20's
 * "the user always sees which document and what state it is in").
 *
 * Printing is delegated to the browser, not to a server-side renderer (D3): the
 * "Save as PDF" affordance is the browser's own print dialog, which is the only
 * pipeline that can reproduce this CSS pixel-for-pixel.
 *
 * Marked `no-print` so it is hidden in the print stylesheet — the whole toolbar
 * is a global class rather than a CSS-module class, because print.css cannot
 * address module-scoped names.
 *
 * @param {{
 *   number?: string,
 *   statusLabel?: string,
 *   backTo?: string,
 *   onBack?: () => void,
 *   title?: string,
 * }} props
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import styles from './PrintToolbar.module.css'

export default function PrintToolbar({ number, statusLabel, backTo, onBack, title = 'Document' }) {
  const navigate = useNavigate()

  return (
    <div className={`${styles.toolbar} no-print`}>
      <div className={styles.identity}>
        {backTo ? (
          <Button variant="ghost" size="sm" icon="chevronLeft" to={backTo}>
            Back
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack || (() => navigate(-1))}>
            Back
          </Button>
        )}
        <div className={styles.meta}>
          <span className={styles.title}>{title}</span>
          <span className={styles.docMeta}>
            {number ? <span className={styles.number}>{number}</span> : null}
            {statusLabel ? <span className={styles.status}>{statusLabel}</span> : null}
          </span>
        </div>
      </div>

      <Button variant="primary" size="sm" icon="printer" onClick={() => window.print()}>
        Print / Save as PDF
      </Button>
    </div>
  )
}

/**
 * Auto-open the print dialog when the route was reached with `?autoprint=1`
 * (§14.2). Used by the preview overlay's Print action, where the browser's print
 * dialog on a background tab is the one place a user would otherwise be stuck.
 *
 * Runs in an effect with a short delay: calling `window.print()` during the
 * first paint is dropped by Chromium, so the dialog would silently never appear.
 * Guarded so it fires at most once per mount.
 *
 * @param {boolean} enabled
 */
export function useAutoPrint(enabled) {
  useEffect(() => {
    if (!enabled) return undefined
    const handle = setTimeout(() => window.print(), 300)
    return () => clearTimeout(handle)
  }, [enabled])
}
