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
      '/services',
      '/settings',
      '/no-such-page',
      // Chrome-less print surfaces (§14.2). Still real routes with real headings.
      '/print/quotation/42',
      '/print/invoice/7',
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

  it('keeps the print route chrome-less, so no sidebar or drawer reaches the paper', () => {
    renderAt('/print/quotation/42')

    expect(screen.getByRole('heading', { level: 1, name: 'Quotation' })).toBeInTheDocument()
    // The document renders with a print toolbar and nothing else; the app shell
    // must not be mounted around it (§14.2).
    expect(screen.queryByRole('navigation', { name: 'Primary', hidden: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Print \/ Save as PDF/ })).toBeInTheDocument()
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

  it('exposes only the desktop navigation until the drawer is opened', () => {
    renderAt('/')

    // The drawer unmounts when closed, so there is exactly one `Primary`
    // navigation in the document — the sidebar, which is `display: none` below
    // `lg` in jsdom. Two sets of links would mean two competing navigations.
    const navs = screen.getAllByRole('navigation', { name: 'Primary', hidden: true })
    expect(navs).toHaveLength(1)
    expect(within(navs[0]).getByRole('link', { name: 'Settings', hidden: true })).toBeInTheDocument()

    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('opens the navigation drawer from the hamburger and lists every destination', async () => {
    renderAt('/')

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)

    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // The drawer is the sidebar plate, so it carries all six destinations — the
    // rule the removed bottom bar broke by holding only three.
    const links = within(drawer).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/quotations',
      '/invoices',
      '/clients',
      '/services',
      '/settings',
      '/quotations/new',
      '/clients',
    ])
  })

  it('marks the current destination inside the drawer, as the sidebar does', async () => {
    renderAt('/quotations')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).getByRole('link', { name: 'Quotations' })).toHaveAttribute('aria-current', 'page')
  })

  it('closes the drawer after navigating from it', async () => {
    renderAt('/')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    await userEvent.click(screen.getByRole('link', { name: 'Services' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Services' })).toBeInTheDocument()
    // The panel stays mounted for the length of the slide-out, so this waits for
    // the exit rather than asserting on the frame the link was clicked.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
  })

  it('closes the drawer when the scrim is clicked', async () => {
    renderAt('/')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Close navigation overlay' }))

    // The panel stays mounted for the length of the slide-out, so this waits for
    // the exit rather than asserting on the frame the scrim was clicked.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the drawer on Escape', async () => {
    renderAt('/')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })

    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the drawer from its own close button', async () => {
    renderAt('/')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Close navigation' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('locks the page behind the drawer while it is open', async () => {
    renderAt('/')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(document.body.style.overflow).toBe('hidden')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'))
  })

  it('offers Services and Settings on mobile, which the bottom bar could not', async () => {
    renderAt('/')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })

    expect(within(drawer).getByRole('link', { name: 'Services' })).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the theme control and sign out reachable on mobile', async () => {
    renderAt('/')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })

    // Below `lg` the sidebar is off screen, so the drawer's footer is the only
    // place these can live (§7).
    expect(within(drawer).getByRole('button', { name: /theme/i })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows the signed-in identity in the sidebar footer', () => {
    renderAt('/')
    expect(screen.getByText('Ruchita Admin')).toBeInTheDocument()
    expect(screen.getByText('admin@ruchitainteriors.in')).toBeInTheDocument()
  })
})
