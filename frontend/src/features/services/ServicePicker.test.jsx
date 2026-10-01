/**
 * Ruchita Interiors — service picker tests (SERVICES_PLAN FR-SV5/SV6/SV10).
 *
 * The picker's contract is entirely about *behaviour under taps*: it stays open so
 * several services can be added in one visit, Done closes it, it asks for a wide
 * page because it has no pager, it never asks for archived rows, and an empty
 * catalogue sends the user somewhere useful instead of leaving a dead end.
 *
 * Network is stubbed at the `fetch` boundary, exactly like
 * `clients-page.test.jsx`, so the shared `useServices` hook really runs.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ServicePicker from './ServicePicker.jsx'

const API = '/api/v1'

const SERVICES = [
  {
    id: 1,
    name: 'Modular kitchen',
    category: 'Kitchen',
    description: 'Full modular kitchen',
    unit: 'job',
    default_qty_milli: 1000,
    rate_paise: 500000,
    is_archived: false,
  },
  {
    id: 2,
    name: 'Interior painting',
    category: 'Painting',
    description: null,
    unit: 'sqft',
    default_qty_milli: 2000,
    rate_paise: 4500,
    is_archived: false,
  },
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
 * Stub the services list endpoint.
 *
 * The server filters on `q`, so the mock does too — that is what makes the search
 * test meaningful instead of just proving the input is wired up.
 */
function mockApi({ items = SERVICES } = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      calls.push(path)
      const term = new URL(path, 'http://x').searchParams.get('q') || ''
      const matched = term
        ? items.filter((s) =>
            [s.name, s.category, s.description]
              .filter(Boolean)
              .some((f) => f.toLowerCase().includes(term.toLowerCase())),
          )
        : items
      return jsonResponse({ data: { items: matched, total: matched.length, categories: [] } })
    }),
  )
  return { calls }
}

function renderPicker(props = {}) {
  const onAdd = props.onAdd || vi.fn()
  const onClose = props.onClose || vi.fn()
  const utils = render(
    <MemoryRouter>
      <ServicePicker open onAdd={onAdd} onClose={onClose} />
    </MemoryRouter>,
  )
  return { ...utils, onAdd, onClose }
}

/** The most recent services request, for asserting query parameters. */
const lastServicesCall = (calls) => calls.filter((p) => p.startsWith('/services')).pop()

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

describe('ServicePicker — adding lines', () => {
  it('adds the tapped service and stays open for another', async () => {
    const user = userEvent.setup()
    mockApi()
    const { onAdd, onClose } = renderPicker()

    await user.click(await screen.findByRole('button', { name: /Modular kitchen/i }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 1, rate_paise: 500000 })
    // The whole point of FR-SV6: one visit can add several lines.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /add from services/i })).toBeInTheDocument()
  })

  it('counts what has been added so far', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPicker()

    await user.click(await screen.findByRole('button', { name: /Modular kitchen/i }))
    await user.click(screen.getByRole('button', { name: /Interior painting/i }))

    expect(screen.getByText(/2 added/i)).toBeInTheDocument()
  })

  it('closes on Done', async () => {
    const user = userEvent.setup()
    mockApi()
    const { onClose } = renderPicker()

    await user.click(await screen.findByRole('button', { name: /^done$/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('shows the standard rate on each row', async () => {
    mockApi()
    renderPicker()

    const row = await screen.findByRole('button', { name: /Modular kitchen/i })
    // formatPaise(500000) — the rate is quoted, not raw paise.
    expect(within(row).getByText('₹5,000.00')).toBeInTheDocument()
  })
})

describe('ServicePicker — search', () => {
  it('filters the list through the shared hook', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi()
    renderPicker()

    await user.type(await screen.findByLabelText('Search services'), 'painting')

    await vi.waitFor(() => {
      expect(lastServicesCall(calls)).toContain('q=painting')
    })
    expect(screen.queryByRole('button', { name: /Modular kitchen/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Interior painting/i })).toBeInTheDocument()
  })
})

describe('ServicePicker — request shape', () => {
  it('asks for one wide page, because the sheet has no pager', async () => {
    const { calls } = mockApi()
    renderPicker()

    await screen.findByRole('button', { name: /Modular kitchen/i })
    expect(lastServicesCall(calls)).toContain('page_size=100')
  })

  it('never asks for archived services', async () => {
    const { calls } = mockApi()
    renderPicker()

    await screen.findByRole('button', { name: /Modular kitchen/i })
    expect(lastServicesCall(calls)).not.toContain('include_archived')
  })
})

describe('ServicePicker — empty catalogue', () => {
  it('offers a link that opens the create form on the Services page', async () => {
    mockApi({ items: [] })
    renderPicker()

    const link = await screen.findByRole('link', { name: /new service/i })
    expect(link).toHaveAttribute('href', '/services?new=1')
  })

  it('says so plainly instead of implying an empty search result', async () => {
    mockApi({ items: [] })
    renderPicker()

    expect(await screen.findByText(/catalogue is empty/i)).toBeInTheDocument()
  })

  it('drops the create shortcut once a search is running — the services may exist', async () => {
    const user = userEvent.setup()
    mockApi({ items: [] })
    renderPicker()

    await user.type(await screen.findByLabelText('Search services'), 'sofa')

    await vi.waitFor(() => {
      expect(screen.getByText(/no services match your search/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /new service/i })).toBeNull()
  })
})
