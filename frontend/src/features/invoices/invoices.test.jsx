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
import { render, screen, waitFor, within } from '@testing-library/react'
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

/**
 * The QR encoder is mocked, exactly as in `UpiQrCard.test.jsx`, so a test can read the
 * UPI intent the sheet would have produced. The encoding itself is proven in
 * `lib/upi.test.js`; what matters here is *which amount the invoice hands it*.
 */
const toDataURL = vi.fn(async (uri) => `data:image/png;base64,${btoa(uri)}`)

vi.mock('qrcode', () => ({
  default: { toDataURL: (...args) => toDataURL(...args) },
}))

/** The `am` parameter of the most recent URI handed to the encoder. */
function encodedAmount() {
  const uri = String(toDataURL.mock.calls.at(-1)?.[0] ?? '')
  return new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get('am')
}

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
  // The generated UPI QR (§8.5) reads the VPA from live Settings, never from the
  // document's bank snapshot. A test that wants a QR sets this; one that wants to
  // prove the block disappears clears it.
  upi_id: 'ruchitainteriors@upi',
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

  it('is static: it shows no Amount Paid and no Balance Due, whatever the ledger says', () => {
    // A tax invoice is a fixed legal document of what was billed. The ledger figures are
    // sent on this very payload, and nothing on the sheet may read them — otherwise a
    // reprint after a payment would be a *different document* for the same billing, and
    // the customer's filed copy would no longer match what they were handed.
    renderInvoice()
    expect(screen.queryByText('Amount Paid')).not.toBeInTheDocument()
    expect(screen.queryByText('Balance Due')).not.toBeInTheDocument()
  })

  it('ends its totals at Grand Total, which is the amount billed', () => {
    renderInvoice()
    const totals = document.querySelector('[data-document-totals]')
    expect(within(totals).getByText('Grand Total')).toBeInTheDocument()
    // The last row is the grand total, so nothing payment-derived is printed after it.
    const rows = [...totals.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(rows.at(-1)).toBe('Grand Total')
  })

  it('prints identically before any payment and after the ledger is full', () => {
    // The load-bearing statement of §8.4. Same document, two very different ledger
    // states, byte-identical output — which is only possible if no payment-derived
    // field is read anywhere on the sheet.
    const unpaid = renderInvoice({ paid_paise: 0, outstanding_paise: 1171000, payment_status: 'unpaid' })
    const unpaidText = document.querySelector('[data-document-paper]').textContent
    unpaid.unmount()

    renderInvoice({ paid_paise: 1171000, outstanding_paise: 0, payment_status: 'paid' })
    expect(document.querySelector('[data-document-paper]').textContent).toBe(unpaidText)
  })

  it('encodes the grand total in its QR, never the outstanding balance', async () => {
    // The prompt warns about exactly this: an invoice whose code asked for the live
    // balance would quietly depend on the ledger, and a reprint would ask for a
    // different sum. The amount comes from the invoice's own saved total — checked here
    // on a *fully paid* payload, where the balance is ₹0 and a balance-derived code
    // would ask for nothing at all.
    toDataURL.mockClear()
    renderInvoice({ paid_paise: 1171000, outstanding_paise: 0, payment_status: 'paid' })
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())

    // ₹11,710.00 is the grand total; ₹0.00 is what a balance-derived code would ask for.
    expect(encodedAmount()).toBe('11710.00')
  })

  it('encodes the same grand total whatever the ledger says', async () => {
    // The stronger form of the same property: two very different payment states must
    // produce the identical `am`, or the invoice still depends on the ledger.
    toDataURL.mockClear()
    renderInvoice({ paid_paise: 0, outstanding_paise: 1171000, payment_status: 'unpaid' })
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())
    const unpaidAmount = encodedAmount()

    toDataURL.mockClear()
    renderInvoice({ paid_paise: 1171000, outstanding_paise: 0, payment_status: 'paid' })
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())

    expect(encodedAmount()).toBe(unpaidAmount)
  })

  it('renders the bank details from the snapshot', () => {
    renderInvoice()
    const payment = document.querySelector('[data-document-payment]')
    expect(payment).toBeTruthy()
    expect(within(payment).getByText('HDFC Bank')).toBeInTheDocument()
    expect(within(payment).getByText('00123456789')).toBeInTheDocument()
    expect(within(payment).getByText('HDFC0001234')).toBeInTheDocument()
  })

  it('prints the bank details exactly once, inside the Payment Details card', () => {
    // The account number used to be printed in the payment section *and* again beneath
    // the QR, in two different styles on the same page. It is now one row in one card.
    renderInvoice()
    const card = document.querySelector('[data-payment-card]')
    expect(card).toBeTruthy()
    expect(within(card).getAllByText('00123456789')).toHaveLength(1)
    expect(within(card).getAllByText('HDFC0001234')).toHaveLength(1)
  })

  // ------------------------------------------- FR-P8: the payment presentation (§8.5)
  //
  // The invoice prints the payment *instructions* the admin chose before issue, and
  // nothing derived from the ledger. The distinction is enforced by the whole
  // describe block: `latest_payment_method` and `paid_paise` are supplied by the
  // server in the payloads below and must never reach the sheet.
  //
  // The QR is back on the invoice (FR-P8 §7) and encodes the **grand total**, not
  // the outstanding balance: an outstanding amount is unknowable at issue and moves
  // with every payment, so encoding it would make a reprint of the same document ask
  // for a different figure. Collecting a reduced sum is the Balance / Payment Due
  // document's job, and that document is regenerated per payment.

  describe('payment presentation (FR-P8)', () => {
    it('is a section of the invoice, with a hairline like the other blocks', () => {
      renderInvoice()

      const payment = document.querySelector('[data-document-payment]')
      expect(payment).toBeTruthy()
      // The block's own heading is "PAYMENT DETAILS" (set by the shared card); the
      // invoice no longer adds a second "Payment" label above it.
      expect(within(payment).getByText('Payment Details')).toBeInTheDocument()
      expect(within(payment).queryByText('Payment')).not.toBeInTheDocument()
    })

    it('UPI selected: UPI details and a QR, and no bank details at all', () => {
      renderInvoice({ payment_method: 'upi' })
      const payment = document.querySelector('[data-document-payment]')

      // The UPI ID is a row in the card's grid, so it appears exactly once.
      expect(within(payment).getByText('UPI ID')).toBeInTheDocument()
      expect(within(payment).getByText('ruchitainteriors@upi')).toBeInTheDocument()
      expect(within(payment).getByText(/Scan to Pay/i)).toBeInTheDocument()
      expect(within(payment).getByText(/verify the amount before paying/i)).toBeInTheDocument()
      expect(document.querySelector('[data-upi-qr]')).toBeTruthy()

      // The exclusion matters as much as the inclusion: an account number printed
      // beside a UPI code invites the customer to pick the wrong rail.
      expect(within(payment).queryByText('00123456789')).toBeNull()
      expect(within(payment).queryByText('HDFC0001234')).toBeNull()
      expect(within(payment).queryByText('HDFC Bank')).toBeNull()
    })

    it('bank transfer selected: the bank details, and no QR or UPI ID', () => {
      renderInvoice({ payment_method: 'bank_transfer' })
      const payment = document.querySelector('[data-document-payment]')

      expect(within(payment).getByText('Ruchita Interiors LLP')).toBeInTheDocument()
      expect(within(payment).getByText('00123456789')).toBeInTheDocument()
      expect(within(payment).getByText('HDFC Bank')).toBeInTheDocument()
      expect(within(payment).getByText('HDFC0001234')).toBeInTheDocument()

      expect(document.querySelector('[data-upi-qr]')).toBeNull()
      expect(within(payment).queryByText('ruchitainteriors@upi')).toBeNull()
    })

    it('cash selected: the method line alone, with no rail and no account number', () => {
      renderInvoice({ payment_method: 'cash' })
      const payment = document.querySelector('[data-document-payment]')

      expect(within(payment).getByText(/Payment Method: Cash/)).toBeInTheDocument()
      expect(document.querySelector('[data-upi-qr]')).toBeNull()
      expect(within(payment).queryByText('00123456789')).toBeNull()
      expect(within(payment).queryByText('HDFC0001234')).toBeNull()
      expect(within(payment).queryByText('ruchitainteriors@upi')).toBeNull()
    })

    it('not selected: both electronic rails, and cash is never offered', () => {
      // The default is deliberately the permissive one — the client can pay either
      // way. Cash is a choice the admin makes, not something the sheet suggests.
      renderInvoice({ payment_method: null })
      const payment = document.querySelector('[data-document-payment]')

      expect(within(payment).getByText('ruchitainteriors@upi')).toBeInTheDocument()
      expect(within(payment).getByText('00123456789')).toBeInTheDocument()
      expect(within(payment).getByText('HDFC0001234')).toBeInTheDocument()
      expect(document.querySelector('[data-upi-qr]')).toBeTruthy()
      expect(within(payment).queryByText(/Cash/)).toBeNull()
    })

    it('an absent payment_method reads as not selected, not as an error', () => {
      // A server predating the column sends no key at all; both rails must show
      // rather than an empty block or a thrown render.
      renderInvoice({ payment_method: undefined })
      const payment = document.querySelector('[data-document-payment]')
      expect(within(payment).getByText('ruchitainteriors@upi')).toBeInTheDocument()
      expect(within(payment).getByText('00123456789')).toBeInTheDocument()
    })

    it('ignores the ledger entirely, so a differently-paid invoice prints identically', () => {
      // The load-bearing case. Issued as UPI, then settled by bank transfer: the
      // document must still print the UPI presentation, and the derived figures the
      // server sends must not leak onto the page.
      const before = renderInvoice({ payment_method: 'upi' })
      const sheetBefore = document.querySelector('[data-document-paper]').textContent

      before.unmount()
      renderInvoice({
        payment_method: 'upi',
        latest_payment_method: 'bank_transfer',
        paid_paise: 585500,
        outstanding_paise: 585500,
        payment_status: 'partially_paid',
      })

      const payment = document.querySelector('[data-document-payment]')
      expect(within(payment).getByText('ruchitainteriors@upi')).toBeInTheDocument()
      expect(within(payment).queryByText(/Bank transfer/)).toBeNull()
      expect(within(payment).queryByText('Awaiting Payment')).toBeNull()
      expect(sheetBefore).toContain('ruchitainteriors@upi')
    })

    it('never prints a ledger-derived method, whatever the server sends', () => {
      // `latest_payment_method` is for the application UI. On a permanent document
      // it would be the exact confusion FR-P8 exists to prevent: a sheet that
      // silently re-presents itself in the method it was last paid by.
      renderInvoice({ payment_method: 'upi', latest_payment_method: 'cash' })
      const payment = document.querySelector('[data-document-payment]')
      expect(within(payment).queryByText(/Cash/)).toBeNull()
    })

    it('prints the UPI ID live from Settings, not the frozen snapshot', () => {
      // The one §8.4 exception on this sheet: a payment address is an instruction
      // to send money somewhere, not a term of the invoice, so a closed account must
      // not stay on already-issued documents. The *method* is frozen; the address it
      // points at is live.
      renderInvoice({ bank_snapshot: { ...BANK, upi_id: 'closed-account@oldbank' } })
      const payment = document.querySelector('[data-document-payment]')
      expect(within(payment).getAllByText(/ruchitainteriors@upi/).length).toBeGreaterThan(0)
      expect(within(payment).queryByText('closed-account@oldbank')).toBeNull()
    })

    it('prints no rail at all when a UPI invoice has no UPI ID configured', () => {
      // An admin misconfiguration, so the fallback is deliberately *not* to widen
      // the presentation: showing bank details on an invoice that says UPI would
      // contradict the choice on the document, and a "Scan to Pay" line with no code
      // points nowhere. An empty block is the honest outcome.
      render(
        <DocumentPaper
          document={invoice({ payment_method: 'upi' })}
          settings={{ ...SETTINGS, upi_id: '' }}
          docKind="invoice"
        />,
      )
      expect(document.querySelector('[data-upi-qr]')).toBeNull()
      expect(document.querySelector('[data-document-payment]')).toBeNull()
    })

    it('omits the section entirely when there is nothing to show in it', () => {
      // §21.24: no snapshot rows and no configured UPI ID means no block, rather
      // than an empty panel on a customer-facing document.
      render(
        <DocumentPaper
          document={invoice({ bank_snapshot: { account_name: null, bank_name: null, upi_id: null } })}
          settings={{ ...SETTINGS, upi_id: '' }}
          docKind="invoice"
        />,
      )
      expect(document.querySelector('[data-document-payment]')).toBeNull()
    })

    it('still prints for a cash invoice with no payment details configured at all', () => {
      // The method line is the invoice's whole instruction, so the block must not
      // vanish just because the snapshot is empty.
      render(
        <DocumentPaper
          document={invoice({
            payment_method: 'cash',
            bank_snapshot: { account_name: null, bank_name: null, upi_id: null },
          })}
          settings={{ ...SETTINGS, upi_id: '' }}
          docKind="invoice"
        />,
      )
      const payment = document.querySelector('[data-document-payment]')
      expect(within(payment).getByText(/Payment Method: Cash/)).toBeInTheDocument()
    })

    it('is absent from a quotation, which is not payable', () => {
      render(
        <DocumentPaper
          document={{
            number: 'QTN-1',
            quotation_date: '2026-09-29',
            items: [],
            grand_total_paise: 0,
            bank_snapshot: { bank_name: 'HDFC Bank', account_number: '00123456789' },
            payment_method: 'upi',
          }}
          settings={SETTINGS}
          docKind="quotation"
        />,
      )
      expect(document.querySelector('[data-document-payment]')).toBeNull()
    })
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
