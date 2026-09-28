import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { router } from './router.jsx'

/**
 * Render smoke test for the real provider composition.
 *
 * This file exists because of a specific, shipped bug: `DocumentTitle` was mounted
 * as a sibling of `<RouterProvider>` in `main.jsx`, so its `useLocation()` call
 * threw and the entire app rendered the ErrorBoundary instead of the shell. Every
 * other suite passed, because each one builds its own memory router and renders
 * only the route table - the entry point itself was never under test, and coverage
 * excluded it.
 *
 * The first attempt at this test repeated that mistake: it rendered `routes` with
 * a memory router, which looks like the real app but still could not see a bad
 * sibling in `main.jsx`. Reintroducing the bug left the suite green. So `App` was
 * extracted from `main.jsx` and *this* test mounts the real component, and each
 * case also mounts the real `createBrowserRouter` over the real `routes`.
 *
 * This is the cheap half of the browser check PLAN §25 now requires per phase. It
 * cannot replace loading the app in a browser, but it makes the catastrophic
 * version of a render error impossible to ship.
 */

// Relative, matching the shipped default in client.js.
const API = '/api/v1'

const USER = { id: 1, name: 'Ruchita Admin', email: 'admin@ruchitainteriors.in', role: 'owner' }

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
  { error: { code: 'UNAUTHENTICED', message: 'Please sign in to continue.' } },
  { ok: false, status: 401 },
)

function stubFetch(me = UNAUTHORIZED) {
  const fetchMock = vi.fn(async (url) => {
    const path = String(url).replace(API, '')
    if (path === '/auth/me') return me
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The ErrorBoundary's own failure text. Its presence means the app failed to render. */
const BOUNDARY_FAILURE = /Something went wrong/i

function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

describe('app render smoke test', () => {
  it('renders the login screen for an anonymous visitor without hitting the error boundary', async () => {
    stubFetch()
    renderApp()

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText(BOUNDARY_FAILURE)).not.toBeInTheDocument()
  })

  it('renders the shell for a restored session without hitting the error boundary', async () => {
    stubFetch(jsonResponse({ user: USER }))
    renderApp()

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText(BOUNDARY_FAILURE)).not.toBeInTheDocument()
  })

  it('sets the document title from the active route', async () => {
    stubFetch(jsonResponse({ user: USER }))
    renderApp()

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    // Proves DocumentTitle is mounted inside the router, which is the regression
    // this file exists for.
    await waitFor(() => expect(document.title).toBe('Dashboard · Ruchita Interiors'))
  })

  it('renders every route in the table without hitting the error boundary', async () => {
    stubFetch(jsonResponse({ user: USER }))

    const paths = [
      '/',
      '/quotations',
      '/quotations/new',
      '/quotations/AQ-1042',
      '/quotations/AQ-1042/edit',
      '/invoices',
      '/invoices/7',
      '/clients',
      '/clients/9',
      '/settings',
      '/no-such-page',
    ]

    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    // `App` uses the real browser router singleton, so this walks the actual route
    // table through the actual entry point rather than a parallel harness.
    for (const path of paths) {
      await router.navigate(path)

      // Wait for the session to resolve and the route to render; otherwise the
      // assertions can pass on the "Checking your session…" screen and prove
      // nothing about the route.
      await waitFor(() => expect(screen.queryByText(BOUNDARY_FAILURE)).not.toBeInTheDocument())
      expect(router.state.errors).toBeNull()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    }

    unmount()
  })
})
