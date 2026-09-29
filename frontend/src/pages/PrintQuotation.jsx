/**
 * Ruchita Interiors — printable document routes (§6, §14.2).
 *
 * Chrome-less by construction: these routes sit outside `AppShell` in the route
 * table, so no sidebar, bottom bar or top bar is mounted. What renders is the
 * `PrintToolbar` (hidden in the print stylesheet) above the `DocumentPaper`.
 *
 * Both document kinds share this shell; `documentType` decides which payload is
 * fetched and which `docKind` the sheet renders. The document differs (issue and
 * due dates, amount paid, balance due, bank details) but the layout is one
 * component, so the two can never drift apart.
 *
 * Still authenticated — the backend enforces auth on every endpoint regardless
 * of the route guard (§16), and an unauthenticated visit is an error state rather
 * than a document.
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { fetchInvoice } from '../api/endpoints/invoices.js'
import { fetchQuotation } from '../api/endpoints/quotations.js'
import { useSettings } from '../features/settings/SettingsProvider.jsx'
import { invoiceStatusLabel, paymentStatusLabel } from '../features/invoices/status.js'
import { statusLabel } from '../features/quotations/status.js'
import DocumentPaper from '../features/documents/DocumentPaper.jsx'
import PrintToolbar, { useAutoPrint } from '../features/documents/PrintToolbar.jsx'
import styles from './PrintQuotation.module.css'

/**
 * @param {{ documentType?: 'quotation' | 'invoice' }} props
 */
export default function PrintQuotation({ documentType = 'quotation' }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { settings, logoSrc } = useSettings()

  const isInvoice = documentType === 'invoice'
  const [doc, setDoc] = useState(null)
  const [state, setState] = useState('loading')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setState('loading')
    const load = isInvoice ? fetchInvoice(id) : fetchQuotation(id)
    load
      .then((document_) => {
        if (cancelled) return
        setDoc(document_)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [id, isInvoice])
  /* eslint-enable react-hooks/set-state-in-effect */

  // §14.2: `?autoprint=1` opens the print dialog on arrival.
  useAutoPrint(state === 'ready' && params.get('autoprint') === '1')

  const title = isInvoice ? 'Invoice' : 'Quotation'
  const listPath = isInvoice ? '/invoices' : '/quotations'

  // An invoice shows its payment status, which is what the user is checking.
  const statusText = isInvoice
    ? doc
      ? `${invoiceStatusLabel(doc.status)} · ${paymentStatusLabel(doc.payment_status)}`
      : undefined
    : doc
      ? statusLabel(doc.status)
      : undefined

  /**
   * The `<h1>` for this route is the document's own title once it has loaded.
   * While loading, and if loading fails, the shell renders a matching heading so
   * every route in the table always has exactly one level-one heading — the
   * invariant `main.test.jsx` and `routes.test.jsx` both walk for. It is
   * `no-print`, so a paper never carries a heading that is not the document's.
   */
  const fallbackHeading = <h1 className={`${styles.statusHeading} no-print`}>{title}</h1>

  if (state === 'error') {
    return (
      <div className={styles.page}>
        <PrintToolbar title={title} backTo={listPath} />
        {fallbackHeading}
        <p className={styles.message} role="alert">
          This {title.toLowerCase()} could not be loaded. It may have been deleted, or your session may have
          expired.{' '}
          <a href={listPath} className={styles.link}>
            Back to {title.toLowerCase()}s
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PrintToolbar
        title={title}
        number={doc?.number}
        statusLabel={statusText}
        backTo={doc ? `${listPath}/${doc.id}` : listPath}
      />
      {state === 'loading' ? (
        <>
          {fallbackHeading}
          <p className={styles.loading}>Preparing the document…</p>
        </>
      ) : (
        <div className="print-full-bleed">
          <DocumentPaper document={doc} settings={settings} logoSrc={logoSrc} docKind={documentType} />
        </div>
      )}
      <p className={`${styles.hint} no-print`}>
        Printing opens your browser dialog &mdash; choose &ldquo;Save as PDF&rdquo; to keep a copy.
      </p>
    </div>
  )
}
