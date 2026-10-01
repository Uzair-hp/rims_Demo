import { describe, expect, it } from 'vitest'
import { formatPhone, groupPhoneAsTyped, isValidPhone, normalizePhone, phoneDigits } from './phone.js'

/**
 * Client phone presentation (§9.2, FR-C1).
 *
 * The point of these tests is that the stored value and the displayed value are
 * deliberately different: the API keeps ten bare digits, the screen shows
 * `+91 90000 12345`, and the boundary between them is this module. The accepted
 * and rejected number sets mirror `backend/tests/test_clients.py` exactly — the
 * two are a pair, and if they ever drift the form would accept something the API
 * refuses, or refuse something it accepts.
 */

describe('phoneDigits', () => {
  it('keeps digits and discards punctuation', () => {
    expect(phoneDigits('9000012345')).toBe('9000012345')
    expect(phoneDigits('+91 90000 12345')).toBe('9000012345')
    expect(phoneDigits('090000-12345')).toBe('9000012345')
    expect(phoneDigits('+91-90000-12345')).toBe('9000012345')
  })

  it('drops a country code only when ten digits remain', () => {
    // The `+91` case: stripping it leaves a full number.
    expect(phoneDigits('919000012345')).toBe('9000012345')
    // Eleven digits is not a `+91` prefix plus a number, so nothing is stripped
    // and the value is not silently truncated into a different valid one.
    expect(phoneDigits('91900001234')).toBe('91900001234')
  })

  it('is empty for nothing rather than throwing', () => {
    expect(phoneDigits('')).toBe('')
    expect(phoneDigits(null)).toBe('')
    expect(phoneDigits(undefined)).toBe('')
    expect(phoneDigits('abcdefghij')).toBe('')
  })
})

describe('formatPhone', () => {
  it('presents a stored number as +91 90000 12345', () => {
    expect(formatPhone('9000012345')).toBe('+91 90000 12345')
  })

  it('is idempotent, so a formatted value can be formatted again', () => {
    // Documents receive an already-formatted number from some sources; running
    // it through twice must not produce "+91 +91 90000 12345".
    expect(formatPhone(formatPhone('9000012345'))).toBe('+91 90000 12345')
  })

  it('leaves a malformed stored value untouched rather than inventing digits', () => {
    // These are the real pre-existing rows. Formatting "2000" as "+91 2000"
    // would fabricate digits and hide that the record needs fixing.
    expect(formatPhone('2000')).toBe('2000')
    expect(formatPhone('000000')).toBe('000000')
    expect(formatPhone('900000000')).toBe('900000000')
  })

  it('renders nothing for an absent number', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})

describe('groupPhoneAsTyped', () => {
  it('leaves an incomplete number ungrouped while it is being typed', () => {
    expect(groupPhoneAsTyped('9')).toBe('9')
    expect(groupPhoneAsTyped('90000')).toBe('90000')
  })

  it('groups five and five once the number is long enough', () => {
    expect(groupPhoneAsTyped('900001')).toBe('90000 1')
    expect(groupPhoneAsTyped('9000012345')).toBe('90000 12345')
  })

  it('cleans a pasted value and caps it at ten digits', () => {
    // `groupPhoneAsTyped` itself keeps a country code — see the next test. A
    // *paste* is cleaned by the form, which calls `phoneDigits` first because a
    // pasted value is complete and has no mid-typing state to protect.
    expect(groupPhoneAsTyped(phoneDigits('+91 90000 12345'))).toBe('90000 12345')
    expect(groupPhoneAsTyped(phoneDigits('090000-12345'))).toBe('90000 12345')
    expect(groupPhoneAsTyped('9000012345678')).toBe('90000 12345')
  })

  /**
   * The regression this function's no-prefix rule exists for.
   *
   * It runs on every keystroke, so typing `+91 90000 12345` passes through the
   * two-digit state `+9` and then `+91`. A cleaner that removed a `91` prefix at
   * that point would swallow the user's own digits and produce a number they
   * never typed — silently, with no way to notice.
   */
  it('does not strip a country code while the number is being typed', () => {
    // Mid-typing states must pass through untouched.
    expect(groupPhoneAsTyped('+')).toBe('')
    expect(groupPhoneAsTyped('+9')).toBe('9')
    expect(groupPhoneAsTyped('+91')).toBe('91')
    expect(groupPhoneAsTyped('+919')).toBe('919')
  })
})

describe('isValidPhone', () => {
  it('accepts ordinary numbers', () => {
    expect(isValidPhone('9000012345')).toBe(true)
    expect(isValidPhone('+91 90000 12345')).toBe(true)
    expect(isValidPhone('090000-12345')).toBe(true)
    expect(isValidPhone('6123456789')).toBe(true)
    expect(isValidPhone('7987654321')).toBe(true)
  })

  it('rejects the same junk the server rejects', () => {
    expect(isValidPhone('2000')).toBe(false)
    expect(isValidPhone('000000')).toBe(false)
    expect(isValidPhone('5000012345')).toBe(false)
    expect(isValidPhone('9999999999')).toBe(false)
    expect(isValidPhone('1234567890')).toBe(false)
    expect(isValidPhone('9876543210')).toBe(false)
    expect(isValidPhone('')).toBe(false)
    expect(isValidPhone('abcdefghij')).toBe(false)
  })
})

describe('normalizePhone', () => {
  it('reduces any accepted form to the ten stored digits', () => {
    expect(normalizePhone('+91 90000 12345')).toBe('9000012345')
    expect(normalizePhone('090000-12345')).toBe('9000012345')
    expect(normalizePhone('90000 12345')).toBe('9000012345')
    expect(normalizePhone('9000012345')).toBe('9000012345')
  })
})
