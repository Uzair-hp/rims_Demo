/**
 * Ruchita Interiors — invoices API calls (§9.2).
 *
 * Thin wrappers over `client.js`, which hands back the raw §9.1 envelope; each
 * function unwraps `data` so callers only ever see the payload. Endpoints mirror
 * `backend/app/api/invoices.py`.
 *
 * There is deliberately no `createInvoice`: an invoice only ever exists by
 * converting an approved quotation (FR-I1), and that call lives in
 * `endpoints/quotations.js` because it is a quotation action. Payment routes are
 * absent for the same reason — they are Phase 8.
 */

import { get, post, put } from '../client.js'

/**
 * Build the query string for the invoices list. Pure and exported so param
 * generation is unit-testable without a network mock, mirroring
 * `buildQuotationListQuery`.
 */
export const buildInvoiceListQuery = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.paymentStatus) qs.set('payment_status', params.paymentStatus)
  if (params.clientId) qs.set('client_id', String(params.clientId))
  if (params.dateFrom) qs.set('date_from', params.dateFrom)
  if (params.dateTo) qs.set('date_to', params.dateTo)
  if (params.sort) qs.set('sort', params.sort)
  if (params.order) qs.set('order', params.order)
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  return qs.toString()
}

export const fetchInvoices = (params = {}) => {
  const query = buildInvoiceListQuery(params)
  return get(`/invoices${query ? `?${query}` : ''}`).then((body) => body.data)
}

export const fetchInvoice = (id) => get(`/invoices/${id}`).then((body) => body.data.invoice)

/** Editable while Draft only: issue_date, due_date, notes, terms_text. */
export const updateInvoice = (id, payload) =>
  put(`/invoices/${id}`, payload).then((body) => body.data.invoice)

export const issueInvoice = (id) => post(`/invoices/${id}/issue`).then((body) => body.data.invoice)

/** Refused with 422 once a payment exists; releases the quotation when it succeeds. */
export const cancelInvoice = (id) => post(`/invoices/${id}/cancel`).then((body) => body.data.invoice)

/**
 * GET /invoices/:id/payment-due — the Balance / Payment Due document (§8.5).
 *
 * A **read**: the server re-derives the balance from the payment ledger on every
 * call and writes nothing, so the document can never add revenue or a payment row
 * and can never be stale. Refused with 422 when the invoice is not issued or nothing
 * is outstanding.
 *
 * @returns {object} the payment-due payload
 */
export const fetchPaymentDue = (id) =>
  get(`/invoices/${id}/payment-due`).then((body) => body.data.payment_due)
