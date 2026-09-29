/**
 * Ruchita Interiors — quotation form validation (§10, §15).
 *
 * Mirrors the backend's `validate_document` / `validate_line` (calculations.py)
 * so the editor can flag problems inline before a save. The server re-validates
 * and its 422 is authoritative; these checks only shape the local UX.
 *
 * Values are in the same integer units the API uses: qty in milli-units, rate
 * and money in paise, percentages in basis points.
 */

const MAX_INT = 10 ** 12
const GST_MAX_BP = 2800

/**
 * @param {{ name?: string, qty_milli?: number, rate_paise?: number }} item
 * @returns {{ name?: string, qty_milli?: string, rate_paise?: string }} field → message
 */
export function validateItem(item) {
  const errors = {}
  const name = (item.name || '').trim()
  const qty = Number(item.qty_milli || 0)
  const rate = Number(item.rate_paise || 0)

  if (!name) errors.name = 'Item name is required'
  if (qty < 0) errors.qty_milli = 'Quantity cannot be negative'
  if (rate < 0) errors.rate_paise = 'Rate cannot be negative'
  if (qty > MAX_INT || rate > MAX_INT) {
    errors.qty_milli = errors.qty_milli || 'Value exceeds the maximum allowed'
  }
  return errors
}

/**
 * A line counts toward "at least one valid item" only with a name and a positive
 * quantity and rate — the same rule the backend uses to gate Send.
 * @param {{ name?: string, qty_milli?: number, rate_paise?: number }} item
 * @returns {boolean}
 */
export function isValidLine(item) {
  return Boolean(
    (item.name || '').trim() && Number(item.qty_milli || 0) > 0 && Number(item.rate_paise || 0) > 0,
  )
}

/**
 * Validate the whole quotation form.
 *
 * @param {{
 *   client_id?: number | null,
 *   quotation_date?: string,
 *   discount_type?: 'percent' | 'fixed',
 *   discount_bp?: number | null,
 *   discount_fixed_paise?: number | null,
 *   gst_bp?: number,
 *   other_charges_paise?: number | null,
 *   items?: Array<object>,
 * }} form
 * @returns {{
 *   ok: boolean,
 *   fields: Record<string, string>,
 *   items: Array<Record<string, string>>,
 * }}
 */
export function validateQuotation(form) {
  const fields = {}
  const items = (form.items || []).map(validateItem)

  if (!form.client_id) fields.client_id = 'Select a client'
  if (!form.quotation_date) fields.quotation_date = 'Quotation date is required'

  if (!(form.items || []).some(isValidLine)) {
    fields.items = 'Add at least one item with a name, quantity and rate'
  }

  const type = form.discount_type || 'percent'
  if (type !== 'percent' && type !== 'fixed') {
    fields.discount_type = "Discount type must be 'percent' or 'fixed'"
  } else if (type === 'percent') {
    const bp = Number(form.discount_bp || 0)
    if (bp < 0) fields.discount_bp = 'Discount cannot be negative'
    if (bp > 10000) fields.discount_bp = 'Discount cannot exceed 100%'
  } else if (type === 'fixed') {
    if (Number(form.discount_fixed_paise || 0) < 0) {
      fields.discount_fixed_paise = 'Discount cannot be negative'
    }
  }

  const gst = Number(form.gst_bp || 0)
  if (gst < 0 || gst > GST_MAX_BP) fields.gst_bp = 'GST must be between 0% and 28%'

  if (Number(form.other_charges_paise || 0) < 0) {
    fields.other_charges_paise = 'Other charges cannot be negative'
  }

  const ok = Object.keys(fields).length === 0 && items.every((e) => Object.keys(e).length === 0)
  return { ok, fields, items }
}
