/**
 * Ruchita Interiors — Balance / Payment Due print route (§8.5, §14.2).
 *
 * Chrome-less by construction, like the other print routes: it sits outside
 * `AppShell`, so no sidebar or top bar mounts. What renders is the `PrintToolbar`
 * (hidden in the print stylesheet) above the `PaymentDuePaper`.
 *
 * The whole route is a **read**. It fetches `GET /invoices/:id/payment-due`, which
 * re-derives the balance from the payment ledger and writes nothing — no invoice
 * row, no payment row, no stored amount. So "generating" this document is
 * indistinguishable from viewing it, which is the point: a payment reminder that
 * could alter the ledger or add to revenue would be a financial bug, not a feature.
 *
 * The server refuses the request outright when the invoice is not issued (a draft has
 * not been billed, and a cancelled one must never produce a demand for money), so that
 * case is surfaced as an explanatory error rather than a blank sheet.
 *
 * A **fully paid** invoice is not an error: the server answers 200 with `fully_paid`, and
 * the paper renders as a settlement statement — the reconciliation, a FULLY PAID stamp,
 * and no QR or bank details, because there is nothing left to pay. That is the receipt a
 * customer asks for after paying, so the route shows it rather than apologising for it.
 *
 * Still authenticated — the backend enforces auth on every endpoint regardless of
 * the route guard (§16), and an unauthenticated visit is an error state, not a
 * document.
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { fetchPaymentDue } from '../api/endpoints/invoices.js'
import { useSettings } from '../features/settings/SettingsProvider.jsx'
import PaymentDuePaper from '../features/payments/PaymentDuePaper.jsx'
import PrintToolbar, { useAutoPrint } from '../features/documents/PrintToolbar.jsx'
import styles from './PrintQuotation.module.css'

export default function PrintPaymentDue() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { settings, logoSrc } = useSettings()

  const [doc, setDoc] = useState(null)
  const [state, setState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchPaymentDue(id)
      .then((payload) => {
        if (cancelled) return
        setDoc(payload)
        setState('ready')
      })
      .catch((error) => {
        if (cancelled) return
        // 422 carries a message worth showing: "cancelled" and "not issued" are both
        // ordinary reasons a user arrived here, not failures to report vaguely.
        setErrorMessage(error?.message || 'This balance document could not be generated.')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // §14.2: `?autoprint=1` opens the print dialog on arrival.
  useAutoPrint(state === 'ready' && params.get('autoprint') === '1')

  const title = 'Payment due'

  // One level-one heading per route, always — `routes.test.jsx` walks for this.
  // On success the document's own "PAYMENT DUE" title is the <h1>.
  const fallbackHeading = <h1 className={`${styles.statusHeading} no-print`}>{title}</h1>

  if (state === 'error') {
    return (
      <div className={styles.page}>
        <PrintToolbar title={title} backTo={`/invoices/${id}`} />
        {fallbackHeading}
        <p className={styles.message} role="alert">
          {errorMessage}{' '}
          <a href={`/invoices/${id}`} className={styles.link}>
            Back to the invoice
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
        number={doc?.source_invoice_number}
        statusLabel={doc ? (doc.fully_paid ? 'Fully paid' : `Due ${doc.upi_amount}`) : undefined}
        backTo={`/invoices/${id}`}
      />
      {state === 'loading' ? (
        <>
          {fallbackHeading}
          <p className={styles.loading}>Preparing the document…</p>
        </>
      ) : (
        <div className="print-full-bleed">
          <PaymentDuePaper doc={doc} settings={settings} logoSrc={logoSrc} />
        </div>
      )}
      <p className={`${styles.hint} no-print`}>
        This document is a reminder for an existing invoice, not a new one. Printing opens your browser dialog
        &mdash; choose &ldquo;Save as PDF&rdquo; to keep a copy.
      </p>
    </div>
  )
}
