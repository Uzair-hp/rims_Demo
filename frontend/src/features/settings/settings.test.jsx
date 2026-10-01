import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider.jsx'
import SettingsPage from './SettingsPage.jsx'
import { SettingsProvider } from './SettingsProvider.jsx'

/**
 * Phase 3 settings tests (§15, §25).
 *
 * The fetch mock is the whole surface: every section talks to the API through
 * `api/endpoints/settings.js`, so asserting the requests proves the wiring the
 * server actually sees — including that client-side validation *prevents* a
 * bad request rather than merely styling one.
 */

const API = '/api/v1'
const USER = { id: 1, name: 'Ruchita Admin', email: 'admin@ruchitainteriors.in', role: 'owner' }

const SETTINGS = {
  company_name: 'Ruchita Interiors',
  tagline: 'Spaces, finished right',
  logo_path: null,
  payment_qr_path: null,
  phone: '+91 98765 43210',
  email: 'hello@ruchitainteriors.in',
  website: '',
  address_line1: '12 Studio Lane',
  address_line2: '',
  city: 'Surat',
  state: 'Gujarat',
  pincode: '395001',
  gstin: '',
  default_gst_bp: 1800,
  default_validity_days: 15,
  quotation_prefix: 'QTN',
  invoice_prefix: 'INV',
  bank_account_name: '',
  bank_account_number: '',
  bank_name: '',
  bank_ifsc: '',
  bank_branch: '',
  upi_id: '',
  signatory_name: '',
  footer_text: '',
  item_categories: ['Living Room', 'Kitchen'],
  units: ['sq.ft', 'no.'],
  updated_at: '2026-09-28T10:00:00',
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

const failure = (message = 'Nope.', { status = 422 } = {}) =>
  jsonResponse({ error: { code: 'VALIDATION_ERROR', message, details: [] } }, { ok: false, status })

/**
 * @param {{ settings?: object | null, terms?: object[], settingsError?: boolean, settingsErrorStatus?: number }} [responses]
 */
function mockApi({ settings = SETTINGS, terms = [], settingsError = false, settingsErrorStatus = 422 } = {}) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const path = String(url).replace(API, '')
      const method = init.method || 'GET'
      calls.push({ path, method, init })

      if (path === '/settings/company' && method === 'GET') {
        if (settingsError) return failure('Could not reach settings.', { status: settingsErrorStatus })
        return jsonResponse({ data: { settings } })
      }
      if (path === '/settings/company' && method === 'PUT') {
        const patch = JSON.parse(init.body)
        return jsonResponse({ data: { settings: { ...SETTINGS, ...patch } } })
      }
      if (path === '/settings/logo' && method === 'POST') {
        return jsonResponse({ data: { logo_path: 'branding/new.png' } })
      }
      if (path === '/settings/logo' && method === 'DELETE') {
        return jsonResponse({ data: { deleted: true } })
      }
      if (path === '/settings/payment-qr' && method === 'POST') {
        return jsonResponse({ data: { payment_qr_path: 'payment-qr/new.png' } })
      }
      if (path === '/settings/payment-qr' && method === 'DELETE') {
        return jsonResponse({ data: { deleted: true } })
      }
      if (path === '/settings/terms' && method === 'GET') {
        return jsonResponse({ data: { terms } })
      }
      if (path === '/settings/terms' && method === 'POST') {
        const term = { id: 99, created_at: '2026-09-28T11:00:00', ...JSON.parse(init.body) }
        return jsonResponse({ data: { term } }, { status: 201 })
      }
      if (path === '/auth/password' && method === 'PUT') {
        return jsonResponse({ data: { password_changed: true, reauthenticate: true } })
      }
      if (path === '/auth/logout' && method === 'POST') {
        return jsonResponse({ data: { logged_out: true } })
      }
      if (path === '/auth/csrf' && method === 'GET') {
        return jsonResponse({ data: { issued: true } })
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'nope' } }, { ok: false, status: 404 })
    }),
  )
  return { calls }
}

function renderPage() {
  return render(
    <AuthProvider initialUser={USER}>
      <SettingsProvider>
        <SettingsPage />
      </SettingsProvider>
    </AuthProvider>,
  )
}

const companyPut = ({ calls }) =>
  calls.find((call) => call.path === '/settings/company' && call.method === 'PUT')

/**
 * Phase 8 §8.5: the live UPI QR control.
 *
 * The QR's defining property is that it is *not* part of the bank-detail save —
 * it changes the moment the file is chosen, without touching the snapshotted
 * fields. These assert the two halves of that: the upload posts on its own
 * endpoint, and the section's PUT is never used to set a path.
 */
describe('settings — UPI ID', () => {
  // §8.5: the QR used to be an uploaded image with its own subsection here. It is
  // now **generated** from this ID and the outstanding balance (§8.5, amended), so
  // the upload control is gone and the only thing to configure is the ID itself.
  //
  // What matters now is that a typo is caught before it can misdirect a customer's
  // payment: a malformed VPA produces a QR that opens an app pointed at an account
  // that does not exist. The check is deliberately permissive — a provider suffix is
  // not a fixed list, so rejecting a real one would block a real payment.

  it('has no upload control — the QR is generated from the ID', async () => {
    mockApi()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    const id = within(bank).getByLabelText(/upi id/i)
    expect(id).toBeInTheDocument()
    // The file input that Phase 8 put here is gone.
    expect(within(bank).queryByLabelText(/upi qr code/i)).toBeNull()
    expect(within(bank).queryByRole('button', { name: /remove qr/i })).toBeNull()
    // And the section says why there is nothing to upload.
    expect(within(bank).getByText(/nothing to upload/i)).toBeInTheDocument()
  })

  it('accepts any provider suffix without complaining', async () => {
    const user = userEvent.setup()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    // One save per address, each with a fresh mock, because `companyPut` returns the
    // *first* matching PUT and this loop makes several — asserting on it across
    // iterations would read the previous iteration's body and pass for the wrong
    // reason.
    for (const vpa of ['ruchitainteriors@upi', 'name@okaxis', '6011@mobikwik', 'name@paytm']) {
      const api = mockApi()
      const field = within(bank).getByLabelText(/upi id/i)
      await user.clear(field)
      await user.type(field, vpa)
      await user.click(within(bank).getByRole('button', { name: /save/i }))

      await waitFor(() => expect(companyPut(api)).toBeTruthy())
      expect(JSON.parse(companyPut(api).init.body).upi_id).toBe(vpa)
      // No inline complaint about the shape of the address itself.
      expect(within(bank).queryByText(/business@okaxis/i)).toBeNull()
    }
  })

  it('rejects a VPA with no @ before any request is made', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    const field = within(bank).getByLabelText(/upi id/i)
    await user.clear(field)
    await user.type(field, 'not-a-vpa')
    await user.click(within(bank).getByRole('button', { name: /save/i }))

    expect(await within(bank).findByText(/business@okaxis/i)).toBeInTheDocument()
    expect(companyPut({ calls })).toBeUndefined()
  })

  it('rejects a VPA containing a space before any request is made', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    const field = within(bank).getByLabelText(/upi id/i)
    await user.clear(field)
    await user.type(field, 'my upi@okaxis')
    await user.click(within(bank).getByRole('button', { name: /save/i }))

    expect(await within(bank).findByText(/cannot contain spaces/i)).toBeInTheDocument()
    expect(companyPut({ calls })).toBeUndefined()
  })

  it('rejects a VPA with nothing on one side of the @', async () => {
    const { calls } = mockApi()
    const user = userEvent.setup()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    const field = within(bank).getByLabelText(/upi id/i)
    await user.clear(field)
    await user.type(field, '@okaxis')
    await user.click(within(bank).getByRole('button', { name: /save/i }))

    expect(await within(bank).findByText(/both sides of the/i)).toBeInTheDocument()
    expect(companyPut({ calls })).toBeUndefined()
  })

  it('treats an empty ID as valid — the QR is simply turned off', async () => {
    // An owner who has not set up a UPI account must still be able to save their
    // bank details, and an empty ID is the documented way to say "no QR".
    const api = mockApi()
    const user = userEvent.setup()
    renderPage()

    const bank = await screen.findByRole('region', { name: /payment & bank/i })
    await user.clear(within(bank).getByLabelText(/upi id/i))
    await user.type(within(bank).getByLabelText(/account name/i), 'Ruchita Interiors LLP')
    await user.click(within(bank).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(companyPut(api)).toBeTruthy())
    expect(JSON.parse(companyPut(api).init.body).bank_account_name).toBe('Ruchita Interiors LLP')
    expect(within(bank).queryByText(/business@okaxis/i)).toBeNull()
  })
})

beforeEach(() => {
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0].trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  })
})

describe('settings page', () => {
  it('renders every §15 section under a single page heading', async () => {
    mockApi({
      terms: [
        { id: 1, title: 'Standard terms', scope: 'both', body: '1. Advance required.', is_default: true },
      ],
    })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()

    for (const title of [
      'Business information',
      'Branding',
      'Quotation settings',
      'Invoice settings',
      'Tax settings',
      'Payment & bank details',
      'Terms & conditions',
      'Document & footer',
      'Account & security',
      'Catalogue',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }

    // Exactly one h1 — the chrome-page rule (§18.2).
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    // Seeded starter term visible with its default badge (async list load).
    expect(await screen.findByText('Standard terms')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()

    // GST stored as basis points renders as the percent the owner reads.
    expect(screen.getByLabelText(/Default GST/)).toHaveValue(18)
  })

  it("saves one section without sending another section's fields", async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Business information' })

    const name = screen.getByLabelText(/Company name/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Ruchita Interiors Pvt Ltd')

    const section = screen.getByRole('region', { name: 'Business information' })
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(companyPut(api)).toBeTruthy())
    const patch = JSON.parse(companyPut(api).init.body)
    expect(patch.company_name).toBe('Ruchita Interiors Pvt Ltd')
    // Tax and validity belong to other sections; a partial save must not touch them.
    expect(patch).not.toHaveProperty('default_gst_bp')
    expect(patch).not.toHaveProperty('invoice_prefix')

    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('blocks an empty company name locally, with no request', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Business information' })

    const section = screen.getByRole('region', { name: 'Business information' })
    await userEvent.clear(screen.getByLabelText(/Company name/))
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A company name is required.')).toBeInTheDocument()
    expect(companyPut(api)).toBeUndefined()
  })

  it('rejects an SVG logo before it reaches the server', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Branding' })

    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'logo.svg', {
      type: 'image/svg+xml',
    })
    // applyAccept: false — the point is that *our* validation rejects the file;
    // letting the accept attribute swallow it would test the browser, not us.
    await userEvent.upload(screen.getByLabelText('Company logo'), file, { applyAccept: false })

    expect(await screen.findByText(/SVG files are not accepted/)).toBeInTheDocument()
    expect(api.calls.some((call) => call.path === '/settings/logo' && call.method === 'POST')).toBe(false)
  })

  it('uploads a valid PNG and refreshes the shell logo', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Branding' })

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Company logo'), file)

    expect(await screen.findByText('Logo uploaded.')).toBeInTheDocument()
    await waitFor(() =>
      expect(api.calls.some((call) => call.path === '/settings/logo' && call.method === 'POST')).toBe(true),
    )
    // The provider re-reads the row so the sidebar picks up the new logo.
    await waitFor(() => expect(api.calls.filter((call) => call.path === '/settings/company')).toHaveLength(2))
  })

  it('adds a terms entry through the API', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Terms & conditions' })

    await userEvent.click(screen.getByRole('button', { name: 'Add terms' }))
    // Regex anchors: TextField appends a required-marker asterisk to the label.
    await userEvent.type(screen.getByLabelText(/^Title/), 'Warranty')
    await userEvent.type(screen.getByLabelText(/^Body/), '1. Two years on workmanship.')

    // The footer submit for the open form is the only "Add terms" now.
    await userEvent.click(screen.getByRole('button', { name: 'Add terms' }))

    await waitFor(() => {
      const create = api.calls.find((call) => call.path === '/settings/terms' && call.method === 'POST')
      expect(create).toBeTruthy()
      expect(JSON.parse(create.init.body)).toMatchObject({
        title: 'Warranty',
        body: '1. Two years on workmanship.',
        scope: 'both',
      })
    })

    expect(await screen.findByText('Terms saved.')).toBeInTheDocument()
    expect(screen.getByText('Warranty')).toBeInTheDocument()
  })

  it('refuses a password change that fails its own checks, with no request', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Account & security' })

    const section = screen.getByRole('region', { name: 'Account & security' })
    await userEvent.type(screen.getByLabelText(/^Current password/), 'old-password-1')
    await userEvent.type(screen.getByLabelText(/^New password/), 'new-password-123')
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'mismatch-999')
    await userEvent.click(within(section).getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.calls.some((call) => call.path === '/auth/password')).toBe(false)
  })

  it('changes the password, then signs the session out (server revokes all)', async () => {
    const api = mockApi()
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Account & security' })

    const section = screen.getByRole('region', { name: 'Account & security' })
    await userEvent.type(screen.getByLabelText(/^Current password/), 'old-password-1')
    await userEvent.type(screen.getByLabelText(/^New password/), 'new-password-123')
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'new-password-123')
    await userEvent.click(within(section).getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      const change = api.calls.find((call) => call.path === '/auth/password' && call.method === 'PUT')
      expect(change).toBeTruthy()
    })
    expect(await screen.findByText('Password updated — signing you out.')).toBeInTheDocument()
    await waitFor(() => expect(api.calls.some((call) => call.path === '/auth/logout')).toBe(true))
  })

  it('shows a retry state when settings fail to load', async () => {
    mockApi({ settingsError: true })
    renderPage()

    expect(await screen.findByText('Settings could not be loaded')).toBeInTheDocument()
    // The page heading still exists — one h1, even on the error path (§18.2).
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  /**
   * Regression guard: a 5xx must not be reported as "the server did not answer".
   *
   * This actually shipped broken. A pending Alembic migration made every
   * settings request 500 while the page insisted the API was not running, which
   * sent the investigation to connectivity instead of to `db upgrade`.
   */
  describe('a failed settings load says which kind of failure it was', () => {
    it('blames connectivity only for a genuine transport failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )
      renderPage()

      expect(await screen.findByText(/did not answer/i)).toBeInTheDocument()
      expect(screen.getByText(/check that the api is running/i)).toBeInTheDocument()
    })

    it('does NOT blame connectivity when the server returned 500', async () => {
      mockApi({ settingsError: true, settingsErrorStatus: 500 })
      renderPage()

      await screen.findByText('Settings could not be loaded')
      expect(screen.queryByText(/did not answer/i)).not.toBeInTheDocument()
      expect(screen.getByText(/the server returned an error/i)).toBeInTheDocument()
      // It is running; the request is what failed.
      expect(screen.getByText(/it is running/i)).toBeInTheDocument()
    })

    it('tells the user to sign in again on 401', async () => {
      mockApi({ settingsError: true, settingsErrorStatus: 401 })
      renderPage()

      await screen.findByText('Settings could not be loaded')
      expect(screen.queryByText(/did not answer/i)).not.toBeInTheDocument()
      expect(screen.getByText(/sign in again/i)).toBeInTheDocument()
    })
  })
})
