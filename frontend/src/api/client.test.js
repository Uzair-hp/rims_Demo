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
