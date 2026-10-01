/**
 * The invoice's payment-method selector (FR-P8).
 *
 * This is the one place the invoice's payment presentation is chosen, so what is
 * worth pinning is the *window* and the *wire format*, not the styling: the selector
 * exists only while the invoice is a Draft, and "Not selected" has to reach the
 * server as an explicit `null` rather than an absent key — omitting it would mean
 * "leave whatever was there alone", which is the opposite of clearing a choice.
 *
 * The document-side consequences of each value are covered in `invoices.test.jsx`
 * and in `backend/tests/test_payments.py`.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailPage from './InvoiceDetailPage.jsx'
import { SettingsProvider } from '../settings/SettingsProvider.jsx'

const API = '/api/v1'

/** A draft invoice, before issue — the only state with an editable selector. */
const DRAFT = {
  id: 7,
  number: 'INV-2026-0001',
  year: 2026,
  status: 'draft',
  issue_date: null,
  due_date: null,
  notes: null,
  terms_text: null,
  payment_method: null,
  payment_status: 'unpaid',
  paid_paise: 0,
  outstanding_paise: 0,
  grand_total_paise: 0,
  subtotal_paise: 0,
  discount_paise: 0,
  gst_paise: 0,
  other_charges_paise: 0,
  items: [],
  client_snapshot: { name: 'Alpha Interiors' },
  allowed_actions: ['edit', 'issue'],
  latest_payment_method: null,
}

/** Same invoice, already issued: the selector must be gone. */
const ISSUED = { ...DRAFT, status: 'issued', allowed_actions: ['record_payment'] }

function envelope(body, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/**
 * Mock the two endpoints this page touches, and record the PUT body so the wire
 * format can be asserted directly rather than inferred from the rendered result.
 */
function mockApi(invoice) {
  const puts = []
  let current = invoice

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const path = String(url).replace(API, '')
      const method = init.method || 'GET'

      if (path.startsWith('/settings/company')) return envelope({ data: { company: {} } })
      if (path === '/invoices/7' && method === 'GET') {
        return envelope({ data: { invoice: current } })
      }
      if (path === '/invoices/7' && method === 'PUT') {
        const body = JSON.parse(init.body)
        puts.push(body)
        current = { ...current, ...body }
        return envelope({ data: { invoice: current } })
      }
      return envelope({ data: {} })
    }),
  )

  return { puts }
}

/**
 * The read-only summary line renders as `Payment method: <label>`, so its text is
 * split across two text nodes and a plain string matcher cannot see it. Match on
 * the element's whole text content instead, which is what a reader actually sees.
 */
const summary = (label) => screen.findByText((_, el) => el?.textContent === `Payment method: ${label}`)

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/invoices/7']}>
      <SettingsProvider>
        <Routes>
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )

const openDraftEditor = async (user) => {
  renderPage()
  await screen.findByText('Draft details')
  await user.click(screen.getByRole('button', { name: /edit draft details/i }))
  return screen.getByLabelText(/payment method/i)
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => envelope({ data: { company: {} } })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the invoice payment-method selector (FR-P8)', () => {
  it('offers exactly the three presentation choices plus not selected', async () => {
    // Cheque and card are real ledger methods but are not instructions to print,
    // so they must not be offerable here.
    mockApi(DRAFT)
    const user = userEvent.setup()
    const select = await openDraftEditor(user)

    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(['', 'upi', 'bank_transfer', 'cash'])
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Not selected',
      'UPI',
      'Bank transfer',
      'Cash',
    ])
  })

  it('defaults to Not selected for a converted invoice', async () => {
    // Both surfaces, because the selector and the summary are the same value read
    // in two places and can drift independently.
    mockApi(DRAFT)
    renderPage()
    await summary('Not selected')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /edit draft details/i }))
    expect(screen.getByLabelText(/payment method/i).value).toBe('')
  })

  it('shows the stored choice in the read-only view', async () => {
    mockApi({ ...DRAFT, payment_method: 'bank_transfer' })
    renderPage()

    await summary('Bank transfer')
  })

  it('sends a chosen method through the draft PUT', async () => {
    const { puts } = mockApi(DRAFT)
    const user = userEvent.setup()
    const select = await openDraftEditor(user)

    await user.selectOptions(select, 'upi')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].payment_method).toBe('upi')
  })

  it('sends null to clear a choice back to Not selected', async () => {
    // The load-bearing wire-format case: `undefined` would be dropped from the JSON
    // and read server-side as "field absent, leave it alone", silently keeping UPI.
    const { puts } = mockApi({ ...DRAFT, payment_method: 'upi' })
    const user = userEvent.setup()
    const select = await openDraftEditor(user)

    expect(select.value).toBe('upi')
    await user.selectOptions(select, '')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toHaveProperty('payment_method', null)
    expect(puts[0].payment_method).toBeNull()
    await summary('Not selected')
  })

  it('tells the admin the choice cannot be changed after issue', async () => {
    // The hint is the only signal that this decision is permanent; without it the
    // frozen value looks like an oversight.
    mockApi(DRAFT)
    const user = userEvent.setup()
    const select = await openDraftEditor(user)

    await user.selectOptions(select, 'cash')
    expect(screen.getByText(/fixed once issued/i)).toBeInTheDocument()
  })

  it('offers no selector on an issued invoice', async () => {
    mockApi(ISSUED)
    renderPage()

    // The draft block is not rendered at all for an issued invoice, which is what
    // keeps the server-side draft guard and the UI in agreement.
    await screen.findByText('Alpha Interiors')
    expect(screen.queryByText('Draft details')).toBeNull()
    expect(screen.queryByLabelText(/payment method/i)).toBeNull()
  })
})
