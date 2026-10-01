import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider } from '../settings/SettingsProvider.jsx'
import ServicesPage from './ServicesPage.jsx'

/**
 * Services page — mobile card layout (§6).
 *
 * The reported defects were all one thing: everything was on a single line. A
 * long name ran under the price, the category wrapped to an orphan, "per job"
 * collided with the text, and the Edit/Archive buttons squeezed the content
 * instead of sitting beneath it.
 *
 * These assertions are split deliberately:
 *
 * - **Structure** is asserted on the rendered DOM, because that is what a screen
 *   reader and a keyboard user get.
 * - **Geometry** is asserted against the stylesheet *source*, because jsdom does
 *   not resolve custom properties, so a computed style cannot tell us which token
 *   a rule would actually pick up. Same approach `clients-page.test.jsx` takes for
 *   its `.rowTitle` regression.
 */

const API = '/api/v1'

/** Worst case from the acceptance list: a long name and an Indian-grouped price. */
const SERVICES = [
  {
    id: 1,
    name: 'Full modular kitchen worktop installation and finishing',
    category: 'Kitchen',
    description: 'Includes templates, edges, and site polish.',
    unit: 'job',
    rate_paise: 12500000,
    is_archived: false,
  },
  {
    id: 2,
    name: 'Painting',
    category: null,
    description: null,
    unit: 'sqft',
    rate_paise: 4500,
    is_archived: true,
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

function mockApi({ items = SERVICES } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      if (path.startsWith('/services')) {
        return jsonResponse({ data: { items, total: items.length, categories: ['Kitchen', 'Painting'] } })
      }
      return jsonResponse({ data: {} })
    }),
  )
}

function renderPage() {
  return render(
    <MemoryRouter>
      {/* The page renders `ServiceFormModal`, which reads company settings for the
          logo; the provider is what the route table supplies in the real app. */}
      <SettingsProvider>
        <ServicesPage />
      </SettingsProvider>
    </MemoryRouter>,
  )
}

/**
 * The rendered service cards, in list order.
 *
 * Addressed by role rather than by name text, because a name can legitimately
 * repeat — "Painting" is both a service name and a category chip on the same
 * screen, and a name-based query would be ambiguous.
 */
const cards = () => screen.getAllByRole('article')

/**
 * The card for one fixture service, located by its name *within* the card list.
 *
 * Narrowing to `cards()` first is what keeps this unambiguous: a bare
 * `screen.getByText(name)` also matches the category chip, because "Painting" is
 * both a service name and a category on this screen. `queryAllByText` rather than
 * `queryByText` because a card can legitimately contain the name twice — the
 * second fixture is named "Painting" *and* categorised "Painting" — and the
 * singular query throws on a multiple match.
 */
const cardFor = (name) => {
  const card = cards().find((candidate) => within(candidate).queryAllByText(name).length > 0)
  if (!card) throw new Error(`No service card contains the name ${JSON.stringify(name)}`)
  return card
}

const stylesheet = () =>
  (
    import.meta.glob('./ServicesPage.module.css', { query: '?raw', import: 'default', eager: true })[
      './ServicesPage.module.css'
    ] || ''
  ).toString()

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

describe('Services page — card structure', () => {
  it('stacks the card in rows instead of one crowded line', async () => {
    mockApi()
    renderPage()
    await screen.findByText(SERVICES[0].name)
    const card = cardFor(SERVICES[0].name)

    // Head (name + price), meta (pills + unit), description, actions — four
    // sibling rows. A single `.row` wrapper is exactly what used to break.
    expect(card.querySelector('[class*="headRow"]')).toBeInTheDocument()
    expect(card.querySelector('[class*="metaRow"]')).toBeInTheDocument()
    expect(card.querySelector('[class*="actions"]')).toBeInTheDocument()
  })

  it('shows the name and the price as separate, independently shrinkable parts', async () => {
    mockApi()
    renderPage()
    await screen.findByText(SERVICES[0].name)
    const card = cardFor(SERVICES[0].name)

    const name = within(card).getByText(SERVICES[0].name)
    const price = within(card).getByText('₹1,25,000.00')

    // They are siblings in the head row, not nested — nesting is what let the
    // name overlap the price.
    expect(name.parentElement).toBe(price.parentElement)
    expect(name).not.toBe(price)
  })

  it('renders the rate with the Indian grouping the app uses everywhere', async () => {
    mockApi()
    renderPage()
    // Not "Rs." and not an ungrouped figure: the same `formatPaise` as every
    // other money surface (§8.1).
    expect(await screen.findByText('₹1,25,000.00')).toBeInTheDocument()
    expect(screen.getByText('₹45.00')).toBeInTheDocument()
  })

  it('renders the category as a pill and the unit right-aligned on the same row', async () => {
    mockApi()
    renderPage()
    // Await the list first: without it `cards()` runs against the skeleton state
    // and finds no articles, which fails as "unable to find role article" and
    // reads like a rendering bug rather than a missing await.
    await screen.findByText(SERVICES[0].name)
    const card = cardFor(SERVICES[0].name)
    const metaRow = card.querySelector('[class*="metaRow"]')

    expect(within(metaRow).getByText('Kitchen')).toBeInTheDocument()
    expect(within(metaRow).getByText('per job')).toBeInTheDocument()
  })

  it("omits the unit's word but keeps a default when the unit is missing", async () => {
    mockApi({ items: [{ ...SERVICES[0], unit: null }] })
    renderPage()
    expect(await screen.findByText('per job')).toBeInTheDocument()
  })

  it('omits the description row entirely when there is none', async () => {
    mockApi()
    renderPage()
    await screen.findByText(SERVICES[0].name)
    // A blank row is what made the card look broken on sparse entries.
    expect(cardFor(SERVICES[1].name).querySelector('[class*="description"]')).toBeNull()
  })

  it('shows Edit and Restore for an archived service, never Archive', async () => {
    mockApi()
    renderPage()
    // Await a name that is unambiguous on this screen. "Painting" cannot be used:
    // it is the second service's name *and* a category chip, so a page-level text
    // query for it is ambiguous by construction — the same trap `cardFor` exists
    // to avoid. The first fixture's long name appears nowhere else.
    await screen.findByText(SERVICES[0].name)
    const card = cardFor(SERVICES[1].name)

    expect(within(card).getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /restore/i })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^archive$/i })).toBeNull()
    expect(within(card).getByText('Archived')).toBeInTheDocument()
  })

  it('still offers Archive on an active service', async () => {
    mockApi()
    renderPage()
    await screen.findByText(SERVICES[0].name)
    const card = cardFor(SERVICES[0].name)
    expect(within(card).getByRole('button', { name: /^archive$/i })).toBeInTheDocument()
  })
})

describe('Services page — layout rules', () => {
  /**
   * One rule block out of the stylesheet, by selector.
   *
   * The selector is matched up to its `{`, so a descendant selector works:
   * `rule('actions > *')` returns the `.actions > * { … }` block. Matching only
   * up to the class name would silently return the `.actions { … }` block for
   * `rule('actions')` — which is exactly the distinction these assertions are
   * about, so it cannot be fuzzy.
   */
  const rule = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return stylesheet().match(new RegExp(`\\.${escaped}\\s*\\{[^}]*\\}`))?.[0] || ''
  }

  it('keeps the price on one line and the name able to shrink', () => {
    // `flex-shrink: 0` on the price is what stops a long name pushing it off the
    // card; `min-width: 0` on the name is what lets it truncate at all.
    expect(rule('rateValue')).toMatch(/flex-shrink:\s*0/)
    expect(rule('rateValue')).toMatch(/white-space:\s*nowrap/)
    expect(rule('rateValue')).toMatch(/tabular-nums/)
    expect(rule('name')).toMatch(/min-width:\s*0/)
  })

  it('clamps the name and description to two lines with an ellipsis', () => {
    // A third line would push the price and the actions off a 360px card.
    expect(rule('name')).toMatch(/-webkit-line-clamp:\s*2/)
    expect(rule('name')).toMatch(/overflow:\s*hidden/)
    expect(rule('description')).toMatch(/-webkit-line-clamp:\s*2/)
  })

  it('lays the head row out with space-between and a fixed gap', () => {
    expect(rule('headRow')).toMatch(/display:\s*flex/)
    expect(rule('headRow')).toMatch(/justify-content:\s*space-between/)
    expect(rule('headRow')).toMatch(/align-items:\s*flex-start/)
    expect(rule('headRow')).toMatch(/gap:\s*12px/)
  })

  it('gives the two actions equal columns that cannot wrap or shrink', () => {
    expect(rule('actions')).toMatch(/grid-template-columns:\s*1fr 1fr/)
    expect(rule('actions')).toMatch(/gap:\s*8px/)
    // The divider above the action row.
    expect(rule('actions')).toMatch(/border-block-start:\s*var\(--border-width\) solid var\(--color-border\)/)
    // `nowrap` lives on `.actions > *`, not on `.actions` itself: it is the
    // buttons that must not wrap their labels, and the grid container itself has
    // no text to wrap. Asserting it on the container would pass for the wrong
    // reason — or fail against a correct stylesheet.
    expect(rule('actions > *')).toMatch(/white-space:\s*nowrap/)
  })

  it('reserves no space for the removed bottom bar', () => {
    // The fixed bottom bar is gone, replaced by the drawer, so the page must not
    // keep an inset for it — a stale reservation leaves a band of dead space at
    // the bottom of every services page. `.main` owns the page padding.
    expect(rule('page')).not.toMatch(/--size-bottom-nav/)
    expect(rule('page')).not.toMatch(/safe-area-inset-bottom/)
  })

  it('keeps the search field full width with a 44px target and room for its icons', () => {
    expect(rule('search')).toMatch(/inline-size:\s*100%/)
    expect(rule('search')).toMatch(/min-block-size:\s*var\(--touch-target-min\)/)
    // Leading icon + trailing clear must not cover typed text.
    expect(rule('search')).toMatch(/padding-inline:\s*2\.75rem 2\.5rem/)
  })

  it('keeps the category chips on one scrollable line', () => {
    expect(rule('chipScroller')).toMatch(/overflow-x:\s*auto/)
    expect(rule('chipScroller')).toMatch(/white-space:\s*nowrap/)
    expect(rule('chipScroller')).toMatch(/scrollbar-width:\s*none/)
    expect(rule('chip')).toMatch(/block-size:\s*36px/)
    // Active chip reads as dark in both themes via the primary token pair.
    expect(rule('chipActive')).toMatch(/background:\s*var\(--color-primary\)/)
  })

  it('uses the 16px icon size the actions spec calls for', () => {
    expect(stylesheet()).toMatch(/\.actions svg\s*\{[^}]*inline-size:\s*16px/)
  })
})

describe('Services page — search field', () => {
  it('uses a short placeholder that fits a narrow field', async () => {
    mockApi()
    renderPage()
    // The old "Search by name, category or description…" was clipped at 360px.
    const search = await screen.findByPlaceholderText('Search services')
    expect(search).toBeInTheDocument()
  })

  it('keeps an accessible name even though the label is visually hidden', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByLabelText('Search services')).toBeInTheDocument()
  })

  it('offers a clear control only while there is text', async () => {
    const user = userEvent.setup()
    mockApi()
    renderPage()
    const search = await screen.findByPlaceholderText('Search services')

    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    await user.type(search, 'kit')
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('keeps the Show archived toggle with a full-height tap area', async () => {
    mockApi()
    renderPage()
    const toggle = await screen.findByRole('checkbox', { name: 'Show archived' })
    expect(toggle).toHaveAttribute('type', 'checkbox')
  })
})
