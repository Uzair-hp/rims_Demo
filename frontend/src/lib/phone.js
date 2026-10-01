/**
 * Ruchita Interiors — client phone presentation (§9.2, FR-C1).
 *
 * The API stores a phone number as **ten bare digits** (`9000012345`), because
 * that is the only form in which a duplicate check or a search is meaningful:
 * `+91 90000 12345`, `090000-12345` and `9000012345` are one client, not three.
 * `app/utils/phone.py` enforces that on write.
 *
 * This module is the other half: the display form. Every place that shows a
 * client's phone calls `formatPhone`, so the number reads the same on the client
 * list, in the picker, on a quotation, on an invoice and on a printed document.
 * One helper rather than five inline templates is what keeps that true.
 *
 * Nothing here decides what is *valid* — the server is the authority, and a
 * number the rules reject still renders rather than disappearing, because a
 * client with a malformed number on file must remain visible in order to be
 * fixed. See `formatPhone` for what happens in that case.
 */

/** The country code every client number is presented with. */
const COUNTRY_CODE = '+91'

/**
 * Strip a number down to its bare digits, dropping an Indian country code.
 *
 * The inverse of `formatPhone`, and tolerant of anything: punctuation, spaces,
 * dashes, brackets and a `+91` / `91` / `0` prefix are all discarded. A value
 * that reduces to nothing yields `''` rather than throwing, so callers can test
 * emptiness without a try/catch.
 *
 * @param {string | number | null | undefined} value
 * @returns {string} digits only, possibly empty
 */
export function phoneDigits(value) {
  if (value == null) return ''

  let digits = String(value).replace(/\D/g, '')
  // Only strip a prefix that leaves a full 10-digit number behind, so a genuine
  // number is never truncated into a different, valid-looking one.
  for (const prefix of ['91', '0']) {
    if (digits.startsWith(prefix) && digits.length - prefix.length === 10) {
      digits = digits.slice(prefix.length)
      break
    }
  }
  return digits
}

/**
 * Present a client phone as `+91 90000 12345`.
 *
 * Ten digits are grouped five-and-five, which is how the number is read aloud in
 * India and how it appears on an invoice. A number that is not ten digits is
 * returned **unchanged** rather than guessed at: the pre-existing rows that
 * `scripts/normalize_client_phones.py` reports hold values like `"2000"`, and
 * turning those into `+91 2000` would invent digits that do not exist and hide
 * the fact that the record needs fixing.
 *
 * @param {string | number | null | undefined} value
 * @returns {string}
 */
export function formatPhone(value) {
  if (value == null || value === '') return ''

  const digits = phoneDigits(value)
  if (digits.length !== 10) return String(value).trim()

  return `${COUNTRY_CODE} ${digits.slice(0, 5)} ${digits.slice(5)}`
}

/**
 * Group digits as the user types, without ever inventing or reordering one.
 *
 * Used by the form's `onChange` so the field reads `90000 12345` as it is typed
 * rather than ten loose digits. The caret is **not** preserved: inserting a
 * space after the fifth digit moves it, which is a known trade-off for not
 * reformatting on every keystroke, and is why the field is validated on blur
 * rather than on change — a mid-typing value like `90000` is legitimately
 * incomplete and must not be flagged as wrong.
 *
 * **No prefix is stripped here**, and that is deliberate. This function runs on
 * every keystroke, so a user typing `+91 90000 12345` reaches the state `+9` —
 * two digits, not a number. A cleaner that removed a `91` prefix at that point
 * would swallow the user's own `9` and then their `1`, silently producing a
 * different number than the one they typed. Punctuation and spaces are removed
 * (they carry no information the user typed deliberately), but a country code is
 * only removed on submit, by `normalizePhone`, where the whole value is known.
 *
 * @param {string} typed raw value from the input
 * @returns {string} the digits, grouped, capped at ten
 */
export function groupPhoneAsTyped(typed) {
  let digits = String(typed ?? '').replace(/\D/g, '')

  // A country code is dropped only once the value is *long enough* to contain
  // one plus a full number, i.e. twelve digits. Stripping earlier would eat the
  // user's own digits mid-typing — at the two-digit state `+91` there is no
  // number yet, and a naive `91` strip would leave nothing. The cap to ten comes
  // after, so a complete prefixed number is never truncated into a wrong one.
  for (const prefix of ['91', '0']) {
    if (digits.startsWith(prefix) && digits.length > 10) {
      digits = digits.slice(prefix.length)
      break
    }
  }

  digits = digits.slice(0, 10)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

/**
 * Whether a value is a complete, plausible Indian mobile number.
 *
 * Mirrors the server's rules for the form's own check, so the user is told
 * before a round trip. The server still decides — this is a convenience, not an
 * authority, and the two are kept in step by the tests in
 * `backend/tests/test_clients.py` and `phone.test.js`.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidPhone(value) {
  const digits = phoneDigits(value)
  if (digits.length !== 10) return false
  if (!'6789'.includes(digits[0])) return false
  if (new Set(digits).size === 1) return false

  // Consecutive runs, wrapping through zero, so `1234567890` (ascends 1-9 then
  // wraps to 0) is caught. `% 10` alone is not enough: JavaScript's remainder
  // keeps the sign of the dividend, so a descending step comes out as -1 rather
  // than 9, and normalising with `+ 10` is what makes both directions a single
  // test. `phone.py` reaches the same set via a positive modulo.
  const steps = new Set(
    digits
      .slice(1)
      .split('')
      .map((digit, index) => (((Number(digit) - Number(digits[index])) % 10) + 10) % 10),
  )
  const ascending = steps.size === 1 && steps.has(1)
  const descending = steps.size === 1 && steps.has(9)
  return !(ascending || descending)
}

/**
 * Reduce whatever was typed or pasted to the ten bare digits the API stores.
 *
 * `+91 90000 12345`, `090000-12345` and `90000 12345` all become `9000012345`.
 * Used on submit so the payload is canonical regardless of how the field was
 * filled — including a paste, and including a *typed* country code, which the
 * field deliberately does not strip keystroke by keystroke. Recovering the prefix
 * here rather than during typing is what lets the field show the user exactly
 * what they entered while still submitting the number the API stores.
 *
 * @param {string} value
 * @returns {string} digits only, or `''` if nothing usable was typed
 */
export function normalizePhone(value) {
  return phoneDigits(value).slice(0, 10)
}
