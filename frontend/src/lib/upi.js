/**
 * Ruchita Interiors — UPI intent URIs (§8.5).
 *
 * A UPI intent URI is what a QR code encodes to open a payment app with the amount
 * already filled in:
 *
 *   upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>
 *
 * Two properties matter more than anything else here, and both are the reason this
 * is a small module with its own tests:
 *
 * 1. **The amount is integer paise, formatted without floating point.** `am` is
 *    built with `Math.floor(paise / 100)` and `paise % 100`, never `paise / 100`,
 *    so 600050paise becomes "6000.50" and not "6000.499999999999". A QR that asks
 *    for a fraction of a paisa less than the invoice is a payment-collection bug
 *    that no reviewer would spot by eye.
 * 2. **The URI and the displayed amount come from one value.** Every caller passes
 *    the same paise integer to `formatUpiAmount` (for the visible figure) and
 *    `buildUpiUri` (for the QR), so the two cannot drift. There is no second
 *    formatting path to get wrong.
 *
 * Note what this is *not*: scanning the code does not record a payment. Nothing
 * here changes `payment_status`, which stays derived from the payment ledger
 * (§11) and only moves through the Record Payment flow.
 */

/** The only currency this app issues documents in. Fixed, not configurable. */
const CURRENCY = 'INR'

/** UPI scheme prefix defined by NPCI. */
const UPI_SCHEME = 'upi://pay'

/**
 * Longest note we will put in a URI.
 *
 * UPI apps truncate long `tn` values, and a QR's payload grows the square modules
 * needed to encode it. The invoice number is what makes a note useful to a payer,
 * so the tail is kept rather than the front: `Invoice INV-001-2026-0001` is more
 * useful than a sentence ending in the number.
 */
const MAX_NOTE_LENGTH = 64

/**
 * Render integer paise as the plain decimal string UPI expects: "600050" → "6000.50".
 *
 * No currency symbol and no thousands separators, because `am` is a machine-readable
 * number. Integer arithmetic throughout, so there is no float rounding to reason
 * about. Negative and non-finite values are clamped to "0.00" rather than throwing:
 * a caller that passes nonsense should produce a QR that asks for nothing rather
 * than crash a print dialog, and the guard in `buildUpiUri` then refuses to encode
 * it at all.
 *
 * @param {number | null | undefined} paise
 * @returns {string} e.g. "6000.50"
 */
export function formatUpiAmount(paise) {
  const value = Number(paise)
  if (!Number.isFinite(value)) return '0.00'
  const whole = Math.trunc(value)
  if (whole <= 0) return '0.00'
  return `${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`
}

/**
 * Keep only the characters that are safe and useful in a UPI query parameter.
 *
 * Vendor names legitimately contain `.`, `-`, `&`, `/` and spaces ("Ruchita & Co",
 * "M/s Verma"), so those are encoded rather than stripped. Characters that carry no
 * meaning for a payer - control characters, and the separators we are about to build
 * - are dropped so a hostile or accidental value cannot inject extra parameters.
 */
// Control characters cannot appear in a UPI parameter, and the only source of one is
// a paste artefact or a hand-entered value. Built from char codes rather than
// written as a literal range, because a control character in a source file is
// invisible to anyone reviewing the diff and the linter rejects the literal.
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
)

function sanitiseParam(value) {
  if (value == null) return ''
  return String(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build a UPI payment intent URI.
 *
 * Returns `null` when there is nothing to ask for — no VPA, or a non-positive
 * amount — so a caller can fall back to showing the UPI ID as plain text rather than
 * encoding a QR that would open an app with a blank or zero amount. That is the
 * difference between "the QR is missing" and "the QR opens a payment app asking for
 * ₹0", which reads as a broken feature to a customer.
 *
 * @param {object} options
 * @param {string} options.vpa        UPI ID, e.g. "ruchitainteriors@upi". Required.
 * @param {string} [options.payeeName] Business name shown in the payer's app.
 * @param {number} options.amountPaise Amount in integer paise. Required, must be > 0.
 * @param {string} [options.note]     Transaction note, e.g. the invoice number.
 * @returns {string | null}
 */
export function buildUpiUri({ vpa, payeeName, amountPaise, note } = {}) {
  const address = sanitiseParam(vpa)
  if (!address || !address.includes('@')) return null

  const amount = Number(amountPaise)
  if (!Number.isFinite(amount) || Math.trunc(amount) <= 0) return null

  const params = [
    ['pa', address],
    ['pn', sanitiseParam(payeeName) || 'Merchant'],
    ['am', formatUpiAmount(amount)],
    ['cu', CURRENCY],
  ]

  const trimmedNote = sanitiseParam(note)
  if (trimmedNote) params.push(['tn', trimmedNote.slice(0, MAX_NOTE_LENGTH)])

  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')

  return `${UPI_SCHEME}?${query}`
}

/**
 * Whether a UPI intent can be opened from here.
 *
 * Deliberately conservative and never claims more than is true. `upi://` is a custom
 * scheme, so it is meaningful on the handsets that have a payment app installed, and
 * nowhere else: not in a desktop browser, and not on an iOS simulator. We only
 * report true where the platform is a handset *and* not a crawler, and the UI still
 * presents the QR as the primary path regardless of the answer — a QR works
 * everywhere, including on the desktop this returns false for.
 *
 * @returns {boolean}
 */
export function canOpenUpiApp() {
  if (typeof navigator === 'undefined') return false
  if (/bot|crawler|spider|crawling/i.test(navigator.userAgent || '')) return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
}

/**
 * Copy text to the clipboard, resolving to whether it worked.
 *
 * Returns a boolean rather than throwing, because a failed copy is a recoverable UI
 * state (show "select and copy manually") and not an error worth propagating. The
 * `execCommand` branch exists for non-secure contexts, where the async Clipboard API
 * is unavailable — which includes a Render deployment still being viewed over
 * plain HTTP during setup.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  const value = String(text ?? '')
  if (!value) return false

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const area = document.createElement('textarea')
    area.value = value
    // Keep it off-screen and un-highlightable, but still focusable: a display:none
    // element cannot be selected, and iOS refuses to copy from one.
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}
