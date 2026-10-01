/**
 * Ruchita Interiors — UPI payment card (§8.5).
 *
 * The on-screen "Scan to Pay" surface, shared by the invoice detail page and the
 * Balance / Payment Due print document. The QR is **generated from a UPI intent
 * URI** built for the amount passed in, so it always asks for exactly the figure
 * shown directly above it — the two come from one `amountPaise` prop and one
 * `formatUpiAmount` call, and there is no second formatting path that could drift.
 *
 * What this component is *not* is a payment confirmation. Scanning the code opens the
 * payer's UPI app; it tells this application nothing. `payment_status` stays derived
 * from the payment ledger (§11) and only moves when someone records a payment
 * through the Record Payment flow. That is why the card never says "paid" and shows
 * no success state: it cannot know.
 *
 * Degradation, in order, because each failure is normal rather than exceptional:
 * 1. No UPI ID configured → no QR; the card is not rendered by the caller at all.
 * 2. A UPI ID the builder rejects (no "@", non-positive amount) → the ID is still
 *    shown as text, so a customer can type it into their own app. A broken QR that
 *    opens an app asking for ₹0 is worse than no QR.
 * 3. The encoder itself fails → the same text-only fallback, plus a quiet note.
 *
 * "Open UPI app" is offered only where it can plausibly work (`canOpenUpiApp`), and
 * is never presented as universal. The QR remains the primary path, because it works
 * on every device that has a camera, including the desktop this returns false for.
 *
 * ## Two variants, and why the print one is styled here
 *
 * `variant="print"` is the compact form the A4 documents use. Its rules live in
 * **this** module, as `.card[data-variant='print']`, not as overrides in a parent.
 *
 * That is not a stylistic preference. CSS Modules hashes class names per file, so a
 * descendant selector written in another module - `.bankQr .card` in
 * `DocumentPaper.module.css`, `.qrCard .actions` in `PaymentDuePaper.module.css` -
 * compiles to `._bankQr_<parentHash> ._card_<parentHash>`, which can never match an
 * element carrying *this* module's hash. Those rules were written, shipped, and
 * silently matched nothing: both printed documents have been rendering the full
 * screen card, gold buttons and disclaimer paragraph included, which is why the QR
 * read as a separate document dominating the page. A variant styled in its own
 * module cannot fail that way, and `data-variant` gives the tests a stable hook.
 *
 * Print drops the buttons and the disclaimer (nobody taps paper, and that copy
 * explains a screen interaction), the display-serif title and the oversized amount
 * (the sheet's own totals block already carries the money figures at the sizes
 * 14.3 specifies), and the card chrome so the block sits on the page. Print keeps
 * the code, the VPA as text for a customer without a scanner, the amount, and the
 * verification note.
 */

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { buildUpiUri, canOpenUpiApp, copyToClipboard } from '../../lib/upi.js'
import { formatPaise } from '../../lib/money.js'
import styles from './UpiQrCard.module.css'

/**
 * @param {object} props
 * @param {number} props.amountPaise    Amount to collect, in integer paise.
 * @param {string} props.vpa            Configured UPI ID. Empty disables the QR.
 * @param {string} [props.payeeName]    Business name shown in the payer's app.
 * @param {string} [props.note]         Transaction note, e.g. the invoice number.
 * @param {string} [props.title]        Card heading. Defaults to "Scan to Pay".
 * @param {number} [props.size]         Rendered QR edge length in CSS pixels.
 * @param {string} [props.className]    Extra class for layout.
 * @param {'screen' | 'print'} [props.variant]
 */
export default function UpiQrCard({
  amountPaise,
  vpa,
  payeeName = '',
  note = '',
  title = 'Scan to Pay',
  size = 220,
  className = '',
  variant = 'screen',
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimer = useRef(null)

  // The server already produced the URI for the payment-due document, but the
  // invoice detail page has no such payload, so it is rebuilt here from the same
  // helper. Both paths therefore encode identically.
  const uri = buildUpiUri({ vpa, payeeName, amountPaise, note })

  // The encoded image is stored **keyed by the URI it was made from**, rather than
  // as a bare string. That is what lets the card avoid the usual
  // `setState(null)`-then-encode dance: when the amount changes the key no longer
  // matches, so `dataUrl` reads as null on that render and the previous code is
  // discarded without ever being cleared. Only the new encode writes state, and it
  // does so from a promise callback, not synchronously inside the effect.
  const [encoded, setEncoded] = useState({ uri: null, url: null })
  const dataUrl = encoded.uri === uri ? encoded.url : null

  useEffect(() => {
    if (!uri) return undefined
    let cancelled = false

    // Rendered at a higher resolution than it is displayed, so the code stays sharp
    // when printed and when the page is zoomed. `margin: 0` drops QRCode's built-in
    // quiet zone, which this card replaces with its own padding.
    QRCode.toDataURL(uri, {
      width: Math.max(size, 220) * 2,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#1d1b16', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setEncoded({ uri, url })
      })
      .catch(() => {
        // A text-only fallback beats a broken image: the UPI ID below is still
        // payable by hand.
        if (!cancelled) setEncoded({ uri, url: null })
      })

    return () => {
      cancelled = true
    }
  }, [uri, size])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const handleCopy = async () => {
    const ok = await copyToClipboard(vpa)
    setCopyFailed(!ok)
    setCopied(ok)
    clearTimeout(copyTimer.current)
    if (ok) {
      copyTimer.current = setTimeout(() => setCopied(false), 2500)
    }
  }

  if (!vpa) return null

  return (
    <section
      className={`${styles.card} ${className}`}
      data-upi-qr
      data-variant={variant}
      aria-label="Payment by UPI"
    >
      {variant === 'print' ? null : <h3 className={styles.title}>{title}</h3>}

      <div className={styles.body}>
        <div className={styles.qrColumn}>
          {dataUrl ? (
            <img
              className={styles.qr}
              src={dataUrl}
              style={{ inlineSize: `${size}px`, blockSize: `${size}px` }}
              alt={`UPI QR code to pay ${formatPaise(amountPaise)}`}
              width={size}
              height={size}
            />
          ) : (
            <div className={styles.qrFallback} style={{ inlineSize: `${size}px`, blockSize: `${size}px` }}>
              <p className={styles.fallbackText}>
                {uri
                  ? 'The QR code could not be generated.'
                  : 'This UPI ID is not in a usable format, so no QR code can be made from it.'}
              </p>
            </div>
          )}
        </div>

        <div className={styles.details}>
          <p className={styles.amount}>{formatPaise(amountPaise)}</p>
          {payeeName ? <p className={styles.payee}>{payeeName}</p> : null}
          <p className={styles.vpa}>{vpa}</p>
          {note ? <p className={styles.note}>Ref {note}</p> : null}
        </div>
      </div>

      {/* Interactive chrome is screen-only. On paper a button is dead weight and the
          disclaimer is copy about a screen interaction, so print renders neither -
          and a 44px touch target is a large share of a compact payment block. */}
      {variant === 'print' ? null : (
        <>
          <div className={styles.actions}>
            {canOpenUpiApp() && uri ? (
              <a className={styles.openApp} href={uri}>
                Open UPI app
              </a>
            ) : null}
            <button type="button" className={styles.copyButton} onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy UPI ID'}
            </button>
          </div>

          {copyFailed ? (
            <p className={styles.copyNote} role="status">
              Could not copy automatically — select the UPI ID above and copy it manually.
            </p>
          ) : null}

          <p className={styles.disclaimer}>
            Scanning opens your UPI app with this amount filled in. It does not record a payment here — record
            it once the money actually arrives.
          </p>
        </>
      )}
    </section>
  )
}
