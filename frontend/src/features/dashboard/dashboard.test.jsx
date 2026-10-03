import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../../pages/Dashboard.jsx'
import DashboardCharts from './DashboardCharts.jsx'
import { chrome, shortRupees } from './charts.jsx'
import { CHART_GRID, CHART_TICK, useChartTheme } from './chartTheme.js'

/**
 * Phase 9 Dashboard tests (§4.6, §9.2, §20, §24).
 *
 * The Dashboard's job is to be *truthful*, so the tests are mostly about it not
 * inventing or re-deriving anything: the tiles must show the server's paise
 * figures verbatim, there must be exactly one request, and the recent lists must
 * link where they claim to.
 *
 * The payload below is a real `GET /dashboard/summary` response shape, so a
 * change to the contract fails these tests rather than silently rendering
 * "undefined" on the page.
 */

const API = '/api/v1'

const MONTHS = [
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
]

const DAYS = Array.from({ length: 30 }, (_, index) => {
  const day = new Date(2026, 8, 30 - (29 - index))
  const iso = day.toISOString().slice(0, 10)
  return {
    date: iso,
    quotation_count: index === 20 ? 2 : 0,
    quotation_value: index === 20 ? 500000 : 0,
    invoiced_value: index === 25 ? 1100000 : 0,
    received_value: index === 29 ? 200000 : 0,
  }
})

/** A summary with distinctive numbers, so a wrong figure is unmistakable. */
function summary(overrides = {}) {
  return {
    quotation_counts: { draft: 2, sent: 1, approved: 1, rejected: 1, converted: 7 },
    quotation_values: {
      draft_value: 800000,
      sent_value: 200000,
      approved_value: 300000,
      rejected_value: 400000,
      converted_value: 2830000,
      total_quotation_value: 4530000,
    },
    money: { invoiced_value: 1100000, received_total: 800000, outstanding_total: 300000 },
    monthly: MONTHS.map((month, index) => ({
      month,
      quotation_count: index === 11 ? 3 : index === 6 ? 1 : 0,
      quotation_value: index === 11 ? 1130000 : index === 6 ? 900000 : 0,
      invoiced_value: index === 11 ? 1100000 : 0,
      received_value: index === 11 ? 200000 : index === 10 ? 600000 : 0,
    })),
    daily: DAYS,
    recent: {
      quotations: [
        {
          id: 12,
          number: 'QTN-2026-0012',
          client_name: 'Alpha Interiors',
          status: 'approved',
          grand_total_paise: 300000,
          date: '2026-09-20',
        },
        {
          id: 11,
          number: 'QTN-2026-0011',
          client_name: 'Beta Builders',
          status: 'sent',
          grand_total_paise: 200000,
          date: '2026-09-18',
        },
      ],
      invoices: [
        {
          id: 5,
          number: 'INV-2026-0005',
          client_name: 'Beta Builders',
          status: 'issued',
          grand_total_paise: 500000,
          paid_paise: 200000,
          outstanding_paise: 300000,
          payment_status: 'partially_paid',
          date: '2026-08-07',
        },
      ],
      clients: [
        { id: 2, name: 'Beta Builders', phone: '+91 90000 00002', created_at: '2026-09-01T09:00:00' },
      ],
    },
    ...overrides,
  }
}

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/**
 * Mock the endpoint the page needs. Returns the call log.
 *
 * Only `/dashboard/summary`: the Dashboard no longer reads Settings for the brand
 * mark, because it no longer renders one. The logo belongs to the sidebar, which
 * `AppShell` supplies.
 */
function mockApi({ data = summary(), fail = null } = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url)
      calls.push({ url: path })
      if (fail) return fail
      return jsonResponse({ data })
    }),
  )
  return { calls }
}

/** Calls to the Dashboard's own endpoint. */
const dashboardCalls = ({ calls }) => calls.filter((call) => call.url.endsWith('/dashboard/summary'))

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // The chart chunk is loaded with React.lazy; awaiting the tiles (or an explicit
  // findBy) is what flushes it, so no test needs to know about the boundary.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('Dashboard', () => {
  // ---------------------------------------------------------- one request

  it('powers the whole page from exactly one request', async () => {
    const { calls } = mockApi()
    renderDashboard()

    await screen.findByText('Outstanding')
    // §9.2: "one request, one query set". A second Dashboard call would mean the
    // page fanned out and is re-deriving something the server already computed.
    // The settings fetch is AppShell-level state (Phase 3), not a Dashboard call.
    const mine = dashboardCalls({ calls })
    expect(mine).toHaveLength(1)
    expect(mine[0].url).toBe(`${API}/dashboard/summary`)
  })

  // ------------------------------------------------------------- metrics

  it('renders every FR-D1 metric from the response', async () => {
    mockApi()
    renderDashboard()

    // Quotation counts, total value, approved value, invoiced, received, outstanding.
    for (const label of [
      'Quotations',
      'Quotation value',
      'Approved value',
      'Invoiced',
      'Received',
      'Outstanding',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('formats money with the shared Indian grouping, not raw paise', async () => {
    mockApi()
    renderDashboard()

    // Scoped to the tiles: the same rupee figures also appear in the recent rows,
    // and a page-wide query would be ambiguous rather than wrong.
    const tile = async (label) => within((await screen.findByText(label)).closest('[data-metric]'))

    // total_quotation_value 4 530 000 paise -> ₹45,300.00
    expect((await tile('Quotation value')).getByText('₹45,300.00')).toBeInTheDocument()
    // approved_value 300 000 -> ₹3,000.00
    expect((await tile('Approved value')).getByText('₹3,000.00')).toBeInTheDocument()
    // invoiced 1 100 000 -> ₹11,000.00
    expect((await tile('Invoiced')).getByText('₹11,000.00')).toBeInTheDocument()
    // received 800 000 -> ₹8,000.00
    expect((await tile('Received')).getByText('₹8,000.00')).toBeInTheDocument()
    // outstanding 300 000 -> ₹3,000.00
    expect((await tile('Outstanding')).getByText('₹3,000.00')).toBeInTheDocument()
  })

  it('shows the server figures verbatim and computes nothing of its own', async () => {
    // outstanding is deliberately NOT invoiced - received on this payload; if the
    // page derived it, the tile would read ₹3,000.00 instead of the sent ₹999.00.
    const data = summary()
    data.money = { invoiced_value: 1100000, received_total: 800000, outstanding_total: 99900 }
    mockApi({ data })
    renderDashboard()

    const tile = (await screen.findByText('Outstanding')).closest('[data-metric]')
    expect(within(tile).getByText('₹999.00')).toBeInTheDocument()
    // And the tempting-but-wrong derivation is absent.
    expect(within(tile).queryByText('₹3,000.00')).not.toBeInTheDocument()
  })

  it('sums the quotation count tile from the per-status counts', async () => {
    // 2+1+1+1+7 = 12. The only addition the page does is counting statuses for
    // one headline figure, not any money.
    mockApi()
    renderDashboard()

    const tile = (await screen.findByText('Quotations')).closest('[data-metric]')
    expect(within(tile).getByText('12')).toBeInTheDocument()
  })

  it('tones the outstanding tile only when money is owed', async () => {
    // Settled business: nothing outstanding, so the tile must not read as "due".
    const settled = summary()
    settled.money = { invoiced_value: 1100000, received_total: 1100000, outstanding_total: 0 }
    mockApi({ data: settled })
    renderDashboard()

    const tile = (await screen.findByText('Outstanding')).closest('[data-metric]')
    expect(within(tile).getByText('₹0.00')).toBeInTheDocument()
    expect(tile.className).not.toMatch(/due/)
  })

  it('marks outstanding as due when money is still owed', async () => {
    mockApi()
    renderDashboard()

    const tile = (await screen.findByText('Outstanding')).closest('[data-metric]')
    expect(within(tile).getByText('₹3,000.00')).toBeInTheDocument()
    expect(tile.className).toMatch(/due/)
  })

  // -------------------------------------------------------------- states

  it('shows skeletons while loading, not a spinner', async () => {
    // The request stays pending until released, so the loading state is real
    // rather than a fast resolve that hides it.
    let release
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve(jsonResponse({ data: summary() }))
          }),
      ),
    )
    renderDashboard()

    const region = await screen.findByLabelText('Summary totals, loading')
    expect(region).toHaveAttribute('aria-busy', 'true')

    release()
    await waitFor(() => expect(screen.getByText('Outstanding')).toBeInTheDocument())
  })

  it('offers a retry on failure and refetches', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      fail: jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, { ok: false, status: 500 }),
    })
    renderDashboard()

    expect(await screen.findByText('Dashboard could not be loaded')).toBeInTheDocument()
    // A 5xx is not a connectivity problem, and saying so is what sent a previous
    // investigation to the wrong place.
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
    expect(screen.getByText(/it is running, but the request failed/i)).toBeInTheDocument()

    // The retry re-issues the one request.
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
  })

  it('blames connectivity only for a transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderDashboard()

    expect(await screen.findByText(/you appear to be offline/i)).toBeInTheDocument()
  })

  it('invites a first document when nothing exists yet', async () => {
    const empty = summary({
      recent: { quotations: [], invoices: [], clients: [] },
      monthly: MONTHS.map((month) => ({
        month,
        quotation_count: 0,
        quotation_value: 0,
        invoiced_value: 0,
        received_value: 0,
      })),
      money: { invoiced_value: 0, received_total: 0, outstanding_total: 0 },
    })
    mockApi({ data: empty })
    renderDashboard()

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
    // Scoped to the empty state, because the page header carries a "New
    // quotation" button too and a page-wide query would be ambiguous.
    const state = screen.getByText('Nothing here yet').closest('div')
    expect(within(state).getByRole('link', { name: /new quotation/i })).toHaveAttribute(
      'href',
      '/quotations/new',
    )
    // Six zero tiles would be noise; the CTA replaces them.
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument()
  })

  it('keeps exactly one level-one heading in every state', async () => {
    mockApi()
    const { unmount } = renderDashboard()
    await screen.findByText('Outstanding')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    unmount()

    mockApi({ fail: jsonResponse({ error: { code: 'INTERNAL', message: 'x' } }, { ok: false, status: 500 }) })
    renderDashboard()
    await screen.findByText('Dashboard could not be loaded')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // ------------------------------------------------------------- branding

  /**
   * The sidebar is the app's one brand placement (S18.6). The Dashboard used to
   * carry a second copy � first a standalone eyebrow, then a logo-and-wordmark
   * pair above the heading � so the company name appeared twice in one view.
   * These assert the content area stays clear of it.
   */
  it('does not repeat the company name in the page content', async () => {
    mockApi()
    const { container } = renderDashboard()
    await screen.findByText('Outstanding')

    // No wordmark, and no standalone eyebrow either.
    expect(screen.queryByText(/ruchita interiors/i)).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/ruchita interiors/i)
  })

  it('does not render a brand logo in the page content', async () => {
    mockApi()
    const { container } = renderDashboard()
    await screen.findByText('Outstanding')

    // The charts are the only images the content should own, and they are lazy;
    // no branding mark may appear here.
    const brandLogos = [...container.querySelectorAll('img')].filter((img) =>
      /logo|brand/i.test(img.getAttribute('src') || ''),
    )
    expect(brandLogos).toHaveLength(0)
  })

  it('keeps exactly one level-one heading with the branding gone', async () => {
    mockApi()
    renderDashboard()
    await screen.findByText('Outstanding')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  // --------------------------------------------------------- recent lists

  it('renders the three recent lists and links to the right places', async () => {
    mockApi()
    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Recent quotations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent invoices' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent clients' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'QTN-2026-0012' })).toHaveAttribute('href', '/quotations/12')
    expect(screen.getByRole('link', { name: 'INV-2026-0005' })).toHaveAttribute('href', '/invoices/5')
    expect(screen.getByRole('link', { name: 'Beta Builders' })).toHaveAttribute('href', '/clients/2')
  })

  it('shows an invoice row with its paid and outstanding figures', async () => {
    mockApi()
    renderDashboard()

    const row = (await screen.findByRole('link', { name: 'INV-2026-0005' })).closest('li')
    expect(within(row).getByText('₹5,000.00')).toBeInTheDocument() // grand total
    expect(within(row).getByText('₹3,000.00')).toBeInTheDocument() // outstanding
    expect(within(row).getByText('Partially paid')).toBeInTheDocument()
  })

  it('links each recent list to its full list view', async () => {
    mockApi()
    renderDashboard()

    const quotations = (await screen.findByRole('heading', { name: 'Recent quotations' })).closest('section')
    expect(within(quotations).getByRole('link', { name: 'All quotations' })).toHaveAttribute(
      'href',
      '/quotations',
    )

    const invoices = screen.getByRole('heading', { name: 'Recent invoices' }).closest('section')
    expect(within(invoices).getByRole('link', { name: 'All invoices' })).toHaveAttribute('href', '/invoices')
  })

  it('states an empty list rather than showing a blank panel', async () => {
    const data = summary()
    data.recent.invoices = []
    mockApi({ data })
    renderDashboard()

    const invoices = (await screen.findByRole('heading', { name: 'Recent invoices' })).closest('section')
    expect(within(invoices).getByText('No invoices yet.')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------- charts
//
// The charts are drawn at a fixed 640x240 rather than through
// `ResponsiveContainer`. Recharts measures its container to decide how much SVG
// to emit, and jsdom has no layout engine, so a responsive chart renders nothing
// there. Passing explicit dimensions is the component's supported way to draw
// without a layout engine, and it is exactly what the page itself does not do —
// so these tests still cover the real responsive path's data, chrome and
// formatting, and the responsive wrapper is covered by the mount assertions.

describe('Dashboard charts', () => {
  const SIZE = { width: 640, height: 240 }

  it('mounts both charts once the lazy chunk resolves', async () => {
    mockApi()
    const { container } = renderDashboard()

    // The charts are code-split behind React.lazy, so they land after the tiles.
    // Both sections must be present on the page. (Their SVG geometry is asserted
    // separately at a fixed size — a responsive chart cannot be measured in jsdom.)
    await waitFor(() => expect(container.querySelector('[data-chart="trend"]')).toBeInTheDocument())
    expect(container.querySelector('[data-chart="status-breakdown"]')).toBeInTheDocument()
    // Both sit under the same "Trends" landmark.
    const trends = screen.getByLabelText('Trends')
    expect(within(trends).getByText('Invoiced vs received')).toBeInTheDocument()
    expect(within(trends).getByText('Quotations by status')).toBeInTheDocument()
  })

  it('plots a line per money series', async () => {
    mockApi()
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...SIZE} />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(container.querySelectorAll('[data-chart="trend"] .recharts-line-curve').length).toBeGreaterThan(
        0,
      ),
    )
    // Two series: invoiced and received (§18.8 caps a chart at three).
    expect(container.querySelectorAll('[data-chart="trend"] .recharts-line-curve').length).toBe(2)
  })

  it('draws both series without a NaN path', async () => {
    mockApi()
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...SIZE} />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(container.querySelectorAll('[data-chart="trend"] .recharts-line-curve').length).toBe(2),
    )
    for (const curve of container.querySelectorAll('[data-chart="trend"] .recharts-line-curve')) {
      // Zero-filled months must produce real geometry, not a broken path.
      expect(curve.getAttribute('d')).toBeTruthy()
      expect(curve.getAttribute('d')).not.toMatch(/NaN/)
    }
  })

  it('plots all twelve monthly buckets', async () => {
    mockApi()
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...SIZE} />
      </MemoryRouter>,
    )

    const trend = container.querySelector('[data-chart="trend"]')
    await waitFor(() =>
      expect(trend.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length).toBeGreaterThan(
        0,
      ),
    )
    // Scoped to the trend chart: the breakdown chart on the same surface has its
    // own five status ticks. Every month gets one, including zero-filled ones — a
    // missing bucket would shift every later point left along the line.
    expect(trend.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length).toBe(12)
  })

  it('renders one bar per quotation status, including the zeroes', async () => {
    mockApi()
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...SIZE} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(container.querySelectorAll('.recharts-rectangle').length).toBeGreaterThan(0))
    expect(container.querySelectorAll('[data-chart="status-breakdown"] .recharts-rectangle').length).toBe(5)
  })

  it('paints axis tick text with an ink token, never the grid colour', () => {
    // Regression guard. The tick fill used to be `--chart-grid`, which is a *line*
    // colour: #e4e0d5 on #ffffff in light and #353026 on #1c1915 in dark, both about
    // 1.3:1. Every axis label — the months, and `approved` / `rejected` on the status
    // chart — was therefore invisible in BOTH themes.
    //
    // Asserted on the axis props rather than the rendered DOM on purpose: Recharts
    // emits its tick labels as empty `<g>` elements under jsdom, with no `<text>`
    // child, so there is nothing in the document to read a fill off.
    expect(chrome(false).tick.fill).toBe(CHART_TICK())
    expect(chrome(true).tick.fill).toBe(CHART_TICK())

    // The actual bug, stated as an inequality so the test names it.
    expect(chrome(false).tick.fill).not.toBe(CHART_GRID())
    expect(chrome(true).tick.fill).not.toBe(CHART_GRID())

    // The grid line still uses the grid token — the two roles must not be swapped.
    expect(chrome(false).stroke).toBe(CHART_GRID())
  })

  it('repaints when the theme changes, without any other interaction', async () => {
    // Regression guard. `useTheme` sets `data-theme` in an effect, and the toggle
    // lives in the header — so nothing re-rendered the Dashboard and the charts
    // kept the colours of the previous theme. A reader had to change the date range
    // before the chart caught up. `useChartTheme` watches the attribute, so the
    // charts follow the theme on their own.
    //
    // Counts renders of the component that calls the hook, not of a parent wrapper:
    // the state lives inside the hook, so React re-renders that component alone and
    // a parent would never re-render at all.
    let renders = 0
    function ThemeProbe() {
      renders += 1
      useChartTheme()
      return null
    }

    render(<ThemeProbe />)
    const before = renders

    // setAttribute to the value already present is not a mutation, so the observer
    // would never fire. Flip to whatever the attribute is not, then put it back.
    const root = document.documentElement
    const original = root.getAttribute('data-theme')
    const next = original === 'dark' ? 'light' : 'dark'

    try {
      await act(async () => {
        root.setAttribute('data-theme', next)
      })
      await waitFor(() =>
        expect(renders, 'the chart did not re-render on a theme switch').toBeGreaterThan(before),
      )
    } finally {
      await act(async () => {
        if (original === null) root.removeAttribute('data-theme')
        else root.setAttribute('data-theme', original)
      })
    }
  })

  describe('chart text contrast, both themes at once', () => {
    /**
     * Why this reads the stylesheet instead of the DOM.
     *
     * jsdom does not resolve CSS custom properties, so a rendered chart cannot tell
     * us which theme's values it got — every assertion here would see the same
     * light-theme fallback. Reading `tokens.css` directly is the only way to check
     * the DARK theme, and the dark theme is exactly where the bug was invisible:
     * `--chart-grid` (#353026) and `--color-border` (#353026) are the same value, so
     * the grid lines were the only thing on the card that could be seen at all.
     *
     * Checking both themes in one test is deliberate. Fixing a contrast bug by
     * hardcoding the other theme's value is the failure mode this is meant to stop.
     */

    // Resolved from the working directory rather than `import.meta.url`: Vitest's
    // jsdom transform leaves `import.meta.url` on a non-`file:` scheme, which
    // `fileURLToPath` rejects. Vitest runs with the frontend directory as its root,
    // which is where `npm run test` is invoked from.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

    /** Token values from the light block and from the `[data-theme='dark']` block. */
    function themeTokens() {
      // Split on the selector that OPENS the rule, brace included — a plain
      // `indexOf("[data-theme='dark']")` matches an earlier mention in a comment,
      // which silently leaves the light block inside the "dark" slice and reports
      // light values as dark ones.
      const darkStart = css.search(/\[\s*data-theme=['"]dark['"]\s*\]\s*\{/)
      expect(darkStart, "no [data-theme='dark'] rule found in tokens.css").toBeGreaterThan(-1)
      const light = css.slice(0, darkStart)
      const dark = css.slice(darkStart)
      const read = (block, name) => {
        const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
        return match?.[1]
      }
      return { light, dark, read }
    }

    /** WCAG relative-luminance contrast ratio. */
    function contrast(a, b) {
      const channel = (value) => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      const luminance = (hex) => {
        const n = parseInt(hex.slice(1), 16)
        return (
          0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
        )
      }
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    it.each([
      ['light', 'light'],
      ['dark', 'dark'],
    ])('keeps every chart text token above 4.5:1 in the %s theme', (_label, key) => {
      const { light, dark, read } = themeTokens()
      const block = key === 'light' ? light : dark
      const surface = read(block, '--color-surface')

      // Ticks, the legend, and the tooltip values all resolve to these three.
      // 4.5:1 is the WCAG AA floor for text at 11-12px.
      for (const name of ['--color-ink', '--color-ink-muted', '--color-ink-subtle']) {
        const value = read(block, name)
        expect(value, `${name} missing from the ${key} block`).toBeTruthy()
        expect(
          contrast(value, surface),
          `${name} (${value}) on ${key} surface ${surface} is below 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('never paints text with the grid token, in either theme', () => {
      const { light, dark, read } = themeTokens()
      for (const key of ['light', 'dark']) {
        const block = key === 'light' ? light : dark
        const grid = read(block, '--chart-grid')
        const surface = read(block, '--color-surface')

        // The grid is a LINE colour and is meant to sit just off the background.
        // Asserting that it is unusable as text is the point: it is precisely why
        // it must never reach `tick.fill`, and this documents the trap for anyone
        // tempted to "just use the chart colour" for a label.
        expect(
          contrast(grid, surface),
          `--chart-grid (${grid}) is legible as text on ${key} surface ${surface}, so the ` +
            'grid/token mix-up would no longer be caught by contrast alone',
        ).toBeLessThan(3)
      }
    })
  })

  it('labels both charts so they are identifiable without colour', async () => {
    mockApi()
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...SIZE} />
      </MemoryRouter>,
    )

    expect(container.textContent).toContain('Invoiced vs received')
    expect(container.textContent).toContain('Quotations by status')
    // The legend names both money series (FR-D3 / §18.8: label, not hue alone).
    expect(container.textContent).toContain('Invoiced')
    expect(container.textContent).toContain('Received')
  })

  it('shortens axis values with Indian units rather than printing raw rupees', () => {
    // Indian short units (lakh / thousand), so a 12-point axis stays legible.
    expect(shortRupees(100000000)).toBe('₹10L') // 10,00,000.00 paise = ₹10 lakh
    expect(shortRupees(12000000)).toBe('₹1.2L') // 1,20,000.00 paise = ₹1.2 lakh
    expect(shortRupees(1000000)).toBe('₹10K') // 10,000.00 paise = ₹10 thousand
    expect(shortRupees(0)).toBe('₹0')
    // Lakh grouping, not thousands: a lakh is 1,00,000, not 100,000.
    expect(shortRupees(10000000000)).toBe('₹10Cr')
  })
})

// ------------------------------------------------------------ range filter

/**
 * The 7 / 14 / 30-day range control.
 *
 * The important property is that switching range never refetches: the `daily`
 * series arrives with the one summary request and the control only slices it, so
 * §9.2's "one request, one query set" still holds after a range change. A
 * control that refetched would pass a visual check and fail the actual rule.
 */
describe('Dashboard trend range filter', () => {
  const SIZE = { width: 640, height: 240 }

  function renderCharts(props = {}) {
    const onRangeChange = props.onRangeChange || (() => {})
    const utils = render(
      <MemoryRouter>
        <DashboardCharts data={summary()} {...props} {...SIZE} />
      </MemoryRouter>,
    )
    return { ...utils, onRangeChange }
  }

  it('offers 12 months plus 7, 14 and 30 days', () => {
    renderCharts({ onRangeChange: () => {} })
    const group = screen.getByRole('radiogroup', { name: 'Trend range' })

    for (const label of ['12 months', '7 days', '14 days', '30 days']) {
      expect(within(group).getByRole('radio', { name: label })).toBeInTheDocument()
    }
  })

  it('starts on the 12-month view and marks it selected', () => {
    renderCharts({ onRangeChange: () => {} })

    const group = screen.getByRole('radiogroup', { name: 'Trend range' })
    expect(within(group).getByRole('radio', { name: '12 months' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: '7 days' })).not.toBeChecked()
  })

  it('reports the chosen range when its pill is clicked', async () => {
    const user = userEvent.setup()
    const onRangeChange = vi.fn()
    renderCharts({ onRangeChange })

    // The real interaction is the visible pill, not the 1px radio underneath it.
    await user.click(screen.getByText('7 days'))
    expect(onRangeChange).toHaveBeenCalledWith(7)
  })

  it('renders the 12 monthly buckets by default', () => {
    const { container } = renderCharts({ onRangeChange: () => {} })
    const trend = container.querySelector('[data-chart="trend"]')

    expect(trend).toHaveAttribute('data-range', '12m')
    expect(trend.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length).toBe(12)
  })

  it('renders only the selected number of daily points', () => {
    const { container } = renderCharts({ onRangeChange: () => {}, range: 7 })
    const trend = container.querySelector('[data-chart="trend"]')

    expect(trend).toHaveAttribute('data-range', '7d')
    // A 7-day window is 7 ticks, not 30 — the slice is real, not a rescale.
    expect(trend.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length).toBe(7)
  })

  it('caps the daily window at the 30 buckets the server returns', () => {
    const { container } = renderCharts({ onRangeChange: () => {}, range: 30 })
    const trend = container.querySelector('[data-chart="trend"]')

    // More points than the x-axis can label is fine: the axis thins them with
    // preserveStartEnd rather than overlapping the labels.
    expect(trend.querySelectorAll('.recharts-line-curve').length).toBe(2)
  })

  it('says which window is on screen', () => {
    const { container } = renderCharts({ onRangeChange: () => {}, range: 14 })

    expect(container.textContent).toContain('last 14 days')
  })

  it('falls back to the monthly view when no daily data is present', () => {
    // A server predating the daily series would send no `daily` key. The control
    // must not blank the chart.
    const { container } = render(
      <MemoryRouter>
        <DashboardCharts data={summary({ daily: undefined })} onRangeChange={() => {}} range={7} {...SIZE} />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-chart="trend"]')).toBeInTheDocument()
    expect(container.textContent).toContain('Invoiced vs received')
  })
})
