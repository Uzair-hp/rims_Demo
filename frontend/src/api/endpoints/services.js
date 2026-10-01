/**
 * Ruchita Interiors — services API calls (SERVICES_PLAN §5).
 *
 * Thin wrappers over `client.js`, shaped exactly like `clients.js`. The client
 * hands back the raw §9.1 envelope, so each function here unwraps `data` —
 * callers only ever see the payload.
 */

import { del, get, post, put } from '../client.js'

export const fetchServices = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.category) qs.set('category', params.category)
  if (params.includeArchived) qs.set('include_archived', 'true')
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('page_size', String(params.pageSize))
  const query = qs.toString()
  return get(`/services${query ? `?${query}` : ''}`).then((body) => body.data)
}

export const fetchService = (id) => get(`/services/${id}`).then((body) => body.data.service)

export const createService = (service) => post('/services', service).then((body) => body.data.service)

export const updateService = (id, service) =>
  put(`/services/${id}`, service).then((body) => body.data.service)

/** Archives (soft delete) — a hard-delete endpoint is never exposed (S5). */
export const archiveService = (id) => del(`/services/${id}`).then((body) => body.data.service)

export const restoreService = (id) => post(`/services/${id}/restore`).then((body) => body.data.service)
