/**
 * Ruchita Interiors — money formatting (§8.1).
 *
 * Amounts are stored and returned in paise; one rupee is 100 paise. These helpers
 * turn a paise integer into an Indian-grouped rupee string.
 *
 * Indian grouping (last 3 digits, then 2s) is implemented by hand rather than via
 * `Intl`, so the rendered string is deterministic across Node versions and matches
 * the assertions in `money.test.js`.
 */

const RUPEE = '\u{20B9}' // ₹

function groupIndian(rupees) {
  const s = String(rupees)
  if (s.length <= 3) return s

  const last3 = s.slice(-3)
  let rest = s.slice(0, -3)
  const groups = []
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  if (rest) groups.unshift(rest)
  return [...groups, last3].join(',')
}

export function formatPaise(paise) {
  if (paise == null || Number.isNaN(Number(paise))) return `${RUPEE}0.00`

  const value = Math.round(Number(paise))
  if (value === 0) return `${RUPEE}0.00`

  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const rupees = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}${RUPEE}${groupIndian(rupees)}.${String(remainder).padStart(2, '0')}`
}

/**
 * Parse a plain rupee string (as typed into a form field) into integer paise.
 * Accepts "500", "500.5", "500.50", "1,000.25"; anything unparseable → 0.
 * Rounds to the nearest paise so a stray third decimal never leaks through.
 *
 * @param {string | number | null | undefined} value
 * @returns {number} paise
 */
export function rupeesToPaise(value) {
  if (value == null || value === '') return 0
  const cleaned = String(value).replace(/,/g, '').trim()
  const rupees = Number(cleaned)
  if (Number.isNaN(rupees)) return 0
  return Math.round(rupees * 100)
}

/**
 * Render integer paise as a plain, ungrouped decimal string for a form field
 * ("50050" → "500.50"). No rupee sign, so it round-trips through `rupeesToPaise`.
 *
 * @param {number | null | undefined} paise
 * @returns {string}
 */
export function paiseToInput(paise) {
  if (paise == null || Number.isNaN(Number(paise)) || Number(paise) === 0) return ''
  const value = Math.round(Number(paise))
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
