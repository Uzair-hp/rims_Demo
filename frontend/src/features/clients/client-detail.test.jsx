import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientDetailPage from './ClientDetailPage.jsx'

/**
 * Client detail — the client's related data (FR-C3).
 *
 * This file exists because of a real bug, and it is worth being explicit about
 * what it guards. `GET /clients/:id/summary` returns
 * `{ client, quotations[], invoices[], payments[], totals: { billed_paise,
 * received_paise, outstanding_paise } }`. The page used to read
 * `quotations_count`, `total_quotations_value`, `total_invoices_value` and
 * `total_payments_value` — none of which the service has ever written. Every
 * figure therefore rendered as `₹0.00` and every section as a placeholder, while
 * the real data sat unused in `summary`. `clients-page.test.jsx` could not catch
 * it, because the list page never reads the summary.
 *
 * So the assertions below are pinned to the *server's* field names, and the
 * money figures are cross-checked against the same numbers
 * `backend/tests/test_clients.py::test_summary_totals_with_seeded_rows` asserts
 * against seeded rows (billed 50000, received 20000, outstanding 30000 paise).
 * If the two files ever disagree, one of them is wrong and the tests should say
 * so rather than agree by accident.
 *
 * Rows are keyed off the route's client id, never the name: a test below gives
 * two clients near-identical names to prove they cannot borrow each other's rows.
 */

const API = '/api/v1'

/** Paise, matching the service's integer-paise contract (lib/money.js). */
const ALPHA_CLIENT = { id: 1, name: 'Alpha Interiors', phone: '+91 90000 00001', is_archived: false }
const BETA_CLIENT = { id: 2, name: 'Alpha Interiors Ltd', phone: '+91 90000 00002', is_archived: false }

const ALPHA_SUMMARY = {
  client: ALPHA_CLIENT,
  quotations: [
    {
      id: 11,
      number: 'QTN-2026-0001',
      status: 'approved',
      quotation_date: '2026-01-01',
      valid_until: '2026-01-31',
      grand_total_paise: 10000,
    },
  ],
  invoices: [
    {
      id: 21,
      number: 'INV-2026-0001',
      status: 'issued',
      issue_date: '2026-01-10',
      due_date: '2026-02-09',
      grand_total_paise: 50000,
      paid_paise: 20000,
      outstanding_paise: 30000,
      payment_status: 'partially_paid',
    },
  ],
  payments: [
    {
      id: 31,
      invoice_id: 21,
      invoice_number: 'INV-2026-0001',
      amount_paise: 20000,
      paid_on: '2026-01-20',
      method: 'upi',
      reference: 'UPI-REF-1',
    },
  ],
  totals: { billed_paise: 50000, received_paise: 20000, outstanding_paise: 30000 },
}

const BETA_SUMMARY = {
  client: BETA_CLIENT,
  quotations: [],
  invoices: [],
  payments: [],
  totals: { billed_paise: 0, received_paise: 0, outstanding_paise: 0 },
}

const EMPTY_SUMMARY = {
  client: { id: 3, name: 'Lonely Client', is_archived: false },
  quotations: [],
  invoices: [],
  payments: [],
  totals: { billed_paise: 0, received_paise: 0, outstanding_paise: 0 },
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

function errorResponse() {
  return {
    ok: false,
    status: 500,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: { code: 'INTERNAL', message: 'Boom' } }),
    text: async () => 'Boom',
  }
}

/**
 * Stub the two endpoints the page reads. `summaryById` lets a test give two
 * clients different histories; a key mapped to a Response (rather than a
 * summary) is returned as-is, which is how failure cases are expressed.
 */
function mockApi({
  clientsById = { 1: ALPHA_CLIENT, 2: BETA_CLIENT },
  summaryById = { 1: ALPHA_SUMMARY, 2: BETA_SUMMARY },
} = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url).replace(API, '')
      const match = path.match(/^\/clients\/(\d+)(\/summary)?$/)
      calls.push(path)
      if (!match) return jsonResponse({ data: {} })

      const id = Number(match[1])
      if (match[2]) {
        const summary = summaryById[id]
        if (!summary) return errorResponse()
        if (summary instanceof Error || (summary && summary.ok === false)) return summary
        return jsonResponse({ data: summary })
      }
      const client = clientsById[id]
      if (!client) return errorResponse()
      return jsonResponse({ data: { client } })
    }),
  )
  return { calls }
}

/**
 * A harness control that moves the router to another client.
 *
 * Tests must change the *route* to switch clients, not swap the router: a new
 * `MemoryRouter` would only change the `initialEntries` prop of an
 * already-mounted router and navigate nowhere, and a different tree would remount
 * the page, which resets its state and would hide exactly the stale-data bug this
 * file is here to catch. Clicking keeps one router and one mounted
 * `ClientDetailPage`, so any client-to-client leakage comes from the page's own
 * state.
 *
 * It lives in the test tree rather than the page, so it needs no test-only branch
 * in `ClientDetailPage.jsx`.
 */
function GoToClient({ target, children }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(target)}>
      {children}
    </button>
  )
}

function renderAt(id = '1') {
  // `String(id)` so the toggle below compares like with like; tests call this with
  // both `1` and `'1'`.
  const current = String(id)
  return render(
    <MemoryRouter initialEntries={[`/clients/${current}`]}>
      <GoToClient target={`/clients/${current === '1' ? 2 : 1}`}>switch client</GoToClient>
      <Routes>
        <Route path="/clients/:id" element={<ClientDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const goToClient = async (user) => {
  await user.click(screen.getByRole('button', { name: 'switch client' }))
}

/** The figure in the totals tile with this label. Scoped, because a tile total
 *  and a row total can legitimately be the same number (one ₹500 invoice *is*
 *  ₹500 billed) and an unscoped `getByText` would then be ambiguous. */
const totalFor = (label) => within(screen.getByText(label).closest('div')).getByText(/^₹/)

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

describe('Client detail — related data from the summary payload', () => {
  /**
   * The regression itself. Every one of these rendered `₹0.00`, `0` or a
   * placeholder line before, because the page read field names the service never
   * wrote. `formatPaise` of 50000 paise is ₹500.00.
   */
  it('renders the billed, received and outstanding totals the server sent', async () => {
    mockApi()
    renderAt('1')

    await screen.findByRole('heading', { name: 'Alpha Interiors', level: 2 })
    expect(totalFor('Billed')).toHaveTextContent('₹500.00')
    // All three, not one: ₹500 billed, ₹200 received, ₹300 outstanding. A single
    // assertion would pass even if two of the three were swapped or dropped.
    expect(totalFor('Received')).toHaveTextContent('₹200.00')
    expect(totalFor('Outstanding')).toHaveTextContent('₹300.00')
  })

  it('labels each total so the figures are not just numbers on a page', async () => {
    mockApi()
    renderAt('1')

    await screen.findByRole('heading', { name: 'Alpha Interiors', level: 2 })
    for (const label of ['Billed', 'Received', 'Outstanding']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('lists the client’s quotations with number, status and value', async () => {
    mockApi()
    renderAt('1')

    const section = (await screen.findByRole('heading', { name: 'Quotations', level: 2 })).closest('section')
    const row = within(section).getByRole('link', { name: /QTN-2026-0001/ })
    expect(row).toHaveAttribute('href', '/quotations/11')
    // `status: 'approved'` is the server's own vocabulary, passed straight to the
    // shared badge rather than re-typed here.
    expect(within(row).getByText('Approved')).toBeInTheDocument()
    expect(within(row).getByText('₹100.00')).toBeInTheDocument()
  })

  it('lists the client’s invoices with paid, outstanding and payment status', async () => {
    mockApi()
    renderAt('1')

    const section = (await screen.findByRole('heading', { name: 'Invoices', level: 2 })).closest('section')
    const row = within(section).getByRole('link', { name: /INV-2026-0001/ })
    expect(row).toHaveAttribute('href', '/invoices/21')
    // The three-way payment status is derived in the database layer (§11) and
    // arrives pre-computed; the page must render it, never derive it.
    expect(within(row).getByText('Partially paid')).toBeInTheDocument()
    expect(within(row).getByText('₹500.00')).toBeInTheDocument()
    expect(within(row).getByText('₹300.00 due')).toBeInTheDocument()
  })

  it('lists the client’s payments with amount, method and date', async () => {
    mockApi()
    renderAt('1')

    const section = (await screen.findByRole('heading', { name: 'Payments', level: 2 })).closest('section')
    const row = within(section).getByRole('link', { name: /Payment against INV-2026-0001/ })
    // A payment has no page of its own, so it routes to the invoice it settles.
    expect(row).toHaveAttribute('href', '/invoices/21')
    expect(within(row).getByText('₹200.00')).toBeInTheDocument()
    // `method: 'upi'` rendered as the human label, not the raw enum key.
    expect(within(row).getByText(/UPI/)).toBeInTheDocument()
    expect(within(row).getByText(/UPI-REF-1/)).toBeInTheDocument()
  })

  it('omits the "due" figure on a fully paid invoice', async () => {
    mockApi({
      summaryById: {
        1: {
          ...ALPHA_SUMMARY,
          invoices: [
            { ...ALPHA_SUMMARY.invoices[0], paid_paise: 50000, outstanding_paise: 0, payment_status: 'paid' },
          ],
          payments: [],
          totals: { billed_paise: 50000, received_paise: 50000, outstanding_paise: 0 },
        },
      },
    })
    renderAt('1')

    const section = (await screen.findByRole('heading', { name: 'Invoices', level: 2 })).closest('section')
    expect(within(section).getByText('Paid')).toBeInTheDocument()
    // A settled invoice is still worth a real zero in the strip, since the client
    // has money on account and nothing outstanding.
    expect(totalFor('Outstanding')).toHaveTextContent('₹0.00')
    // ...but "₹0.00 due" on the row is noise.
    expect(within(section).queryByText(/due$/)).toBeNull()
  })

  it('counts the related records', async () => {
    mockApi()
    renderAt('1')

    expect(await screen.findByText('1 quotation · 1 invoice · 1 payment')).toBeInTheDocument()
  })
})

describe('Client detail — related data is scoped to the client id', () => {
  /**
   * The two clients here have near-identical names on purpose. If anything
   * matched or cached on name, one client's rows would appear under the other.
   */
  it('shows only the selected client’s records, not another client’s', async () => {
    mockApi()
    renderAt('2')

    await screen.findByRole('heading', { name: 'Alpha Interiors Ltd', level: 2 })

    // Client 2 has no documents of its own...
    expect(await screen.findByText('No quotations yet')).toBeInTheDocument()
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
    expect(screen.getByText('No payments recorded')).toBeInTheDocument()

    // ...and none of client 1's rows leaked in.
    expect(screen.queryByText(/QTN-2026-0001/)).toBeNull()
    expect(screen.queryByText(/INV-2026-0001/)).toBeNull()
    expect(totalFor('Billed')).toHaveTextContent('₹0.00')
  })

  it('requests the summary for the id in the route', async () => {
    const { calls } = mockApi()
    renderAt('2')

    await screen.findByRole('heading', { name: 'Alpha Interiors Ltd', level: 2 })
    expect(calls).toContain('/clients/2/summary')
    expect(calls).toContain('/clients/2')
  })

  it('does not leave the previous client’s figures on screen when the route changes', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi()
    renderAt(1)

    await screen.findByRole('heading', { name: 'Alpha Interiors', level: 2 })
    expect(await screen.findByText('1 quotation · 1 invoice · 1 payment')).toBeInTheDocument()
    expect(totalFor('Billed')).toHaveTextContent('₹500.00')

    // Navigate to the other client's route, the way clicking another list row
    // would. `ClientDetailPage` stays mounted — same route pattern, same element
    // — so client 1's state is still in memory. That is exactly where stale data
    // would survive.
    await goToClient(user)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alpha Interiors Ltd', level: 2 })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('No quotations yet')).toBeInTheDocument()
    })

    // The first client's money and records must be gone, not merely outnumbered.
    expect(screen.queryByText('₹500.00')).toBeNull()
    expect(screen.queryByText(/QTN-2026-0001/)).toBeNull()
    expect(screen.queryByText('1 quotation · 1 invoice · 1 payment')).toBeNull()
    expect(screen.getByText('0 quotations · 0 invoices · 0 payments')).toBeInTheDocument()

    // And the switch really did re-read the server rather than trusting memory.
    await waitFor(() => {
      expect(calls).toContain('/clients/2/summary')
    })
  })
})

describe('Client detail — empty, loading and error states', () => {
  it('shows an empty state per section for a client with no documents', async () => {
    mockApi({
      clientsById: { 3: EMPTY_SUMMARY.client },
      summaryById: { 3: EMPTY_SUMMARY },
    })
    renderAt('3')

    await screen.findByRole('heading', { name: 'Lonely Client', level: 2 })
    expect(screen.getByText('No quotations yet')).toBeInTheDocument()
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
    expect(screen.getByText('No payments recorded')).toBeInTheDocument()
    expect(screen.getByText('0 quotations · 0 invoices · 0 payments')).toBeInTheDocument()
  })

  it('points the empty quotation state at a new quotation for this client', async () => {
    mockApi({
      clientsById: { 3: EMPTY_SUMMARY.client },
      summaryById: { 3: EMPTY_SUMMARY },
    })
    renderAt('3')

    const section = (await screen.findByRole('heading', { name: 'Quotations', level: 2 })).closest('section')
    // The link carries the client id, so the new quotation opens pre-filled
    // rather than dropping the user on a blank form.
    expect(within(section).getByRole('link', { name: /New quotation/i })).toHaveAttribute(
      'href',
      '/quotations/new?client=3',
    )
  })

  it('renders nothing but placeholders while loading', () => {
    // Never resolves, so the page stays in its loading state for the assertion.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderAt('1')

    // The totals strip and the sections exist immediately; the figures do not.
    // Asserting the *absence* of the data is the point: a loading page must not
    // flash a previous client's numbers, or a fabricated ₹0.00.
    expect(screen.getByText('Billed')).toBeInTheDocument()
    expect(screen.queryByText('₹500.00')).toBeNull()
    expect(screen.queryByText(/QTN-2026-0001/)).toBeNull()
    expect(screen.queryByText('No quotations yet')).toBeNull()
  })

  it('reports a failed profile load instead of an empty page', async () => {
    mockApi({ clientsById: {}, summaryById: {} })
    renderAt('9')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be loaded/i)
  })

  it('keeps the profile visible when only the summary fails', async () => {
    mockApi({ clientsById: { 1: ALPHA_CLIENT }, summaryById: { 1: errorResponse() } })
    renderAt('1')

    // The client loaded, so the page must not throw it away along with the
    // history: an alert, and a usable profile.
    expect(await screen.findByRole('heading', { name: 'Alpha Interiors', level: 2 })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/document history could not be loaded/i)
  })
})

describe('Client detail — archived clients keep their history', () => {
  /**
   * FR-C4: archiving hides a client from lists and pickers, it does not erase
   * what they owe. The page used to hide the entire totals strip for an archived
   * client, so their balance became invisible on their own detail page.
   */
  it('still shows the totals and records for an archived client', async () => {
    mockApi({
      clientsById: { 1: { ...ALPHA_CLIENT, is_archived: true, archived_at: '2026-05-01T00:00:00' } },
    })
    renderAt('1')

    await screen.findByRole('heading', { name: 'Alpha Interiors', level: 2 })
    expect(await screen.findByText('Archived')).toBeInTheDocument()

    // The money and the documents are all still there. Scoped to the Invoices
    // section because the payment row names the invoice it settles, so the number
    // legitimately appears in two places.
    expect(totalFor('Outstanding')).toHaveTextContent('₹300.00')
    const invoices = (await screen.findByRole('heading', { name: 'Invoices', level: 2 })).closest('section')
    expect(within(invoices).getByRole('link', { name: /^INV-2026-0001/ })).toBeInTheDocument()
    expect(
      (await screen.findByRole('heading', { name: 'Quotations', level: 2 })).closest('section'),
    ).toHaveTextContent('QTN-2026-0001')

    // Archive becomes Restore, and Archive is withdrawn.
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^archive$/i })).toBeNull()
  })
})
