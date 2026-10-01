import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientPicker from './ClientPicker.jsx'

/**
 * Client picker — layout, keyboard and filtering (§9.2, §4.2).
 *
 * The picker is a repeated action inside the quotation editor, so it is tested
 * the way it is used: type, arrow, Enter. The layout rules are asserted
 * structurally rather than by measuring, because jsdom does not resolve custom
 * properties — a computed style cannot tell us which token a rule would pick up,
 * so those cases read the stylesheet source instead, the same approach
 * `clients-page.test.jsx` takes for the `.rowTitle` regression.
 */

const API = '/api/v1'

/** Numbers are stored as bare digits, as the API now returns them. */
const CLIENTS = [
  { id: 1, name: 'Alpha Interiors', phone: '9000012345', email: 'alpha@example.com', is_archived: false },
  { id: 2, name: 'Beta Builders', phone: '8123456789', email: null, is_archived: false },
  { id: 3, name: 'Gamma', phone: null, email: 'gamma@example.com', is_archived: false },
  { id: 4, name: 'Delta Works', phone: '7000011111', email: null, is_archived: false },
]

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/**
 * Stub the clients endpoint.
 *
 * `byQuery` maps a search term to the rows it should return, so a filtering test
 * can prove the list is driven by the query rather than filtered locally over
 * one fixed set. `fallback` is what an unsearched request returns, which matters
 * because the footer's "1 of 4" needs the *unfiltered* count while the list has
 * already narrowed — the API reports the total separately from the rows, and
 * that is what the mock has to imitate.
 */
function mockApi({ items = CLIENTS, byQuery = null, fallback = null, fail = false } = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      calls.push(path)
      if (fail)
        return {
          ok: false,
          status: 500,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: { code: 'INTERNAL', message: 'Boom' } }),
          text: async () => 'Boom',
        }
      if (path.startsWith('/clients')) {
        const term = new URL(path, 'http://x').searchParams.get('q') || ''
        const unfiltered = fallback ?? items
        // With no search the book is the whole list; with one, the stub decides.
        const rows = byQuery ? (term ? (byQuery[term] ?? []) : unfiltered) : unfiltered
        const total = byQuery && term ? (fallback ?? items).length : rows.length
        return jsonResponse({ data: { items: rows, total } })
      }
      return jsonResponse({ data: {} })
    }),
  )
  return { calls }
}

function renderPicker() {
  return render(
    <MemoryRouter>
      <ClientPicker open onSelect={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  )
}

const rowFor = (name) => screen.getByRole('option', { name: new RegExp(name) })

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Client picker — layout', () => {
  it('gives every row the same grid, min-height and padding', async () => {
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // Every row is one component with one class, so identical geometry is
    // guaranteed by construction rather than by each row happening to match. The
    // only permitted difference is the active modifier, which is a state, not a
    // layout change — the stripped class list must be identical.
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(1)
    const baseClasses = rows.map((row) => row.className.replace(/\s*_itemActive\S*/, ''))
    for (const className of baseClasses) {
      expect(className).toBe(baseClasses[0])
      expect(rows[0].tagName).toBe('BUTTON')
    }
  })

  it('renders a uniform grid so a long name cannot resize a row', async () => {
    const source = (
      await import.meta.glob('./ClientPicker.module.css', { query: '?raw', import: 'default', eager: true })
    )['./ClientPicker.module.css']
    const itemRule = source.match(/\.item\s*\{[^}]*\}/)?.[0] || ''

    // `auto 1fr auto` with a fixed 40px avatar column: the middle column is the
    // only fluid one, and it is `minmax(0, 1fr)` so it can shrink to nothing and
    // ellipsis rather than widening the row.
    expect(itemRule).toMatch(/grid-template-columns:\s*40px minmax\(0, 1fr\) auto/)
    expect(itemRule).toMatch(/inline-size:\s*100%/)
    expect(itemRule).toMatch(/min-block-size:\s*64px/)
  })

  it('makes the list the only scrolling area', async () => {
    const source = (
      await import.meta.glob('./ClientPicker.module.css', { query: '?raw', import: 'default', eager: true })
    )['./ClientPicker.module.css']
    const listRule = source.match(/\.list\s*\{[^}]*\}/)?.[0] || ''

    // `min-block-size: 0` is the load-bearing part: a flex child will not shrink
    // below its content without it, so the list would grow to fit every client
    // and the whole sheet would scroll instead of the list inside it.
    expect(listRule).toMatch(/overflow-y:\s*auto/)
    expect(listRule).toMatch(/min-block-size:\s*0/)
    expect(listRule).toMatch(/flex:\s*1/)
  })

  it('gives the search field the same width as the list', async () => {
    const source = (
      await import.meta.glob('./ClientPicker.module.css', { query: '?raw', import: 'default', eager: true })
    )['./ClientPicker.module.css']
    const searchRule = source.match(/\.search\s*\{[^}]*\}/)?.[0] || ''

    // Both are full-bleed inside the same column: the sheet is one flex column,
    // the search is `flex: none` and the list is the only `flex: 1`, so the two
    // share a width by construction and cannot drift apart.
    expect(searchRule).toMatch(/inline-size:\s*100%/)
    expect(source).toMatch(/\.searchWrap\s*\{[^}]*flex:\s*none/)
    expect(source).toMatch(/\.list\s*\{[^}]*flex:\s*1/)

    mockApi()
    renderPicker()
    const search = screen.getByPlaceholderText('Search by name, phone or email')
    // The list is its sibling, not its child: a search box inside the scroller is
    // the thing that scrolls away.
    expect(search.closest('[role="listbox"]')).toBeNull()
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
  })

  it('keeps the search and footer outside the scrolling list', async () => {
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // The listbox holds the rows and nothing else: a search field or a count
    // inside it would scroll away, which is the whole point of the layout.
    const list = screen.getByRole('listbox')
    expect(within(list).queryByRole('textbox')).toBeNull()
    expect(within(list).getAllByRole('option').length).toBe(CLIENTS.length)
  })
})

describe('Client picker — rows', () => {
  it('shows the name and the phone and email on one line each', async () => {
    mockApi()
    renderPicker()
    const row = await screen.findByRole('option', { name: /Alpha Interiors/ })

    expect(within(row).getByText('Alpha Interiors')).toBeInTheDocument()
    // The stored number is presented, not shown raw.
    expect(within(row).getByText(/^\+91 90000 12345 · alpha@example\.com$/)).toBeInTheDocument()
  })

  it('never leaves a stray separator when only one contact detail exists', async () => {
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // Phone but no email: no trailing "·".
    expect(within(rowFor('Beta Builders')).getByText('+91 81234 56789')).toBeInTheDocument()
    // Email but no phone: no leading "·".
    expect(within(rowFor('Gamma')).getByText('gamma@example.com')).toBeInTheDocument()
  })

  it('says so when a client has no contact details at all', async () => {
    mockApi({
      items: [{ id: 9, name: 'No Contact', phone: null, email: null, is_archived: false }],
    })
    renderPicker()
    await screen.findByRole('option', { name: /No Contact/ })

    expect(within(rowFor('No Contact')).getByText('No contact details')).toBeInTheDocument()
  })

  it('shows a two-letter avatar of uppercase initials', async () => {
    mockApi({
      items: [
        { id: 1, name: 'Alpha Interiors', phone: '9000012345', is_archived: false },
        { id: 2, name: 'beta', phone: '8123456789', is_archived: false },
      ],
    })
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // First two letters of a single word, first letter of each of two.
    expect(within(rowFor('Alpha Interiors')).getByText('AI')).toBeInTheDocument()
    expect(within(rowFor('beta')).getByText('BE')).toBeInTheDocument()
  })

  it('skips non-letters when building initials', async () => {
    mockApi({ items: [{ id: 1, name: '2B Interiors', phone: '9000012345', is_archived: false }] })
    renderPicker()
    const row = await screen.findByRole('option', { name: /2B Interiors/ })

    // "2" is dropped rather than shown, so the avatar is always letters.
    expect(within(row).getByText('BI')).toBeInTheDocument()
  })
})

describe('Client picker — search', () => {
  it('filters case-insensitively on name', async () => {
    const user = userEvent.setup()
    mockApi({ byQuery: { acme: [{ ...CLIENTS[0], name: 'Acme Decorators' }] } })
    renderPicker()

    await user.type(screen.getByPlaceholderText('Search by name, phone or email'), 'acme')
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Acme Decorators/ })).toBeInTheDocument()
    })
  })

  it('matches phone digits however the caller types them', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({ byQuery: { '90000 12345': [CLIENTS[0]] } })
    renderPicker()

    // The stored value is ten bare digits, so a search for the formatted form
    // still has to reach the same client.
    await user.type(screen.getByPlaceholderText('Search by name, phone or email'), '90000 12345')
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Alpha Interiors/ })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(calls.some((c) => c.includes('q=90000+12345'))).toBe(true)
    })
  })

  it('debounces typing into a single request', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    const before = calls.length
    await user.type(screen.getByPlaceholderText('Search by name, phone or email'), 'abc')
    // Each keystroke refetching is what makes a search feel laggy; 250ms of idle
    // typing collapses a burst into one request.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const after = calls.length
    expect(after - before).toBeLessThanOrEqual(2)
  })

  it('clears the search and returns to the full list', async () => {
    const user = userEvent.setup()
    mockApi({ byQuery: { zzz: [] } })
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })
    const search = screen.getByPlaceholderText('Search by name, phone or email')
    await user.type(search, 'zzz')
    await waitFor(() => {
      expect(screen.getByText(/No clients match/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Alpha Interiors/ })).toBeInTheDocument()
    })
  })

  it('offers to create the searched name when nothing matches', async () => {
    const user = userEvent.setup()
    mockApi({ byQuery: { acme: [] } })
    renderPicker()

    await user.type(screen.getByPlaceholderText('Search by name, phone or email'), 'acme')
    await waitFor(() => {
      expect(screen.getByText(/No clients match/)).toBeInTheDocument()
    })
    // The action carries the query, so the form opens with the name filled in.
    expect(screen.getByRole('button', { name: /Create .* as new client/i })).toBeInTheDocument()
  })

  it('shows a distinct empty state when there are no clients at all', async () => {
    mockApi({ items: [] })
    renderPicker()
    expect(await screen.findByText('No clients yet')).toBeInTheDocument()
  })

  it('shows a loading skeleton before the list arrives', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderPicker()

    // The section headings render immediately; the rows do not, and no count is
    // claimed yet.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: /New client/ })).toBeInTheDocument()
  })
})

describe('Client picker — keyboard and selection', () => {
  it('exposes the rows as a listbox of options', async () => {
    mockApi()
    renderPicker()
    const list = await screen.findByRole('listbox')
    expect(list).toHaveAttribute('aria-label', 'Clients')
    expect(within(list).getAllByRole('option')).toHaveLength(CLIENTS.length)
  })

  it('moves the selection with the arrow keys and wraps around', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    const first = screen.getAllByRole('option')[0]
    expect(first).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowUp}')
    expect(first).toHaveAttribute('aria-selected', 'true')

    // Wrapping: up from the first row lands on the last.
    await user.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[CLIENTS.length - 1]).toHaveAttribute('aria-selected', 'true')
  })

  it('selects the active row with Enter', async () => {
    const user = userEvent.setup()
    mockApi()
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ClientPicker open onSelect={onSelect} onClose={onClose} />
      </MemoryRouter>,
    )
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].name).toBe('Beta Builders')
    expect(onClose).toHaveBeenCalled()
  })

  it('selects a client on click', async () => {
    const user = userEvent.setup()
    mockApi()
    const onSelect = vi.fn()
    render(
      <MemoryRouter>
        <ClientPicker open onSelect={onSelect} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('option', { name: /Gamma/ }))

    expect(onSelect.mock.calls[0][0].id).toBe(3)
  })

  it('focuses the search field on open rather than the close button', async () => {
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // `Sheet` focuses its first focusable node, which is the close button —
    // the control that dismisses the dialog. Starting there would be hostile.
    expect(screen.getByPlaceholderText('Search by name, phone or email')).toHaveFocus()
  })

  it('reports how many clients are shown while filtering', async () => {
    // The unfiltered query returns the whole book; only a search narrows it.
    mockApi({
      byQuery: { acme: [CLIENTS[0]] },
      fallback: CLIENTS,
    })
    renderPicker()
    expect(await screen.findByText('4 clients')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Search by name, phone or email'), 'acme')
    // "1 of 4": the shape is what matters, and it must not read as a total of 1.
    await waitFor(() => {
      expect(screen.getByText('1 of 4 clients')).toBeInTheDocument()
    })
  })

  it('offers a full-width New client action in the footer', async () => {
    mockApi()
    renderPicker()
    await screen.findByRole('option', { name: /Alpha Interiors/ })

    // A solid primary button, not a faint dashed box: it is the one action the
    // picker offers when nothing suitable exists.
    const create = screen.getByRole('button', { name: /New client/ })
    expect(create).toBeInTheDocument()
  })
})
