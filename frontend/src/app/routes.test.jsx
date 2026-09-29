import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from './routes.jsx'
import { AuthProvider } from '../features/auth/AuthProvider.jsx'

/** A signed-in identity, so the guard lets the route through without a network call. */
const TEST_USER = { id: 1, name: 'Ruchita Admin', email: 'admin@ruchitainteriors.in', role: 'owner' }

/**
 * Renders the real route table at a given path. Using the same `routes` array as
 * the app means a route can never be tested as working and be broken in the shell.
 *
 * Authenticated by default: every other route is behind `RequireAuth`, so this is
 * what most tests want. The unauthenticated cases are in features/auth.
 */
function renderAt(path, { user = TEST_USER } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <AuthProvider initialUser={user}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('routing', () => {
  it('renders the dashboard at the root path', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('gives every chrome page a single level-one heading', () => {
    const paths = [
      '/',
      '/quotations',
      '/quotations/new',
      '/quotations/42',
      '/quotations/42/edit',
      '/invoices',
      '/invoices/7',
      '/clients',
      '/clients/9',
      '/settings',
      '/no-such-page',
    ]

    for (const path of paths) {
      const { unmount } = renderAt(path)
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      unmount()
    }
  })

  it('resolves the dynamic quotation routes to the detail page', () => {
    renderAt('/quotations/AQ-1042')
    expect(screen.getByRole('heading', { level: 1, name: 'Quotation' })).toBeInTheDocument()
  })

  it('uses the edit variant for /quotations/:id/edit', () => {
    renderAt('/quotations/AQ-1042/edit')
    expect(screen.getByRole('heading', { level: 1, name: 'Edit quotation' })).toBeInTheDocument()
  })

  it('renders a 404 page for unknown paths instead of a blank screen', () => {
    renderAt('/definitely-not-a-route')
    expect(screen.getByRole('heading', { level: 1, name: /does not exist/i })).toBeInTheDocument()
  })

  it('titles an unknown path as a 404 rather than the bare brand name', async () => {
    // The tab previously read "Ruchita Interiors" on a page saying the route does
    // not exist, because the title map had no fallback for an unmatched path.
    renderAt('/definitely-not-a-route')
    await waitFor(() => expect(document.title).toBe('Page not found · Ruchita Interiors'))
  })

  it('keeps the login route outside the app shell', async () => {
    // Rendered anonymously, otherwise RedirectIfAuthenticated sends the signed-in
    // test user straight back to the dashboard.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' } })),
    )
    renderAt('/login', { user: null })

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument())
  })

  it('navigates from the sidebar to a sibling page', async () => {
    renderAt('/')
    await userEvent.click(screen.getByRole('link', { name: 'Settings', hidden: true }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it('marks the current destination in the navigation', async () => {
    renderAt('/quotations')

    // `hidden: true` because jsdom does not evaluate media queries: the sidebar
    // keeps its `display: none` below `lg`, so it is excluded from the
    // accessibility tree even though it is the element under test here.
    const [desktop] = screen.getAllByRole('navigation', { name: 'Primary', hidden: true })
    const link = within(desktop).getByRole('link', { name: 'Quotations', hidden: true })
    expect(link).toHaveAttribute('aria-current', 'page')

    await userEvent.click(within(desktop).getByRole('link', { name: 'Clients', hidden: true }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument()
  })

  it('exposes both navigations, since only one is on screen at a time', () => {
    renderAt('/')

    const navs = screen.getAllByRole('navigation', { name: 'Primary', hidden: true })
    expect(navs).toHaveLength(2)

    const [desktop, mobile] = navs
    expect(within(desktop).getByRole('link', { name: 'Settings', hidden: true })).toBeInTheDocument()
    expect(within(mobile).getByRole('button', { name: 'More', hidden: true })).toBeInTheDocument()
    expect(within(mobile).getByRole('button', { name: 'New', hidden: true })).toBeInTheDocument()
  })

  it('keeps the mobile slots free of the destinations the bottom bar cannot hold', () => {
    renderAt('/')

    const [, mobile] = screen.getAllByRole('navigation', { name: 'Primary', hidden: true })
    const labels = within(mobile)
      .getAllByRole('link', { hidden: true })
      .map((link) => link.textContent)

    expect(labels).toEqual(['Dashboard', 'Quotations', 'Invoices'])
  })

  it('shows the signed-in identity in the sidebar footer', () => {
    renderAt('/')
    expect(screen.getByText('Ruchita Admin')).toBeInTheDocument()
    expect(screen.getByText('admin@ruchitainteriors.in')).toBeInTheDocument()
  })
})
