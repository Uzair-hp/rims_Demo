/**
 * Ruchita Interiors — clients API calls (§9.2).
 *
 * Thin wrappers over `client.js`. `client.js` hands back the raw §9.1 envelope,
 * so each function here unwraps `data` — callers only ever see the payload.
 */

import { del, get, post, put } from '../client.js'

export const fetchClients = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.includeArchived) qs.set('include_archived', 'true')
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  const query = qs.toString()
  return get(`/clients${query ? `?${query}` : ''}`).then((body) => body.data)
}

export const fetchClient = (id) => get(`/clients/${id}`).then((body) => body.data.client)

export const createClient = (client) => post('/clients', client).then((body) => body.data.client)

export const updateClient = (id, client) => put(`/clients/${id}`, client).then((body) => body.data.client)

export const archiveClient = (id) => del(`/clients/${id}`).then((body) => body.data.client)

export const restoreClient = (id) => post(`/clients/${id}/restore`).then((body) => body.data.client)

export const fetchClientSummary = (id) => get(`/clients/${id}/summary`).then((body) => body.data)
