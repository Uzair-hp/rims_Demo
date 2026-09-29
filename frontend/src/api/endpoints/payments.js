/**
 * Ruchita Interiors — payments API calls (§9.2).
 *
 * Thin wrappers over `client.js`, which hands back the raw §9.1 envelope; each
 * function unwraps `data` so callers only ever see the payload. Endpoints mirror
 * `backend/app/api/invoices.py` and `backend/app/api/payments.py`.
 *
 * Both mutating calls return the refreshed invoice alongside the payment, so the
 * UI re-renders from the server's computed `paid_paise` / `outstanding_paise` /
 * `payment_status` rather than doing its own arithmetic (D2). The client's live
 * overpayment warning is display only — the server stays the sole authority on
 * rejection (§11).
 */

import { del, get, post } from '../client.js'

/** GET /invoices/:id/payments → history plus the derived money figures. */
export const fetchInvoicePayments = (id) => get(`/invoices/${id}/payments`).then((body) => body.data)

/**
 * POST /invoices/:id/payments — record a payment against an issued invoice.
 * @returns {{ payment: object, invoice: object }}
 */
export const recordPayment = (invoiceId, payload) =>
  post(`/invoices/${invoiceId}/payments`, payload).then((body) => body.data)

/** DELETE /payments/:id — correction; returns the corrected invoice. */
export const deletePayment = (paymentId) => del(`/payments/${paymentId}`).then((body) => body.data)
