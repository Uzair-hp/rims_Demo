/**
 * Ruchita Interiors — invoice feature unit tests (Phase 7, §9.2, §11, §13.2).
 *
 * Covers the pure parts: the list-query builder, the status/action labels, and the
 * invoice variant of the document sheet. The money figures themselves come from
 * the server (`paid_paise` / `outstanding_paise` / `payment_status`), so what is
 * asserted here is that the UI renders those values verbatim and never re-derives
 * them — a client that recomputes is how two screens start disagreeing (D2).
 */

import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DocumentPaper, { groupItemsByCategory } from '../documents/DocumentPaper.jsx'
import PaymentSheet from './PaymentSheet.jsx'
import { buildInvoiceListQuery } from '../../api/endpoints/invoices.js'
import {
  INVOICE_ACTION_META,
  invoiceStatusLabel,
  paymentStatusLabel,
  PAYMENT_STATUS_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
} from './status.js'
import { PAGE_SIZE } from './useInvoices.js'

const SETTINGS = {
  company_name: 'Ruchita Interiors',
  phone: '+91 98765 43210',
  email: 'hello@ruchitainteriors.in',
  address_line1: '14, Rose Villa',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: '452001',
  gstin: '23ABCDE1234F1Z5',
  signatory_name: 'Live Settings Signatory',
  footer_text: 'Modular Kitchen · Wardrobes · Turnkey Interiors',
}

const BANK = {
  account_name: 'Ruchita Interiors LLP',
  account_number: '00123456789',
  bank_name: 'HDFC Bank',
  ifsc: 'HDFC0001234',
  branch: 'Vijay Nagar',
  upi_id: 'ruchita@hdfcbank',
}

/** Shaped like the server's `GET /invoices/:id` response. */
function invoice(overrides = {}) {
  return {
    id: 7,
    number: 'INV-2026-0001',
    year: 2026,
    quotation_id: 42,
    client_id: 3,
    client_snapshot: {
      name: 'Meera Iyer',
      phone: '+91 90000 11111',
      email: 'meera@example.com',
      address: '22, Green Meadows, Indore',
      project_address: 'Plot 14, Indore',
      gstin: '23ABCDE9999Z1Z2',
    },
    issue_date: '2026-09-29',
    due_date: '2026-10-29',
    status: 'issued',
    discount_type: 'percent',
    discount_bp: 500,
    gst_bp: 1800,
    other_charges_label: 'Site Preparation',
    other_charges_paise: 250000,
    subtotal_paise: 1000000,
    discount_paise: 50000,
    gst_paise: 171000,
    grand_total_paise: 1171000,
    paid_paise: 400000,
    outstanding_paise: 771000,
    payment_status: 'partially_paid',
    terms_text: 'Payment due within 30 days.',
    bank_snapshot: BANK,
    signatory_name: 'Snapshot Signatory',
    items: [
      {
        id: 1,
        position: 0,
        category: 'Kitchen',
        name: 'Modular base cabinet',
        description: '18mm prelaminated board.',
        unit: 'running ft',
        qty_milli: 12500,
        rate_paise: 95000,
        line_total_paise: 1187500,
      },
    ],
    payments: [],
    allowed_actions: ['duplicate', 'record_payment', 'cancel'],
    ...overrides,
  }
}

/**
 * Render the sheet for an invoice.
 *
 * `documentOverrides` merge into the *document* payload and `componentProps` into
 * the component's own props. They are separate parameters on purpose: folding
 * both into one object is how a document field silently lands as an unknown prop
 * and the test passes against unedited data.
 */
function renderInvoice(documentOverrides = {}, componentProps = {}) {
  return render(
    <DocumentPaper
      document={invoice(documentOverrides)}
      settings={SETTINGS}
      docKind="invoice"
      {...componentProps}
    />,
  )
}

// ------------------------------------------------------------ query builder

describe('buildInvoiceListQuery', () => {
  it('emits only the params that are set, mapping to snake_case', () => {
    const query = buildInvoiceListQuery({
      q: 'INV-2026',
      paymentStatus: 'partially_paid',
      clientId: 3,
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      sort: 'grand_total_paise',
      order: 'asc',
      page: 2,
      pageSize: 25,
    })
    const p = new URLSearchParams(query)
    expect(p.get('q')).toBe('INV-2026')
    expect(p.get('payment_status')).toBe('partially_paid')
    expect(p.get('client_id')).toBe('3')
    expect(p.get('date_from')).toBe('2026-01-01')
    expect(p.get('date_to')).toBe('2026-02-01')
    expect(p.get('sort')).toBe('grand_total_paise')
    expect(p.get('order')).toBe('asc')
    expect(p.get('page')).toBe('2')
    expect(p.get('page_size')).toBe('25')
  })

  it('omits empty and undefined params', () => {
    expect(buildInvoiceListQuery({ q: '', paymentStatus: undefined, clientId: null })).toBe('')
  })
})

// ------------------------------------------------------------- status labels

describe('invoice status helpers', () => {
  it('labels the document lifecycle', () => {
    expect(invoiceStatusLabel('draft')).toBe('Draft')
    expect(invoiceStatusLabel('issued')).toBe('Issued')
    expect(invoiceStatusLabel('cancelled')).toBe('Cancelled')
    expect(invoiceStatusLabel(undefined)).toBe('Unknown')
  })

  it('labels the payment status separately from the lifecycle', () => {
    expect(paymentStatusLabel('unpaid')).toBe('Unpaid')
    expect(paymentStatusLabel('partially_paid')).toBe('Partially paid')
    expect(paymentStatusLabel('paid')).toBe('Paid')
  })

  it('offers an "all" payment filter first', () => {
    expect(PAYMENT_STATUS_OPTIONS[0].value).toBe('')
    expect(PAYMENT_STATUS_OPTIONS.map((o) => o.value)).toEqual(['', 'unpaid', 'partially_paid', 'paid'])
  })

  it('maps the actions the API implements, and no others', () => {
    // Phase 8 adds `record_payment`. `duplicate` and `delete` are still advertised
    // by the lifecycle service with no endpoint at all, so they must stay unmapped
    // or the page would render buttons the API would reject.
    expect(INVOICE_ACTION_META.issue).toBeTruthy()
    expect(INVOICE_ACTION_META.cancel).toBeTruthy()
    expect(INVOICE_ACTION_META.record_payment).toBeTruthy()
    expect(INVOICE_ACTION_META.duplicate).toBeUndefined()
    expect(INVOICE_ACTION_META.delete).toBeUndefined()
  })

  it('labels all six payment methods with the backend enum as keys', () => {
    expect(Object.keys(PAYMENT_METHOD_LABELS).sort()).toEqual(
      ['bank_transfer', 'card', 'cash', 'cheque', 'other', 'upi'].sort(),
    )
    expect(PAYMENT_METHOD_LABELS.bank_transfer).toBe('Bank transfer')
    expect(PAYMENT_METHOD_OPTIONS).toHaveLength(6)
    // The select options and the history labels come from one source.
    expect(PAYMENT_METHOD_OPTIONS.map((o) => o.value).sort()).toEqual(
      Object.keys(PAYMENT_METHOD_LABELS).sort(),
    )
  })

  it('shares the quotations page size', () => {
    expect(PAGE_SIZE).toBe(25)
  })
})

// ------------------------------------------------ invoice document variant

describe('DocumentPaper — invoice variant', () => {
  it('is titled as a tax invoice, with issue and due dates', () => {
    renderInvoice()
    expect(screen.getByRole('heading', { level: 1, name: 'Tax Invoice' })).toBeInTheDocument()
    // The date labels are micro-labels, not headings.
    expect(screen.getByText('Issue date')).toBeInTheDocument()
    expect(screen.getByText('Due date')).toBeInTheDocument()
    expect(screen.getByText('29 Sep 2026')).toBeInTheDocument()
    expect(screen.getByText('INV-2026-0001')).toBeInTheDocument()
  })

  it('shows Amount Paid and Balance Due from the server figures', () => {
    renderInvoice()
    expect(screen.getByText('Amount Paid')).toBeInTheDocument()
    expect(screen.getByText('Balance Due')).toBeInTheDocument()
    expect(screen.getByText('−₹4,000.00')).toBeInTheDocument()
    expect(screen.getByText('₹7,710.00')).toBeInTheDocument()
  })

  it('omits the Amount Paid row until money has been recorded', () => {
    renderInvoice({ paid_paise: 0, outstanding_paise: 1171000, payment_status: 'unpaid' })
    // Balance Due still applies (it is the amount due); the paid row does not.
    expect(screen.getByText('Balance Due')).toBeInTheDocument()
    expect(screen.queryByText('Amount Paid')).not.toBeInTheDocument()
  })
  it('renders the bank details from the snapshot', () => {
    renderInvoice()
    const bank = document.querySelector('[data-document-bank]')
    expect(bank).toBeTruthy()
    expect(within(bank).getByText('HDFC Bank')).toBeInTheDocument()
    expect(within(bank).getByText('00123456789')).toBeInTheDocument()
    expect(within(bank).getByText('HDFC0001234')).toBeInTheDocument()
    expect(within(bank).getByText('ruchita@hdfcbank')).toBeInTheDocument()
  })

  // --------------------------------------------------------------- QR (§8.5)

  describe('live payment QR', () => {
    const QR_URL = '/api/v1/uploads/payment-qr?v=2026-09-29'

    it('renders the QR as a subsection inside the payment block', () => {
      renderInvoice({}, { qrSrc: QR_URL })

      const bank = document.querySelector('[data-document-bank]')
      const qr = document.querySelector('[data-document-qr]')
      expect(qr).toBeTruthy()
      // A subsection of the bank block, not a sibling of it.
      expect(bank.contains(qr)).toBe(true)
      expect(within(qr).getByText('UPI QR code')).toBeInTheDocument()
      expect(within(qr).getByRole('img', { name: /upi payment qr/i })).toHaveAttribute('src', QR_URL)
    })

    it('is omitted entirely when Settings has no QR', () => {
      renderInvoice({}, { qrSrc: null })
      expect(document.querySelector('[data-document-qr]')).toBeNull()
      // The rest of the payment block is unaffected.
      expect(document.querySelector('[data-document-bank]')).toBeTruthy()
    })

    it('never appears on a quotation, which is not payable', () => {
      render(
        <DocumentPaper
          document={{
            number: 'QTN-1',
            quotation_date: '2026-09-29',
            items: [],
            grand_total_paise: 0,
            bank_snapshot: { bank_name: 'HDFC Bank', account_number: '00123456789' },
          }}
          settings={SETTINGS}
          qrSrc={QR_URL}
          docKind="quotation"
        />,
      )
      expect(document.querySelector('[data-document-qr]')).toBeNull()
    })

    it('drops the whole subsection when the image fails to load', async () => {
      // A broken-image icon inside a bank block reads as a defect on a document
      // a customer is meant to pay from.
      renderInvoice({}, { qrSrc: '/api/v1/uploads/payment-qr?v=broken' })
      const img = document.querySelector('[data-document-qr] img')
      expect(img).toBeTruthy()

      await act(async () => {
        img.dispatchEvent(new Event('error'))
      })

      expect(document.querySelector('[data-document-qr]')).toBeNull()
      // The UPI ID text is still there to pay by.
      expect(
        within(document.querySelector('[data-document-bank]')).getByText('ruchita@hdfcbank'),
      ).toBeInTheDocument()
    })

    it('shows the QR even when there is no bank snapshot to sit beside', () => {
      renderInvoice({ bank_snapshot: null }, { qrSrc: QR_URL })
      const bank = document.querySelector('[data-document-bank]')
      expect(bank).toBeTruthy()
      expect(document.querySelector('[data-document-qr]')).toBeTruthy()
    })
  })

  it('omits the bank block when the snapshot has no details (§21.24)', () => {
    renderInvoice({ bank_snapshot: { account_name: null, bank_name: null, upi_id: null } })
    expect(document.querySelector('[data-document-bank]')).toBeNull()
  })

  it('prints the snapshotted signatory, not the live Settings value', () => {
    // §8.4: an invoice is a snapshot; editing Settings must not rewrite it.
    renderInvoice()
    expect(screen.getByText('Snapshot Signatory')).toBeInTheDocument()
    expect(screen.queryByText('Live Settings Signatory')).not.toBeInTheDocument()
  })

  it('keeps the shared spine: items, tax breakdown, terms and footer', () => {
    renderInvoice()
    expect(screen.getByText('Modular base cabinet')).toBeInTheDocument()
    expect(screen.getByText('Discount (5%)')).toBeInTheDocument()
    expect(screen.getByText('GST 18%')).toBeInTheDocument()
    expect(screen.getByText('Site Preparation')).toBeInTheDocument()
    expect(screen.getByText('Grand Total')).toBeInTheDocument()
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Terms & Conditions' })).toBeInTheDocument()
    expect(screen.getByText('Modular Kitchen · Wardrobes · Turnkey Interiors')).toBeInTheDocument()
  })

  it('never prints internal notes', () => {
    renderInvoice({ notes: 'internal only, never print me' })
    expect(screen.queryByText('internal only, never print me')).not.toBeInTheDocument()
  })
})

// ------------------------------------- quotation path must not regress

describe('DocumentPaper — quotation path unaffected by the invoice variant', () => {
  it('stays a Quotation with its own dates and no money rows', () => {
    render(
      <DocumentPaper
        document={{
          number: 'QTN-2026-0007',
          quotation_date: '2026-09-29',
          valid_until: '2026-10-14',
          client_snapshot: { name: 'Meera Iyer' },
          discount_type: 'percent',
          discount_bp: 500,
          gst_bp: 1800,
          other_charges_paise: 0,
          subtotal_paise: 1000000,
          discount_paise: 50000,
          gst_paise: 171000,
          grand_total_paise: 1171000,
          terms_text: 'Term one.',
          items: [{ id: 1, category: 'Kitchen', name: 'Cabinet', qty_milli: 1000, rate_paise: 100000 }],
        }}
        settings={SETTINGS}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Quotation' })).toBeInTheDocument()
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Valid until')).toBeInTheDocument()

    // None of the invoice-only blocks leak in.
    expect(screen.queryByText('Amount Paid')).not.toBeInTheDocument()
    expect(screen.queryByText('Balance Due')).not.toBeInTheDocument()
    expect(document.querySelector('[data-document-bank]')).toBeNull()
  })

  it('falls back to the live Settings signatory when there is no snapshot', () => {
    render(
      <DocumentPaper
        document={{ number: 'QTN-1', quotation_date: '2026-01-01', items: [], grand_total_paise: 0 }}
        settings={SETTINGS}
      />,
    )
    expect(screen.getByText('Live Settings Signatory')).toBeInTheDocument()
  })
})

describe('groupItemsByCategory — reused by the invoice sheet', () => {
  it('groups consecutive items and reports the start index', () => {
    const groups = groupItemsByCategory([
      { id: 1, category: 'Kitchen' },
      { id: 2, category: 'Kitchen' },
      { id: 3, category: 'Paint' },
    ])
    expect(groups.map((g) => g.category)).toEqual(['Kitchen', 'Paint'])
    expect(groups.map((g) => g.startIndex)).toEqual([0, 2])
  })
})

// --------------------------------------------------------------- Phase 8

/**
 * PaymentSheet (§4.5 FR-P1, FR-P4).
 *
 * The two behaviours that matter: it opens on the outstanding balance so a full
 * payment needs no typing, and it warns before an overpayment is submitted. The
 * warning is display only — the server is what rejects (§11).
 */
describe('PaymentSheet', () => {
  const OUTSTANDING = 1171000

  function renderSheet(props = {}) {
    const onSubmit = props.onSubmit || (() => {})
    render(
      <MemoryRouter>
        <PaymentSheet open onClose={() => {}} outstandingPaise={OUTSTANDING} onSubmit={onSubmit} {...props} />
      </MemoryRouter>,
    )
    return { onSubmit }
  }

  it('prefills the amount with the outstanding balance', () => {
    renderSheet()
    const amount = screen.getByLabelText(/amount received/i)
    // paiseToInput: ungrouped, two decimals, no rupee sign.
    expect(amount.value).toBe('11710.00')
    // Stated twice on purpose — in the sheet subtitle and on the field itself.
    expect(screen.getAllByText('Outstanding ₹11,710.00').length).toBeGreaterThan(0)
  })

  it('offers every payment method from the shared enum', () => {
    renderSheet()
    const select = screen.getByLabelText(/method/i)
    const values = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(values).toEqual(['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'])
  })

  it('warns live when the amount exceeds the outstanding balance', async () => {
    const user = userEvent.setup()
    renderSheet()

    const amount = screen.getByLabelText(/amount received/i)
    await user.clear(amount)
    await user.type(amount, '20000')

    expect(screen.getByText(/more than the ₹11,710\.00 outstanding/i)).toBeInTheDocument()
    // And the submit is blocked, so the warning is not merely advisory copy.
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled()
  })

  it('rejects a zero amount', async () => {
    const user = userEvent.setup()
    renderSheet()

    const amount = screen.getByLabelText(/amount received/i)
    await user.clear(amount)

    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled()
  })

  it('submits paise with the chosen method and date', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderSheet({ onSubmit })

    const amount = screen.getByLabelText(/amount received/i)
    await user.clear(amount)
    await user.type(amount, '5000')
    await user.selectOptions(screen.getByLabelText(/method/i), 'bank_transfer')
    await user.type(screen.getByLabelText(/reference/i), 'TXN-99')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    // 5000 rupees -> 500000 paise. The client sends integers, never rupees.
    expect(payload.amount_paise).toBe(500000)
    expect(payload.method).toBe('bank_transfer')
    expect(payload.reference).toBe('TXN-99')
  })

  it('defaults the date to today', () => {
    renderSheet()
    const today = new Date().toISOString().slice(0, 10)
    expect(screen.getByLabelText(/date received/i).value).toBe(today)
  })

  it('re-seeds when the outstanding changes, so a stale amount is never shown', () => {
    const { rerender } = render(
      <MemoryRouter>
        <PaymentSheet open onClose={() => {}} outstandingPaise={OUTSTANDING} onSubmit={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/amount received/i).value).toBe('11710.00')

    rerender(
      <MemoryRouter>
        <PaymentSheet open onClose={() => {}} outstandingPaise={500000} onSubmit={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/amount received/i).value).toBe('5000.00')
  })

  it('shows a server rejection without discarding what was typed', () => {
    renderSheet({ error: 'Payment exceeds outstanding balance of ₹300.00.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Payment exceeds outstanding balance of ₹300.00.')
    // The field keeps its value so the amount can be corrected in place.
    expect(screen.getByLabelText(/amount received/i).value).toBe('11710.00')
  })
})
