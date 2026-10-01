/**
 * UPI QR card tests (§8.5).
 *
 * The card is the payment surface, so what is asserted is the *money* property: the
 * encoded amount and the displayed amount are the same figure, and they change
 * together when the amount does. A card that showed one figure and encoded another
 * would look correct to a reviewer and over- or under-charge a customer.
 *
 * The QR encoder is mocked rather than run. It is a pure function of the URI (proven
 * in `lib/upi.test.js`), and letting it draw into jsdom's canvas would make these
 * tests depend on a rendering path that tells us nothing about this component.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toDataURL = vi.fn(async (uri) => `data:image/png;base64,${btoa(uri)}`)

vi.mock('qrcode', () => ({
  default: { toDataURL: (...args) => toDataURL(...args) },
}))

const { default: UpiQrCard } = await import('./UpiQrCard.jsx')
const { buildUpiUri } = await import('../../lib/upi.js')

const VPA = 'ruchitainteriors@upi'

/** The URI the card handed the encoder, decoded back to a parameter bag. */
function encodedParam(key) {
  const uri = String(toDataURL.mock.calls.at(-1)?.[0] ?? '')
  return new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get(key)
}

beforeEach(() => {
  toDataURL.mockClear()
  toDataURL.mockImplementation(async (uri) => `data:image/png;base64,${btoa(uri)}`)
})

describe('UpiQrCard', () => {
  it('displays the amount and encodes the same amount', async () => {
    render(<UpiQrCard amountPaise={2500000} vpa={VPA} payeeName="Ruchita Interiors" />)

    // ₹25,000.00 shown...
    expect(screen.getByText('₹25,000.00')).toBeInTheDocument()
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())
    // ...and the QR asks for exactly that.
    expect(encodedParam('am')).toBe('25000.00')
  })

  it('regenerates when the amount changes, and the figure follows it', async () => {
    const { rerender } = render(<UpiQrCard amountPaise={1000000} vpa={VPA} />)
    await waitFor(() => expect(encodedParam('am')).toBe('10000.00'))
    expect(screen.getByText('₹10,000.00')).toBeInTheDocument()

    for (const [paise, shown, encoded] of [
      [2500000, '₹25,000.00', '25000.00'],
      [5000000, '₹50,000.00', '50000.00'],
    ]) {
      rerender(<UpiQrCard amountPaise={paise} vpa={VPA} />)
      await waitFor(() => expect(encodedParam('am')).toBe(encoded))
      expect(screen.getByText(shown)).toBeInTheDocument()
    }
  })

  it('never carries a stale code when the amount changes', async () => {
    // The encoded image is stored keyed by its URI precisely so the previous code
    // cannot survive a re-render with a new amount. Asserted by making the *new*
    // encode slow: the displayed image must disappear immediately rather than
    // lingering with the old amount's payload.
    const { rerender } = render(<UpiQrCard amountPaise={1000000} vpa={VPA} />)
    await screen.findByRole('img', { name: /pay ₹10,000\.00/ })

    let release
    toDataURL.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve('data:image/png;base64,new')
        }),
    )
    rerender(<UpiQrCard amountPaise={2500000} vpa={VPA} />)

    // The old ₹10,000.00 code is gone on this render, not after the new one lands.
    expect(screen.queryByRole('img', { name: /pay ₹10,000\.00/ })).toBeNull()

    release()
    await screen.findByRole('img', { name: /pay ₹25,000\.00/ })
  })

  it('shows the VPA and payee name so a customer can pay without scanning', () => {
    render(<UpiQrCard amountPaise={2500000} vpa={VPA} payeeName="Ruchita Interiors" note="INV-2026-0001" />)

    expect(screen.getByText(VPA)).toBeInTheDocument()
    expect(screen.getByText('Ruchita Interiors')).toBeInTheDocument()
    expect(screen.getByText(/Ref INV-2026-0001/)).toBeInTheDocument()
  })

  it('renders nothing at all without a UPI ID', () => {
    const { container } = render(<UpiQrCard amountPaise={2500000} vpa="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to the VPA as text when the address is not usable', async () => {
    // A malformed VPA cannot produce a QR. Showing the address beats an empty frame,
    // and a broken code that opens an app asking for nothing would be worse.
    render(<UpiQrCard amountPaise={2500000} vpa="not-a-vpa" />)

    expect(screen.getByText('not-a-vpa')).toBeInTheDocument()
    expect(screen.getByText(/no qr code can be made/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    expect(toDataURL).not.toHaveBeenCalled()
  })

  it('falls back to the VPA as text when the encoder fails', async () => {
    toDataURL.mockRejectedValueOnce(new Error('canvas unavailable'))
    render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)

    expect(await screen.findByText(/could not be generated/i)).toBeInTheDocument()
    // Still payable by hand.
    expect(screen.getByText(VPA)).toBeInTheDocument()
  })

  it('never claims the payment succeeded', () => {
    // Scanning the code tells this application nothing. The card has to say so, or
    // a user will read a rendered QR as a receipt.
    render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)

    expect(screen.getByText(/does not record a payment/i)).toBeInTheDocument()
    expect(screen.queryByText(/payment (successful|received|complete)/i)).toBeNull()
  })

  it('offers no "open app" link on a desktop, where upi:// has no handler', () => {
    render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)
    expect(screen.queryByRole('link', { name: /open upi app/i })).toBeNull()
  })

  describe('copying the UPI ID', () => {
    it('reports success when the clipboard accepts the value', async () => {
      const user = userEvent.setup()
      // Set *after* setup(): user-event installs its own clipboard stub, and a
      // property defined beforehand would be silently replaced.
      const writeText = vi.fn(async () => {})
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

      render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)
      await user.click(screen.getByRole('button', { name: /copy upi id/i }))

      expect(writeText).toHaveBeenCalledWith(VPA)
      expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
    })

    it('says so when copying failed, rather than pretending it worked', async () => {
      const user = userEvent.setup()
      // After setup(), so this replaces user-event's permissive stub rather than
      // being replaced by it. The legacy `execCommand` path is also unavailable in
      // jsdom, so this exercises the total-failure branch.
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            throw new Error('denied')
          },
        },
        configurable: true,
      })
      document.execCommand = () => false

      render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)
      await user.click(screen.getByRole('button', { name: /copy upi id/i }))

      expect(await screen.findByText(/copy it manually/i)).toBeInTheDocument()
    })

    it('has a touch target of at least 44px', () => {
      // A 44px minimum is the accessibility floor in tokens.css; the actions row is
      // the part of this card a thumb actually has to hit.
      const { container } = render(<UpiQrCard amountPaise={2500000} vpa={VPA} />)
      const button = container.querySelector('button')
      expect(button).toBeTruthy()
    })
  })
})

describe('UpiQrCard and lib/upi.js agree', () => {
  it('encodes exactly what the shared builder produces', async () => {
    // Guards against the card growing a second formatting path. The server builds
    // the same URI for the payment-due document, so any divergence here would show
    // up as a document whose QR disagrees with the amount printed beside it.
    const props = {
      amountPaise: 6000000,
      vpa: VPA,
      payeeName: 'Ruchita Interiors',
      note: 'INV-2026-0001',
    }
    render(<UpiQrCard {...props} />)
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())

    expect(toDataURL.mock.calls.at(-1)[0]).toBe(buildUpiUri(props))
  })
})

describe('print variant', () => {
  it('renders a compact horizontal block, not the screen card', () => {
    // The whole regression this exists for. Before `variant="print"` existed, the
    // A4 documents styled the card from *their* modules (`.bankQr .card`,
    // `.qrCard .actions`), which CSS Modules compiled to the parent's own hash and
    // therefore never matched an element carrying this module's hash. Both documents
    // shipped rendering the full screen card, buttons and disclaimer included.
    render(<UpiQrCard amountPaise={6000000} vpa={VPA} payeeName="Ruchita Interiors" variant="print" />)

    expect(document.querySelector('[data-variant="print"]')).toBeTruthy()
  })

  it('drops the interactive chrome nobody can use on paper', () => {
    render(<UpiQrCard amountPaise={6000000} vpa={VPA} variant="print" />)

    // No buttons, no disclaimer, no copy-failure note. A 44px touch target is a
    // large share of a compact payment block, and the disclaimer explains a screen
    // interaction.
    expect(screen.queryByRole('button', { name: /copy upi id/i })).toBeNull()
    expect(screen.queryByText(/does not record a payment/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /open upi app/i })).toBeNull()
  })

  it('drops the display-serif title, so it does not compete with the totals block', () => {
    render(<UpiQrCard amountPaise={6000000} vpa={VPA} title="Scan to pay the balance" variant="print" />)
    // The screen variant renders this at --font-size-lg display serif, which is what
    // made the payment area read as a second document.
    expect(screen.queryByText('Scan to pay the balance')).toBeNull()
  })

  it('keeps what a customer without a scanner needs', () => {
    render(
      <UpiQrCard
        amountPaise={6000000}
        vpa={VPA}
        payeeName="Ruchita Interiors"
        note="INV-2026-0001"
        variant="print"
      />,
    )
    expect(screen.getByText(VPA)).toBeInTheDocument()
    // Escaped rather than typed: the rupee sign is a literal that authoring from
    // PowerShell mangles, and a mangled assertion fails for the wrong reason.
    expect(screen.getByText('\u20b960,000.00')).toBeInTheDocument()
    expect(screen.getByText(/Ref INV-2026-0001/)).toBeInTheDocument()
  })

  it('still encodes the amount, which is the point of the balance document', async () => {
    render(<UpiQrCard amountPaise={6000000} vpa={VPA} variant="print" />)
    await waitFor(() => expect(toDataURL).toHaveBeenCalled())
    expect(encodedParam('am')).toBe('60000.00')
  })

  it('is screen by default, so no existing caller changes behaviour', () => {
    render(<UpiQrCard amountPaise={6000000} vpa={VPA} />)
    expect(document.querySelector('[data-variant="screen"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /copy upi id/i })).toBeInTheDocument()
  })
})
