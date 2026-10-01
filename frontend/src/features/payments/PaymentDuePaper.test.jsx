/**
 * Balance / Payment Due document tests (§8.5).
 *
 * The document is presentational, so these assert what it *says* — and, more
 * importantly, what it does not say. Two failures this suite exists to prevent:
 *
 * 1. **A second revenue document.** The sheet must be headed by the invoice it is
 *    about, carry no number of its own, and never present itself as a new bill. A
 *    "Balance Invoice" that looked like an invoice would be disputable, and a
 *    customer who thought they were re-invoiced would be right to complain.
 * 2. **A payment claim it cannot support.** Scanning a QR tells the application
 *    nothing (§11: status is derived from the ledger). The sheet asks for money and
 *    says the amount is one to verify; it never asserts that anything was received.
 *
 * The QR encoder is mocked, exactly as in `UpiQrCard.test.jsx` — the encoding itself
 * is proven in `lib/upi.test.js`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

const toDataURL = vi.fn(async (uri) => `data:image/png;base64,${btoa(uri)}`)

vi.mock('qrcode', () => ({
  default: { toDataURL: (...args) => toDataURL(...args) },
}))

const { default: PaymentDuePaper } = await import('./PaymentDuePaper.jsx')

const SETTINGS = {
  company_name: 'Ruchita Interiors',
  address_line1: '14, Rose Villa',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: '452001',
  signatory_name: 'Ruchita Interiors',
  footer_text: 'Modular Kitchen · Wardrobes',
}

/** Shaped like the server's `GET /invoices/:id/payment-due` response. */
function paymentDue(overrides = {}) {
  return {
    kind: 'payment_due',
    title: 'PAYMENT DUE',
    source_invoice_id: 7,
    source_invoice_number: 'INV-2026-0001',
    generated_on: '2026-09-30',
    due_date: '2026-10-29',
    currency: 'INR',
    grand_total_paise: 10000000,
    paid_paise: 4000000,
    outstanding_paise: 6000000,
    amount_due_paise: 6000000,
    payment_status: 'partially_paid',
    upi_id: 'ruchitainteriors@upi',
    payee_name: 'Ruchita Interiors',
    upi_uri: 'upi://pay?pa=ruchitainteriors%40upi&am=60000.00&cu=INR',
    upi_amount: '60000.00',
    bank: {
      account_name: 'Ruchita Interiors LLP',
      account_number: '00123456789',
      bank_name: 'HDFC Bank',
      ifsc: 'HDFC0001234',
      branch: 'Vijay Nagar',
      upi_id: 'ruchitainteriors@upi',
    },
    client: { name: 'Meera Iyer', address: '22, Green Meadows, Indore' },
    ...overrides,
  }
}

function renderPaper(overrides = {}, settings = SETTINGS) {
  return render(<PaymentDuePaper doc={paymentDue(overrides)} settings={settings} />)
}

function encodedParam(key) {
  const uri = String(toDataURL.mock.calls.at(-1)?.[0] ?? '')
  return new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get(key)
}

beforeEach(() => {
  toDataURL.mockClear()
  toDataURL.mockImplementation(async (uri) => `data:image/png;base64,${btoa(uri)}`)
})

describe('PaymentDuePaper', () => {
  it('is titled PAYMENT DUE, not something that reads as a new invoice', () => {
    renderPaper()
    expect(screen.getByRole('heading', { level: 1, name: 'PAYMENT DUE' })).toBeInTheDocument()
  })

  it('references the source invoice and carries no number of its own', () => {
    renderPaper()

    expect(screen.getByText('INV-2026-0001')).toBeInTheDocument()
    // A second number would read as a second billing document. The reference *is*
    // the identifier.
    expect(screen.queryByText(/^PD-/i)).toBeNull()
    expect(screen.queryByText(/^INV-2026-0002/)).toBeNull()
  })

  it('reconciles the original total, what was received, and what is left', () => {
    renderPaper()

    expect(screen.getByText('Original invoice total')).toBeInTheDocument()
    expect(screen.getByText('₹1,00,000.00')).toBeInTheDocument()
    expect(screen.getByText('Total received')).toBeInTheDocument()
    expect(screen.getByText('₹40,000.00')).toBeInTheDocument()
    expect(screen.getByText('Outstanding balance')).toBeInTheDocument()
    expect(screen.getAllByText('₹60,000.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Amount due now')).toBeInTheDocument()
  })

  it('says plainly that it is a reminder and not a new invoice', () => {
    renderPaper()
    // A customer who thinks they are being re-invoiced will dispute it, and they
    // would be right to.
    expect(screen.getByText(/not a new invoice/i)).toBeInTheDocument()
  })

  it('asks the reader to verify the amount, because paper is a snapshot', () => {
    renderPaper()
    // Said exactly once, in the footer. The card takes no hint on this sheet — passing
    // it to both printed the same sentence twice on one page, which is the very
    // duplication the shared card exists to remove.
    expect(screen.getAllByText(/verify the amount before paying/i)).toHaveLength(1)
  })

  it('encodes the outstanding balance, not the invoice total', async () => {
    renderPaper()
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())

    // The whole reason the QR is generated rather than uploaded: a printed copy of
    // a partly-paid invoice must not ask for the full amount again.
    expect(encodedParam('am')).toBe('60000.00')
    expect(encodedParam('am')).not.toBe('100000.00')
  })

  it('keeps the displayed amount and the encoded amount in step', async () => {
    // A later payment changes the balance; a newly generated document must show and
    // ask for the new figure together.
    renderPaper({
      paid_paise: 6000000,
      outstanding_paise: 4000000,
      amount_due_paise: 4000000,
      upi_amount: '40000.00',
    })
    await waitFor(() => expect(encodedParam('am')).toBe('40000.00'))
    expect(screen.getAllByText('₹40,000.00').length).toBeGreaterThan(0)
  })

  it('never claims a payment was received', () => {
    renderPaper()
    // The ledger says 40,000 of 1,00,000. Nothing on this sheet may imply otherwise.
    expect(screen.queryByText(/payment (successful|received|complete)/i)).toBeNull()
    expect(screen.queryByText(/amount paid in full/i)).toBeNull()
    expect(screen.queryByText(/settled/i)).toBeNull()
  })

  it('shows the bank details once, in the Payment Details card', () => {
    renderPaper()

    // One card, one copy of each value. The bank block used to be a separate section
    // *and* the QR repeated the UPI address underneath the code, so a customer read the
    // same account twice on one page.
    const card = document.querySelector('[data-payment-card]')
    expect(card).toBeTruthy()
    expect(screen.getByText('Payment Details')).toBeInTheDocument()
    expect(within(card).getByText('HDFC Bank')).toBeInTheDocument()
    expect(within(card).getAllByText('00123456789')).toHaveLength(1)
    expect(within(card).getByText('HDFC0001234')).toBeInTheDocument()
    expect(within(card).getByText('Branch')).toBeInTheDocument()
    // The UPI ID is a row in the same grid, printed once.
    expect(within(card).getByText('UPI ID')).toBeInTheDocument()
    expect(within(card).getAllByText('ruchitainteriors@upi')).toHaveLength(1)
  })

  it('offers the code and the bank transfer as alternatives in one block', () => {
    renderPaper()
    // Still one payment section, not two demands: the card header names both rails.
    expect(document.querySelectorAll('[data-payment-card]')).toHaveLength(1)
    expect(screen.getByText('Scan to Pay')).toBeInTheDocument()
  })

  it('omits the QR when no UPI ID is configured, keeping the bank route', () => {
    renderPaper({ upi_id: '', upi_uri: null, upi_amount: '0.00' })

    expect(document.querySelector('[data-upi-qr]')).toBeNull()
    // No "Scan to Pay" label either — a caption over no code points nowhere.
    expect(screen.queryByText('Scan to Pay')).not.toBeInTheDocument()
    // The bank route is unaffected.
    expect(document.querySelector('[data-payment-card]')).toBeTruthy()
    expect(screen.getByText('HDFC Bank')).toBeInTheDocument()
  })

  it('still shows the card when no bank details are configured, because the code remains', () => {
    renderPaper({ bank: {} })
    expect(document.querySelector('[data-upi-qr]')).toBeTruthy()
    // Only the UPI ID row survives; no empty bank rows are printed.
    expect(screen.queryByText('Account Number')).not.toBeInTheDocument()
    expect(screen.getByText('UPI ID')).toBeInTheDocument()
  })

  it('names the source invoice in the QR note so a payer can match the payment', async () => {
    renderPaper()
    await waitFor(() => expect(encodedParam('tn')).toBe('INV-2026-0001'))
    expect(screen.getByText(/Ref INV-2026-0001/)).toBeInTheDocument()
  })

  it('records the generation date, since a snapshot is dated', () => {
    renderPaper()
    expect(screen.getByText(/generated 30 Sep 2026/i)).toBeInTheDocument()
  })

  it('renders at heading level 2 when embedded, so the host keeps its <h1>', () => {
    render(<PaymentDuePaper doc={paymentDue()} settings={SETTINGS} titleLevel="h2" />)
    expect(screen.getByRole('heading', { level: 2, name: 'PAYMENT DUE' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })
})

/**
 * The settled state (§8.5).
 *
 * This is the document a customer asks for *after* paying, so it has to be producible:
 * the server answers 200 with `fully_paid` rather than refusing, and the sheet becomes a
 * statement of settlement. The load-bearing property is what it must **stop** doing — no
 * QR and no bank details — because a live scan-to-pay code under a "fully paid" stamp
 * would invite a payment of nothing and undermine the stamp.
 */
describe('PaymentDuePaper — fully paid', () => {
  const SETTLED = {
    paid_paise: 10000000,
    outstanding_paise: 0,
    amount_due_paise: 0,
    fully_paid: true,
    payment_status: 'paid',
    upi_uri: null,
    upi_amount: '0.00',
  }

  it('stamps the sheet FULLY PAID', () => {
    renderPaper(SETTLED)
    expect(screen.getByText('Fully Paid')).toBeInTheDocument()
  })

  it('reads the amount due as zero, and shows no negative balance', () => {
    renderPaper(SETTLED)
    expect(screen.getByText('Amount due now')).toBeInTheDocument()
    // Both the outstanding row and the amount-due row read ₹0.00 when settled.
    expect(screen.getAllByText('₹0.00')).toHaveLength(2)
    // Clamped, never negative: an overpaid ledger must not print a credit on a
    // collection document.
    expect(document.body.textContent).not.toMatch(/[-−]₹/)
  })

  it('hides the QR and the bank details entirely', () => {
    renderPaper(SETTLED)
    // Nothing left to pay, so nothing may be payable.
    expect(document.querySelector('[data-upi-qr]')).toBeNull()
    expect(document.querySelector('[data-payment-card]')).toBeNull()
    expect(screen.queryByText('HDFC Bank')).not.toBeInTheDocument()
    expect(screen.queryByText('00123456789')).not.toBeInTheDocument()
    expect(screen.queryByText('Scan to Pay')).not.toBeInTheDocument()
  })

  it('thanks the customer instead of demanding payment', () => {
    renderPaper(SETTLED)
    expect(screen.getByText('Payment received in full. Thank you.')).toBeInTheDocument()
    // The demand copy is gone: this is no longer a request for money.
    expect(screen.queryByText(/verify the amount before paying/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not a new invoice/i)).not.toBeInTheDocument()
  })

  it('still reconciles the full history, so it works as a receipt', () => {
    renderPaper(SETTLED)
    expect(screen.getByText('Original invoice total')).toBeInTheDocument()
    expect(screen.getByText('Total received')).toBeInTheDocument()
    expect(screen.getByText('Outstanding balance')).toBeInTheDocument()
    // Total and received are both the whole invoice here, so the figure appears twice.
    expect(screen.getAllByText('₹1,00,000.00')).toHaveLength(2)
  })

  it('keeps the reference and generation date, so it is still a dated record', () => {
    renderPaper(SETTLED)
    expect(screen.getByText('INV-2026-0001')).toBeInTheDocument()
    expect(screen.getByText(/generated 30 Sep 2026/i)).toBeInTheDocument()
  })

  it('falls back to the balance when the server sends no flag', async () => {
    // A payload from a server that predates `fully_paid`. The zero balance is the same
    // state, and treating it as anything else would print a ₹0 QR.
    renderPaper({ ...SETTLED, fully_paid: undefined })
    expect(screen.getByText('Fully Paid')).toBeInTheDocument()
    expect(document.querySelector('[data-upi-qr]')).toBeNull()
  })

  it('keeps the Payment Due look while any balance remains', () => {
    renderPaper()
    expect(screen.queryByText('Fully Paid')).not.toBeInTheDocument()
    expect(document.querySelector('[data-payment-card]')).toBeTruthy()
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument()
  })
})
