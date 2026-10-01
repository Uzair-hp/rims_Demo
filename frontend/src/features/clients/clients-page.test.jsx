import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClientsPage from './ClientsPage.jsx'

/**
 * Clients page rendering tests.
 *
 * The hook and the money helpers are covered elsewhere; this file covers what the
 * page actually renders, because the polish that prompted it was a *visual*
 * defect — icon-only actions that read as tick boxes, and a client name set in the
 * brand serif while every other list row used the body face.
 *
 * Both are asserted structurally (the action is a button with visible text; the
 * title link carries no class that forces a font) rather than by measuring
 * styles, which jsdom does not resolve for custom properties.
 */

const API = '/api/v1'

const CLIENTS = [
  {
    id: 1,
    name: 'Alpha Interiors',
    phone: '+91 90000 00001',
    email: 'alpha@example.com',
    is_archived: false,
  },
  { id: 2, name: 'Beta Builders', phone: '+91 90000 00002', email: 'beta@example.com', is_archived: true },
]

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function mockApi({ items = CLIENTS, fail = null } = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const path = String(url).replace(API, '')
      const method = init.method || 'GET'
      calls.push({ path, method })
      if (path.startsWith('/clients')) {
        if (method === 'GET' && fail) return fail
        return jsonResponse({ data: { items, total: items.length } })
      }
      return jsonResponse({ data: { client: items[0] } })
    }),
  )
  return { calls }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  )
}

/** The row card for one client, so per-row controls can be addressed precisely. */
const rowFor = (name) => screen.getByRole('link', { name }).closest('article')

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('Clients page — row actions', () => {
  it('labels the Edit action with visible text, not just an icon', async () => {
    mockApi()
    renderPage()

    await screen.findByRole('link', { name: 'Alpha Interiors' })
    const edit = within(rowFor('Alpha Interiors')).getByRole('button', { name: /^edit$/i })
    // Visible text is the accessible name, so no aria-label is needed to stand in
    // for one — which is the whole point of the change.
    expect(edit).not.toHaveAttribute('aria-label')
  })

  it('labels the Archive action with visible text', async () => {
    mockApi()
    renderPage()

    await screen.findByRole('link', { name: 'Alpha Interiors' })
    const archive = within(rowFor('Alpha Interiors')).getByRole('button', { name: /^archive$/i })
    expect(archive).not.toHaveAttribute('aria-label')
  })

  it('keeps Archive off an already-archived client', async () => {
    mockApi()
    renderPage()

    await screen.findByRole('link', { name: 'Alpha Interiors' })
    // The active client offers Archive; the archived one offers only Edit.
    expect(within(rowFor('Alpha Interiors')).getByRole('button', { name: /^archive$/i })).toBeInTheDocument()
    expect(within(rowFor('Beta Builders')).queryByRole('button', { name: /^archive$/i })).toBeNull()
    expect(within(rowFor('Beta Builders')).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })

  it('still confirms before archiving', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    await screen.findByRole('link', { name: 'Alpha Interiors' })
    await user.click(within(rowFor('Alpha Interiors')).getByRole('button', { name: /^archive$/i }))

    // The destructive path is unchanged: a confirm dialog, not an immediate write.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/archive client\?/i)).toBeInTheDocument()
  })
})

describe('Clients page — search and filter', () => {
  it('renders the archived filter as a real checkbox', async () => {
    mockApi()
    renderPage()

    const filter = await screen.findByRole('checkbox', { name: 'Show archived' })
    expect(filter).toHaveAttribute('type', 'checkbox')
    expect(filter).not.toBeChecked()
  })

  it('toggles the archived filter from its label', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi()
    renderPage()

    await user.click(await screen.findByText('Show archived'))

    // The filter refetches with include_archived=true.
    await vi.waitFor(() => {
      const last = calls.filter((call) => call.path.startsWith('/clients')).pop()
      expect(String(last.path)).toContain('include_archived=true')
    })
  })

  it('offers the same search control as the services page', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()

    const search = await screen.findByRole('searchbox', { name: 'Search clients' })
    expect(search).toHaveAttribute('type', 'search')

    // The label is visually hidden rather than dropped, so the control keeps an
    // accessible name now that the visible `TextField` label is gone.
    expect(screen.getByText('Search clients')).toBeInTheDocument()

    // A leading icon and a trailing clear button, as on Services — `TextField` has
    // no slot for either, which is why this is a raw input.
    await user.type(search, 'acme')
    expect(await screen.findByRole('button', { name: 'Clear search' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
  })

  it('declares the same search rules as the services stylesheet', () => {
    /**
     * Two directories, one search bar.
     *
     * Asserted against the stylesheet *source*, because jsdom applies no cascade
     * and resolves no custom properties, so a computed style cannot compare the
     * two. The rules are compared as normalised declaration lists rather than as
     * raw text, so a comment or a reordered comment block cannot fail this.
     */
    const [clients, services] = [
      import.meta.glob('./ClientsPage.module.css', { query: '?raw', import: 'default', eager: true }),
      import.meta.glob('../services/ServicesPage.module.css', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    ].map((loaded) => Object.values(loaded)[0] || '')

    /** One rule's declarations, whitespace- and order-insensitive. */
    const declarations = (source, selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const block = source.match(new RegExp(`(?:^|[\\s,}])\\.${escaped}\\s*\\{([^}]*)\\}`))?.[1] || ''
      return block
        .split(';')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/\s+/g, ' '))
        .sort()
        .join('; ')
    }

    for (const selector of ['searchWrap', 'search', 'searchIcon', 'searchClear', 'search:focus']) {
      const own = declarations(clients, selector)
      expect(own, `${selector} should exist in ClientsPage.module.css`).toBeTruthy()
      expect(own, `${selector} should match ServicesPage.module.css`).toBe(declarations(services, selector))
    }
  })
})

describe('Clients page — client name typography', () => {
  /**
   * The stylesheet source, loaded as text.
   *
   * `import.meta.glob` rather than a `?raw` import because ESLint's import
   * resolver does not understand the query suffix, and this is the one place the
   * check genuinely needs the source: jsdom does not resolve custom properties,
   * so a computed style cannot tell us which font would actually apply.
   */
  const stylesheets = import.meta.glob('./ClientsPage.module.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const rowTitleRule = () =>
    (stylesheets['./ClientsPage.module.css'] || '').match(/\.rowTitle\s*\{[^}]*\}/)?.[0] || ''

  it('does not force a display font on the client name link', async () => {
    mockApi()
    renderPage()

    await screen.findByRole('link', { name: 'Alpha Interiors' })

    // The regression: `.rowTitle` used to set `font-family: var(--font-display)`,
    // the brand serif, making this the only list row in the app in a different
    // face. Weight and colour are the only things that should set it apart now.
    const block = rowTitleRule()
    expect(block, '.rowTitle rule should exist').toBeTruthy()
    expect(block).not.toMatch(/font-family/)
    expect(block).not.toMatch(/font-size/)
  })

  it('still emphasises the client name with weight and ink colour', () => {
    const block = rowTitleRule()

    expect(block).toMatch(/font-weight/)
    expect(block).toMatch(/color/)
  })

  it('keeps the gold hover affordance', () => {
    const source = stylesheets['./ClientsPage.module.css'] || ''

    expect(source).toMatch(/\.rowTitle:hover/)
  })
})
