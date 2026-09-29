/**
 * Ruchita Interiors — quotation/invoice calculation mirror (§10).
 *
 * A DISPLAY-ONLY mirror of `backend/app/services/calculations.py`. The backend
 * is the calculation authority; this exists so the editor can show live totals
 * as the user types without a round trip. Every persisted total still comes from
 * the server response — never trust these numbers for storage.
 *
 * All arithmetic is integer, matching the backend exactly:
 * - paise for amounts (1 rupee = 100 paise)
 * - milli-units for quantities (1 unit = 1000 milli-units)
 * - basis points for percentages (1% = 100 bp)
 *
 * BigInt is used for the multiply/divide steps so a large `qty × rate` can't lose
 * precision above `Number.MAX_SAFE_INTEGER`; results are returned as Numbers,
 * which comfortably hold any realistic paise total.
 */

const GST_MAX_BP = 2800

/**
 * Parse a quantity string (natural units, e.g. "1.5") into milli-units (1500).
 * Rounds to the nearest milli-unit; unparseable → 0.
 * @param {string | number | null | undefined} value
 * @returns {number} milli-units
 */
export function unitsToMilli(value) {
  if (value == null || value === '') return 0
  const units = Number(String(value).replace(/,/g, '').trim())
  if (Number.isNaN(units)) return 0
  return Math.round(units * 1000)
}

/**
 * Render milli-units as a plain unit string for a form field ("1500" → "1.5").
 * Trailing zeros are trimmed so whole quantities show as "2", not "2.000".
 * @param {number | null | undefined} milli
 * @returns {string}
 */
export function milliToInput(milli) {
  if (milli == null || Number.isNaN(Number(milli)) || Number(milli) === 0) return ''
  const value = Number(milli) / 1000
  return String(Number(value.toFixed(3)))
}

/**
 * Half-up rounding of `num / den` for non-negative integers.
 * Denominators here (1000, 10000) are even, so `den / 2` is exact.
 * @param {bigint} num
 * @param {bigint} den
 * @returns {bigint}
 */
function roundHalfUp(num, den) {
  if (den === 0n) return 0n
  return (num + den / 2n) / den
}

/**
 * line_total_paise = round_half_up(qty_milli × rate_paise / 1000)
 * @param {number} qtyMilli
 * @param {number} ratePaise
 * @returns {number}
 */
export function calcLineTotal(qtyMilli, ratePaise) {
  const qty = BigInt(Math.max(0, Math.trunc(qtyMilli || 0)))
  const rate = BigInt(Math.max(0, Math.trunc(ratePaise || 0)))
  return Number(roundHalfUp(qty * rate, 1000n))
}

/**
 * discount_paise:
 *   percent → round_half_up(subtotal × discount_bp / 10000)
 *   fixed   → min(discount_fixed_paise, subtotal)  (server rejects > subtotal;
 *             we clamp for display so the live preview never shows a negative taxable)
 * @param {number} subtotalPaise
 * @param {'percent' | 'fixed'} discountType
 * @param {number | null | undefined} discountBp
 * @param {number | null | undefined} discountFixedPaise
 * @returns {number}
 */
export function calcDiscount(subtotalPaise, discountType, discountBp, discountFixedPaise) {
  const subtotal = Math.max(0, Math.trunc(subtotalPaise || 0))
  if (discountType === 'fixed') {
    const fixed = Math.max(0, Math.trunc(discountFixedPaise || 0))
    return Math.min(fixed, subtotal)
  }
  const bp = Math.max(0, Math.trunc(discountBp || 0))
  return Number(roundHalfUp(BigInt(subtotal) * BigInt(bp), 10000n))
}

/**
 * gst_paise = round_half_up(taxable_paise × gst_bp / 10000)
 * @param {number} taxablePaise
 * @param {number} gstBp
 * @returns {number}
 */
export function calcGst(taxablePaise, gstBp) {
  const taxable = Math.max(0, Math.trunc(taxablePaise || 0))
  const bp = Math.min(GST_MAX_BP, Math.max(0, Math.trunc(gstBp || 0)))
  return Number(roundHalfUp(BigInt(taxable) * BigInt(bp), 10000n))
}

/**
 * Full totals breakdown from line items + document-level fields (§10.2).
 *
 * @param {{
 *   items?: Array<{ qty_milli?: number, rate_paise?: number }>,
 *   discountType?: 'percent' | 'fixed',
 *   discountBp?: number | null,
 *   discountFixedPaise?: number | null,
 *   gstBp?: number,
 *   otherChargesPaise?: number,
 * }} input
 * @returns {{
 *   subtotalPaise: number,
 *   discountPaise: number,
 *   taxablePaise: number,
 *   gstPaise: number,
 *   otherChargesPaise: number,
 *   grandTotalPaise: number,
 * }}
 */
export function calcTotals({
  items = [],
  discountType = 'percent',
  discountBp = 0,
  discountFixedPaise = 0,
  gstBp = 0,
  otherChargesPaise = 0,
}) {
  const subtotalPaise = items.reduce((sum, item) => sum + calcLineTotal(item.qty_milli, item.rate_paise), 0)
  const discountPaise = calcDiscount(subtotalPaise, discountType, discountBp, discountFixedPaise)
  const taxablePaise = subtotalPaise - discountPaise
  const gstPaise = calcGst(taxablePaise, gstBp)
  const other = Math.max(0, Math.trunc(otherChargesPaise || 0))
  const grandTotalPaise = taxablePaise + gstPaise + other

  return {
    subtotalPaise,
    discountPaise,
    taxablePaise,
    gstPaise,
    otherChargesPaise: other,
    grandTotalPaise,
  }
}
