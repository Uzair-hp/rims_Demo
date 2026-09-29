/**
 * Ruchita Interiors — printable document routes (§6, §14.2).
 *
 * Chrome-less by construction: these routes sit outside `AppShell` in the route
 * table, so no sidebar, bottom bar or top bar is mounted. What renders is the
 * `PrintToolbar` (hidden in the print stylesheet) above the `DocumentPaper`.
 *
 * Still authenticated — the backend enforces auth on `GET /quotations/:id`
 * regardless of the route guard (§16), and an unauthenticated visit here is
 * simply an error state rather than a document.
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { fetchQuotation } from '../api/endpoints/quotations.js'
import { useSettings } from '../features/settings/SettingsProvider.jsx'
import { statusLabel } from '../features/quotations/status.js'
import DocumentPaper from '../features/documents/DocumentPaper.jsx'
import PrintToolbar, { useAutoPrint } from '../features/documents/PrintToolbar.jsx'
import styles from './PrintQuotation.module.css'

/**
 * @param {{
 *   documentType?: 'quotation' | 'invoice',
 * }} props
 *
 * `documentType` is a parameter, not a hard-coded quotation screen, because
 * `/print/invoice/:id` is Phase 7 and shares this shell. Only the quotation
 * variant is routed today.
 */
export default function PrintQuotation({ documentType = 'quotation' }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { settings, logoSrc } = useSettings()

  const [doc, setDoc] = useState(null)
  const [state, setState] = useState('loading')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchQuotation(id)
      .then((quotation) => {
        if (cancelled) return
        setDoc(quotation)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // §14.2: `?autoprint=1` opens the print dialog on arrival.
  useAutoPrint(state === 'ready' && params.get('autoprint') === '1')

  /**
   * The `<h1>` for this route is the document's own title once it has loaded.
   * While loading, and if loading fails, the shell renders a matching heading so
   * every route in the table always has exactly one level-one heading — the
   * invariant `main.test.jsx` and `routes.test.jsx` both walk for. It is
   * `no-print`, so a paper never carries a heading that is not the document's.
   */
  const fallbackHeading = <h1 className={`${styles.statusHeading} no-print`}>Quotation</h1>

  if (state === 'error') {
    return (
      <div className={styles.page}>
        <PrintToolbar title="Quotation" backTo="/quotations" />
        {fallbackHeading}
        <p className={styles.message} role="alert">
          This quotation could not be loaded. It may have been deleted, or your session may have expired.{' '}
          <a href="/quotations" className={styles.link}>
            Back to quotations
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PrintToolbar
        title="Quotation"
        number={doc?.number}
        statusLabel={doc ? statusLabel(doc.status) : undefined}
        backTo={doc ? `/quotations/${doc.id}` : '/quotations'}
      />
      {state === 'loading' ? (
        <>
          {fallbackHeading}
          <p className={styles.loading}>Preparing the document…</p>
        </>
      ) : (
        <div className="print-full-bleed">
          <DocumentPaper document={doc} settings={settings} logoSrc={logoSrc} />
        </div>
      )}
      <p className={`${styles.hint} no-print`}>
        {documentType === 'quotation'
          ? 'Printing opens your browser dialog — choose "Save as PDF" to keep a copy.'
          : null}
      </p>
    </div>
  )
}
