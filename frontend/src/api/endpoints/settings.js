/**
 * Ruchita Interiors — settings API calls (§9.2).
 *
 * Thin wrappers over `client.js`. `client.js` hands back the raw §9.1 envelope,
 * so each function here unwraps `data` — callers only ever see the payload.
 */

import { del, get, post, put } from '../client.js'

/** GET /settings/company → the singleton settings row. */
export const fetchCompanySettings = () => get('/settings/company').then((body) => body.data)

/** PUT /settings/company → save the editable fields; returns the normalized row. */
export const saveCompanySettings = (patch) => put('/settings/company', patch).then((body) => body.data)

/** GET /settings/terms → all terms entries. */
export const fetchTerms = () => get('/settings/terms').then((body) => body.data)

/** POST /settings/terms → create one. */
export const createTerm = (term) => post('/settings/terms', term).then((body) => body.data)

/** PUT /settings/terms/:id → update one. */
export const updateTerm = (id, patch) => put(`/settings/terms/${id}`, patch).then((body) => body.data)

/** DELETE /settings/terms/:id → remove one. */
export const deleteTerm = (id) => del(`/settings/terms/${id}`).then((body) => body.data)

/** POST /settings/logo (multipart) → upload a new logo. */
export const uploadLogo = (file) => {
  const form = new FormData()
  form.append('logo', file)
  return post('/settings/logo', form).then((body) => body.data)
}

/** DELETE /settings/logo → remove the stored logo. */
export const removeLogo = () => del('/settings/logo').then((body) => body.data)

/**
 * URL of the stored logo, or null when none is set.
 *
 * The image is served by the authenticated `GET /uploads/logo` route, so an
 * `<img>` src works: the cookie travels with same-origin image requests. The
 * `updated_at` query busts the long-lived cache after a re-upload.
 */
export const logoImageUrl = (settings) => {
  if (!settings?.logo_path) return null
  const version = settings.updated_at || ''
  const base = import.meta.env.VITE_API_BASE_URL || '/api/v1'
  return `${base.replace(/\/+$/, '')}/uploads/logo?v=${encodeURIComponent(version)}`
}
