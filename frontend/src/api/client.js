/**
 * Ruchita Interiors — API client.
 *
 * The only place in the frontend that calls fetch (PLAN §23 layering rules).
 *
 * Phase 1 added the base URL, cookie credentials, JSON in/out and error-envelope
 * parsing (§9.1). Phase 2 adds the two things authentication requires:
 *
 * - the CSRF header on every non-GET request (§16 double-submit)
 * - a single-flight 401 refresh, so an expired 15-minute access token costs one
 *   invisible round trip rather than a sign-in prompt
 */

/**
 * API base URL, relative by default so every call is same-origin.
 *
 * A relative default is the point: the Vite dev server proxies /api to Flask and
 * production serves both from one origin. An absolute URL pointing at a different
 * port makes the request cross-origin, which breaks auth in two independent ways
 * - the browser withholds SameSite=Lax cookies because "localhost" and "127.0.0.1"
 * are different sites, and the request needs this origin in the server's
 * CORS_ORIGINS. Both failures surface as "Cannot reach the server", so the
 * misconfiguration is invisible until someone loads the app in a browser.
 */
const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const BASE_URL = RAW_BASE_URL.replace(/\/+$/, '')

/** Matches the server's CSRF_COOKIE_NAME. Readable by JS by design. */
const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'X-CSRF-Token'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Endpoints whose 401 is a final answer, so they must never trigger a refresh.
 *
 * /auth/refresh cannot fix itself, and /auth/login 401-ing means the credentials
 * are wrong - retrying would either loop or mask a real failure. /auth/me and
 * /auth/logout are deliberately absent: an expired access token must still be
 * refreshed transparently, otherwise a reload after 15 idle minutes would sign
 * the user out despite a perfectly valid refresh cookie.
 */
const NO_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh'])

/**
 * @typedef {object} ApiErrorPayload
 * @property {{ code: string, message: string, details?: Array<{ field?: string, message: string }> }} error
 */

/** Error carrying the server's envelope plus transport context. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, details?: Array<object>, offline?: boolean, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.code = options.code || 'INTERNAL'
    this.status = options.status || 0
    this.details = options.details || []
    this.offline = Boolean(options.offline)
  }
}

const FRIENDLY_MESSAGES = {
  INTERNAL: 'Something went wrong. Please try again.',
  NOT_FOUND: 'That record could not be found.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to that.',
  CONFLICT: 'That action conflicts with the current state.',
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  BUSINESS_RULE: 'That action is not allowed right now.',
}

/**
 * @param {Response} response
 * @returns {Promise<ApiError>}
 */
async function toApiError(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const envelope = payload && payload.error ? payload.error : null
  const message = envelope?.message || FRIENDLY_MESSAGES[envelope?.code] || FRIENDLY_MESSAGES.INTERNAL
  return new ApiError(message, {
    code: envelope?.code || 'INTERNAL',
    status: response.status,
    details: envelope?.details || [],
  })
}

/** @returns {string} The CSRF cookie value, or '' before the server has issued one. */ function readCsrfToken() {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Ask the server for a CSRF token.
 *
 * Needed on a cold visit, where the client has no token yet but `login` is itself
 * a non-GET call. Cheap and idempotent; the server only sets a new cookie when one
 * is missing.
 */
export async function ensureCsrfToken() {
  if (readCsrfToken()) return readCsrfToken()
  try {
    await apiRequest('/auth/csrf', { skipAuthRetry: true })
  } catch {
    // Not fatal here. The request that needs the token will fail with a clear 403
    // rather than this throwing something unrelated during app start-up.
  }
  return readCsrfToken()
}

/**
 * In-flight refresh, shared by every caller that hits a 401 at the same moment.
 *
 * Without this, five parallel requests after an expiry would each call
 * /auth/refresh. Because refresh rotates the pair, concurrent calls race and all
 * but the last would be revoked, breaking the session. One promise, many waiters.
 */
let refreshPromise = null

/**
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>} true when a new session was obtained
 */
async function refreshSession(signal) {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            ...(readCsrfToken() ? { [CSRF_HEADER_NAME]: readCsrfToken() } : {}),
          },
          signal,
        })
        return response.ok
      } catch {
        return false
      } finally {
        // Cleared in a microtask so callers awaiting this promise all see the
        // same result before a later request can start a second refresh.
        queueMicrotask(() => {
          refreshPromise = null
        })
      }
    })()
  }
  return refreshPromise
}

/**
 * @param {string} path Path relative to the API base, e.g. `/health`.
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal, skipAuthRetry?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal, skipAuthRetry = false } = options
  const isMutation = MUTATING_METHODS.has(method.toUpperCase())

  const send = async () => {
    const requestHeaders = { Accept: 'application/json', ...headers }

    // Double-submit (§16): the header must mirror the cookie. Sent on mutations
    // only, because the server ignores it on GET.
    if (isMutation) {
      const token = readCsrfToken()
      if (token) requestHeaders[CSRF_HEADER_NAME] = token
    }

    const init = { method, credentials: 'include', headers: requestHeaders, signal }
    if (body !== undefined) {
      if (body instanceof FormData) {
        // Content-Type is left alone so the browser sets the multipart boundary.
        init.body = body
      } else {
        requestHeaders['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
    }

    let response
    try {
      response = await fetch(`${BASE_URL}${path}`, init)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      // A transport failure is reported as "offline" so the UI can say so plainly
      // instead of pretending the write succeeded (§17, §20).
      throw new ApiError('No connection to the Ruchita Interiors server.', {
        code: 'NETWORK',
        offline: true,
        cause,
      })
    }

    if (!response.ok) throw await toApiError(response)
    if (response.status === 204) return null

    const contentType = response.headers.get('Content-Type') || ''
    return contentType.includes('application/json') ? response.json() : response.text()
  }

  try {
    return await send()
  } catch (error) {
    // One transparent retry after refreshing an expired access token (§16).
    const canRefresh = !skipAuthRetry && !NO_REFRESH_PATHS.has(path)
    if (error?.status === 401 && canRefresh) {
      const refreshed = await refreshSession(signal)
      if (refreshed) return send()
    }
    throw error
  }
}

export const get = (path, options) => apiRequest(path, { ...options, method: 'GET' })

export const post = (path, body, options) => apiRequest(path, { ...options, method: 'POST', body })

export const put = (path, body, options) => apiRequest(path, { ...options, method: 'PUT', body })

export const del = (path, options) => apiRequest(path, { ...options, method: 'DELETE' })
