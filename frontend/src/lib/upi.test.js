/**
 * UPI intent URI tests (§8.5).
 *
 * Pure functions, so these need no rendering and no mocks — which is the point of
 * keeping the URI builder in `lib/upi.js` rather than inside the QR component. Two
 * properties are worth their own cases because failing either is a real money bug:
 *
 * - **The encoded amount is exact.** `am` is built with integer division, so a value
 *   that is not exactly representable in binary floating point (600050 paise) cannot
 *   come out as "6000.499999999999". A QR that asks for a fraction of a paisa less
 *   than the invoice is not a cosmetic bug.
 * - **A URI that cannot be satisfied is never built.** A missing or malformed VPA and
 *   a non-positive amount all return `null`, so the card shows the UPI ID as text
 *   instead of a code that opens a payment app asking for nothing.
 */

import { describe, expect, it } from 'vitest'
import { buildUpiUri, canOpenUpiApp, copyToClipboard, formatUpiAmount } from './upi.js'

/**
 * Pull one parameter out of a built URI, decoded.
 *
 * Uses `URLSearchParams` on the query rather than a hand-rolled regex: `pa` contains
 * an encoded "@" (`%40`), and matching `[^&]*` against the raw string then decoding
 * is a second, subtly different implementation of the parse under test. Reading the
 * real parser keeps the assertion honest.
 */
function param(uri, key) {
  return new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get(key)
}

describe('formatUpiAmount', () => {
  it('renders paise as a plain two-decimal string', () => {
    expect(formatUpiAmount(100)).toBe('1.00')
    expect(formatUpiAmount(1050)).toBe('10.50')
    expect(formatUpiAmount(600050)).toBe('6000.50')
    expect(formatUpiAmount(10000000)).toBe('100000.00')
  })

  it('is exact for amounts that floating point cannot represent', () => {
    // 0.1 + 0.2 territory: paise/100 in JS would give 6000.499999999999.
    expect(formatUpiAmount(600050)).toBe('6000.50')
    expect(formatUpiAmount(1)).toBe('0.01')
    expect(formatUpiAmount(9)).toBe('0.09')
  })

  it('clamps non-positive and unusable values to zero', () => {
    expect(formatUpiAmount(0)).toBe('0.00')
    expect(formatUpiAmount(-500)).toBe('0.00')
    expect(formatUpiAmount(null)).toBe('0.00')
    expect(formatUpiAmount(undefined)).toBe('0.00')
    expect(formatUpiAmount(NaN)).toBe('0.00')
  })
})

describe('buildUpiUri', () => {
  const vpa = 'ruchitainteriors@upi'

  it('builds an upi://pay intent with the four required parameters', () => {
    const uri = buildUpiUri({ vpa, payeeName: 'Ruchita Interiors', amountPaise: 6000000 })

    expect(uri.startsWith('upi://pay?')).toBe(true)
    expect(param(uri, 'pa')).toBe(vpa)
    expect(param(uri, 'pn')).toBe('Ruchita Interiors')
    expect(param(uri, 'am')).toBe('60000.00')
    expect(param(uri, 'cu')).toBe('INR')
  })

  it('encodes the amount as the exact balance, not the invoice total', () => {
    const full = buildUpiUri({ vpa, amountPaise: 10000000 })
    const afterPartial = buildUpiUri({ vpa, amountPaise: 6000000 })

    expect(param(full, 'am')).toBe('100000.00')
    expect(param(afterPartial, 'am')).toBe('60000.00')
  })

  it('includes the note so a payer can match the payment to the invoice', () => {
    const uri = buildUpiUri({ vpa, amountPaise: 100000, note: 'INV-2026-0001' })
    expect(param(uri, 'tn')).toBe('INV-2026-0001')
  })

  it('percent-encodes spaces and separators in the payee name', () => {
    const uri = buildUpiUri({ vpa, payeeName: 'Ruchita & Co / M/s', amountPaise: 100000 })

    expect(param(uri, 'pn')).toBe('Ruchita & Co / M/s')
    // The raw query must not contain a literal space or an unescaped ampersand,
    // either of which would truncate the URI at the first UPI app's parser.
    expect(uri).not.toMatch(/[ ]/)
    expect(uri.split('&').length).toBeGreaterThan(2)
  })

  it('falls back to a generic payee name rather than sending an empty one', () => {
    expect(param(buildUpiUri({ vpa, amountPaise: 100000 }), 'pn')).toBe('Merchant')
    expect(param(buildUpiUri({ vpa, payeeName: '   ', amountPaise: 100000 }), 'pn')).toBe('Merchant')
  })

  it('collapses whitespace and strips control characters from parameters', () => {
    const uri = buildUpiUri({ vpa: `ruchita${String.fromCharCode(7)}interiors@upi`, amountPaise: 100000 })
    expect(param(uri, 'pa')).toBe('ruchita interiors@upi')
  })

  it('truncates an over-long note rather than shrinking the QR to fit it', () => {
    const uri = buildUpiUri({ vpa, amountPaise: 100000, note: 'x'.repeat(200) })
    expect(param(uri, 'tn').length).toBe(64)
  })

  it('refuses to build a URI without a usable VPA', () => {
    expect(buildUpiUri({ vpa: '', amountPaise: 100000 })).toBeNull()
    expect(buildUpiUri({ vpa: null, amountPaise: 100000 })).toBeNull()
    expect(buildUpiUri({ vpa: 'not-a-vpa', amountPaise: 100000 })).toBeNull()
    expect(buildUpiUri({ amountPaise: 100000 })).toBeNull()
  })

  it('refuses to build a URI for a non-positive amount', () => {
    // A QR asking for ₹0 opens a payment app that looks broken to a customer, so
    // the caller gets null and can fall back to showing the UPI ID as text.
    expect(buildUpiUri({ vpa, amountPaise: 0 })).toBeNull()
    expect(buildUpiUri({ vpa, amountPaise: -100 })).toBeNull()
    expect(buildUpiUri({ vpa, amountPaise: null })).toBeNull()
  })

  it('accepts any provider suffix, because the set is not closed', () => {
    for (const address of ['name@okaxis', 'name@paytm', 'name@ybl', '6011@mobikwik', 'name@oksbi']) {
      expect(param(buildUpiUri({ vpa: address, amountPaise: 100000 }), 'pa')).toBe(address)
    }
  })
})

describe('canOpenUpiApp', () => {
  it('is false where there is no upi:// handler, and the QR stays the primary path', () => {
    // jsdom's default UA is a desktop agent, which is exactly the case the QR is
    // there for. The button must not claim to work here.
    expect(canOpenUpiApp()).toBe(false)
  })
})

describe('copyToClipboard', () => {
  it('resolves false for empty text rather than copying nothing', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false)
    await expect(copyToClipboard(null)).resolves.toBe(false)
  })

  it('resolves false instead of throwing when no clipboard is available', async () => {
    // No async Clipboard API in jsdom, and `execCommand` is absent, so this is the
    // fully-unavailable path. A rejected promise here would surface as an unhandled
    // rejection in the card's click handler.
    await expect(copyToClipboard('ruchitainteriors@upi')).resolves.toBe(false)
  })
})
