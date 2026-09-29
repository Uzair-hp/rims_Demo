/**
 * Ruchita Interiors — quotations API calls (§9.2).
 *
 * Thin wrappers over `client.js`, which hands back the raw §9.1 envelope; each
 * function unwraps `data` so callers only ever see the payload. Endpoints mirror
 * `backend/app/api/quotations.py`.
 */

import { del, get, post, put } from '../client.js'

export const fetchQuotations = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.status) qs.set('status', params.status)
  if (params.clientId) qs.set('client_id', String(params.clientId))
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  const query = qs.toString()
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
