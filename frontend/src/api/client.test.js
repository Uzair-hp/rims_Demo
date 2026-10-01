import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest, ApiError, ensureCsrfToken } from './client.js'

/**
 * Client tests for the two behaviours PLAN §16 requires and the UI cannot show:
 * the CSRF header on mutations, and exactly one refresh per burst of 401s.
 */

// Relative, matching the shipped default in client.js. The tests must exercise the
// same base URL the browser uses, or a same-origin regression is invisible here.
const API = '/api/v1'

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const UNAUTHORIZED = jsonResponse(
  { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } },
  { ok: false, status: 401 },
)

/**
 * A gateway response: an error status with no §9.1 envelope, and a body that is
 * not JSON at all — which is exactly what the Vite dev proxy returns when Flask
 * is not running. `json()` rejects the way the real one does, so `toApiError`'s
 * `catch` is exercised rather than bypassed.
 */
function gatewayError(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    },
    text: async () => '',
  }
}

function clearCsrfCookie() {
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  })
}

beforeEach(clearCsrfCookie)
afterEach(clearCsrfCookie)

describe('apiRequest', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true })),
    )
    await expect(apiRequest('/health')).resolves.toEqual({ ok: true })
  })

  it('sends credentials so cookies travel with every call', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/health')

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('adds the CSRF header to mutations but not to reads', async () => {
    document.cookie = 'csrf_token=token-abc; path=/'
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/auth/logout', { method: 'POST' })
    await apiRequest('/auth/me')

    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('token-abc')
    expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('does not send a CSRF header when no cookie has been issued yet', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/auth/login', { method: 'POST' })

    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('turns an error envelope into an ApiError with the server code and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Please check the highlighted fields.',
              details: [{ field: 'email', message: 'Not a valid email.' }],
            },
          },
          { ok: false, status: 400 },
        ),
      ),
    )

    const error = await apiRequest('/auth/login', { method: 'POST' }).catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details).toEqual([{ field: 'email', message: 'Not a valid email.' }])
  })

  it('reports a transport failure as offline rather than a generic error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const error = await apiRequest('/health').catch((caught) => caught)

    expect(error.offline).toBe(true)
    expect(error.code).toBe('NETWORK')
  })
})

/**
 * The dev proxy answers with a bodiless 502 when Flask is not running. `fetch`
 * still *resolves* for that, so it is not a transport failure and never reaches
 * the `catch` in `apiRequest`; it has to be recognised in `toApiError`, or every
 * screen reports a generic internal error for what is an outage.
 */
describe('gateway failures are connectivity failures, not application errors', () => {
  it.each([502, 503, 504])('treats a bodiless %i as offline', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gatewayError(status)),
    )

    const error = await apiRequest('/auth/login', { method: 'POST' }).catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.offline).toBe(true)
    expect(error.code).toBe('NETWORK')
    // The status is kept, not zeroed, so any `status >= 500` reasoning stays true.
    expect(error.status).toBe(status)
    expect(error.details).toEqual([])
    expect(error.message).toMatch(/no connection/i)
  })

  it('keeps a real backend 500 as an application error, not a connectivity one', async () => {
    // The mirror case, and the important one: Flask always returns a §9.1 envelope
    // for a 500, so an enveloped 500 is the server's own error and must keep its
    // own copy. This is the guard against classifying 5xx too broadly.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, { ok: false, status: 500 }),
      ),
    )

    const error = await apiRequest('/auth/login', { method: 'POST' }).catch((caught) => caught)

    expect(error.offline).toBe(false)
    expect(error.status).toBe(500)
    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('boom')
  })

  it('does not treat an enveloped 502 as a connectivity failure', async () => {
    // A gateway status that *does* carry an envelope came from something that
    // speaks the API contract, so its message is authoritative.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'BUSINESS_RULE', message: 'Not available right now.' } },
          { ok: false, status: 502 },
        ),
      ),
    )

    const error = await apiRequest('/auth/login', { method: 'POST' }).catch((caught) => caught)

    expect(error.offline).toBe(false)
    expect(error.message).toBe('Not available right now.')
  })

  it('leaves a bodiless 4xx as an ordinary error', async () => {
    // A 404 with no body is a routing answer, not an outage. Only the gateway
    // family means "nothing answered".
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gatewayError(404)),
    )

    const error = await apiRequest('/clients/999').catch((caught) => caught)

    expect(error.offline).toBe(false)
    expect(error.status).toBe(404)
  })

  it('does not try to refresh a token after a gateway failure', async () => {
    // A dead API cannot issue a new token, so attempting a refresh would be a
    // pointless round trip against the same unreachable host.
    const fetchMock = vi.fn(async () => gatewayError(502))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/auth/me').catch(() => {})

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(0)
  })
})

describe('single-flight refresh', () => {
  it('refreshes once and retries the original request after a 401', async () => {
    let meAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      if (path === '/auth/refresh') return jsonResponse({ user: { id: 1 } })
      if (path === '/auth/me') {
        meAttempts += 1
        return meAttempts === 1 ? UNAUTHORIZED : jsonResponse({ ok: true })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/me')).resolves.toEqual({ ok: true })
    expect(meAttempts).toBe(2)

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })

  it('refreshes /auth/me after a 401, so a reload does not sign the user out', async () => {
    // Regression guard: /auth/me used to be excluded from the refresh, which meant
    // an expired access token logged the user out on every reload.
    let meAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      if (path === '/auth/refresh') return jsonResponse({ user: { id: 1 } })
      if (path === '/auth/me') {
        meAttempts += 1
        return meAttempts === 1 ? UNAUTHORIZED : jsonResponse({ user: { id: 1 } })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/me')).resolves.toEqual({ user: { id: 1 } })
    expect(meAttempts).toBe(2)
  })

  it('collapses a burst of concurrent 401s into one refresh', async () => {
    const attempts = new Map()
    const fetchMock = vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      if (path === '/auth/refresh') return jsonResponse({ user: { id: 1 } })
      // Each endpoint 401s once, then succeeds on the retry.
      const seen = (attempts.get(path) || 0) + 1
      attempts.set(path, seen)
      return seen === 1 ? UNAUTHORIZED : jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiRequest('/reports/one'), apiRequest('/reports/two'), apiRequest('/reports/three')])

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))
    // The whole reason this exists: three parallel requests, one refresh. Without
    // the shared promise, rotation would revoke the token the losers just wrote.
    expect(refreshCalls).toHaveLength(1)
    expect(attempts.get('/reports/one')).toBe(2)
  })

  it('gives up with the original error when the refresh fails', async () => {
    const fetchMock = vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      if (path === '/auth/refresh') return UNAUTHORIZED
      return UNAUTHORIZED
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await apiRequest('/auth/me').catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
  })

  it('never retries the login, so a wrong password cannot trigger a refresh loop', async () => {
    const fetchMock = vi.fn(async () => UNAUTHORIZED)
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries the refresh endpoint itself', async () => {
    const fetchMock = vi.fn(async () => UNAUTHORIZED)
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)

    // Exactly one call: the direct one. A nested refresh would recurse.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ensureCsrfToken', () => {
  it('asks the server only when no cookie is present', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await ensureCsrfToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    document.cookie = 'csrf_token=already-there; path=/'
    await ensureCsrfToken()
    // Second call is free: the cookie is already there, so nothing is fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
