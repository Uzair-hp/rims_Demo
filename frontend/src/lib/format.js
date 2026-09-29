/**
 * Ruchita Interiors — date formatting (§8.1).
 *
 * `DD MMM YYYY` for tables, strips and audit lines. A null, empty or unparseable
 * value renders as the empty string so a missing date never becomes "Invalid Date"
 * in the UI.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(value) {
  if (!value) return ''

  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''

  const day = String(d.getDate()).padStart(2, '0')
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
