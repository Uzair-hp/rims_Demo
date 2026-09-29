/**
 * Ruchita Interiors — quotations API calls (§9.2).
 *
 * Thin wrappers over `client.js`, which hands back the raw §9.1 envelope; each
 * function unwraps `data` so callers only ever see the payload. Endpoints mirror
 * `backend/app/api/quotations.py`.
 */

import { del, get, post, put } from '../client.js'

/**
 * Build the query string for the quotations list from UI params. Kept pure and
 * exported so param generation is unit-testable without a network mock. Only
 * defined values are emitted, and camelCase UI keys map to the snake_case query
 * params the backend list schema expects (§9.2).
 */
export const buildQuotationListQuery = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.status) qs.set('status', params.status)
  if (params.clientId) qs.set('client_id', String(params.clientId))
  if (params.dateFrom) qs.set('date_from', params.dateFrom)
  if (params.dateTo) qs.set('date_to', params.dateTo)
  if (params.minAmount != null && params.minAmount !== '') qs.set('min_amount', String(params.minAmount))
  if (params.maxAmount != null && params.maxAmount !== '') qs.set('max_amount', String(params.maxAmount))
  if (params.sort) qs.set('sort', params.sort)
  if (params.order) qs.set('order', params.order)
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  return qs.toString()
}

export const fetchQuotations = (params = {}) => {
  const query = buildQuotationListQuery(params)
  return get(`/quotations${query ? `?${query}` : ''}`).then((body) => body.data)
}

export const fetchQuotation = (id) => get(`/quotations/${id}`).then((body) => body.data.quotation)

export const createQuotation = (payload) => post('/quotations', payload).then((body) => body.data.quotation)

export const updateQuotation = (id, payload) =>
  put(`/quotations/${id}`, payload).then((body) => body.data.quotation)

export const deleteQuotation = (id) => del(`/quotations/${id}`).then((body) => body.data)

/** action: 'send' | 'approve' | 'reject' | 'reopen' */
export const changeQuotationStatus = (id, action, extra = {}) =>
  post(`/quotations/${id}/status`, { action, ...extra }).then((body) => body.data.quotation)

export const duplicateQuotation = (id) =>
  post(`/quotations/${id}/duplicate`).then((body) => body.data.quotation)

/** Convert an approved quotation to an invoice → { id, number, status }. */
export const convertQuotationToInvoice = (id) =>
  post(`/quotations/${id}/invoice`).then((body) => body.data.invoice)
