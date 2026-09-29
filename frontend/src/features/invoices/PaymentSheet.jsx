/**
 * Ruchita Interiors — record-payment sheet (§4.5 FR-P1, FR-P4).
 *
 * A Sheet rather than ConfirmDialog, because ConfirmDialog hardcodes exactly two
 * buttons and this needs a form. It is the counterpart of `record_payment` on the
 * invoice detail page.
 *
 * Two behaviours worth naming:
 *
 * - **Amount is prefilled with the outstanding balance** (§11), so recording a
 *   full payment is the common case and needs no typing.
 * - **Overpayment warns live** (FR-P4). The warning is display-only: the client
 *   is told the balance is exceeded before submitting, but the server is what
 *   actually rejects it. Nothing here decides money.
 */

import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import Sheet from '../../components/ui/Sheet.jsx'
import TextField from '../../components/ui/TextField.jsx'
import { formatPaise, paiseToInput, rupeesToPaise } from '../../lib/money.js'
import { PAYMENT_METHOD_OPTIONS } from './status.js'
import styles from './PaymentSheet.module.css'

const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   outstandingPaise: number,
 *   onSubmit: (payload: object) => void,
 *   submitting?: boolean,
 *   error?: string | null,
 * }} props
 */
export default function PaymentSheet({
  open,
  onClose,
  outstandingPaise = 0,
  onSubmit,
  submitting = false,
  error = null,
}) {
  const outstanding = outstandingPaise || 0
  const [amount, setAmount] = useState(paiseToInput(outstanding))
  const [method, setMethod] = useState('upi')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  /**
   * Re-seed whenever the sheet opens, so the amount reflects the balance at the
   * moment it was opened rather than a stale figure from a previous invoice.
   *
   * Done during render rather than in an effect: this is React's "adjust state
   * when a prop changes" pattern, it avoids the cascading second render an
   * effect would cause, and the form must not flash the previous invoice's
   * amount for a frame when the sheet opens.
   */
  const [seed, setSeed] = useState({ open, outstandingPaise })
  if (seed.open !== open || seed.outstandingPaise !== outstandingPaise) {
    setSeed({ open, outstandingPaise })
    setAmount(paiseToInput(outstandingPaise || 0))
    setMethod('upi')
    setPaidOn(todayIso())
    setReference('')
    setNotes('')
  }

  const amountPaise = rupeesToPaise(amount)
  const overpays = amountPaise > outstanding
  const nothingToPay = amountPaise <= 0

  const handleSubmit = (event) => {
    event.preventDefault()
    if (overpays || nothingToPay) return
    onSubmit({
      amount_paise: amountPaise,
      paid_on: paidOn || null,
      method,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record payment"
      description={`Outstanding ${formatPaise(outstanding)}`}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <TextField
          label="Amount received (₹)"
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          autoComplete="off"
          error={
            overpays
              ? `That is more than the ${formatPaise(outstanding)} outstanding.`
              : nothingToPay && amount !== ''
                ? 'Enter an amount greater than zero.'
                : undefined
          }
          hint={`Outstanding ${formatPaise(outstanding)}`}
          required
        />

        <div className={styles.row}>
          <TextField as="select" label="Method" value={method} onChange={setMethod}>
            {PAYMENT_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </TextField>

          <TextField label="Date received" type="date" value={paidOn} onChange={setPaidOn} required />
        </div>

        <TextField
          label="Reference"
          placeholder="UPI txn / cheque number"
          value={reference}
          onChange={setReference}
          autoComplete="off"
          hint="Optional — helps when reconciling later."
        />

        <TextField
          as="textarea"
          label="Notes"
          rows={2}
          value={notes}
          onChange={setNotes}
          hint="Internal, not printed"
        />

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon="check"
            loading={submitting}
            disabled={overpays || nothingToPay}
          >
            Record payment
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
