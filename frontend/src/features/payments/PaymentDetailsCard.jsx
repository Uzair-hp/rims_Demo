/**
 * Ruchita Interiors — the Payment Details card (§8.5).
 *
 * **One** payment block, printed once per document, on both the Tax Invoice
 * (`DocumentPaper`) and the Balance / Payment Due sheet (`PaymentDuePaper`). It replaced
 * two unrelated implementations — a QR card plus a separate bank block on each sheet —
 * which is how the same account number ended up printed in two different styles on the
 * same page, and how the QR came to dominate the sheet as though it were a second
 * document.
 *
 * What is deliberately *not* decided here: **which rails to show**. FR-P8 freezes the
 * admin's `payment_method` choice at issue, and that choice is load-bearing — printing an
 * account number beside a UPI code invites the customer to pick the wrong rail. So the
 * caller decides and passes `showQr` / `showBank` / `showUpiRow` plus the rows it wants;
 * this component only lays them out. Deriving the rails here would mean the Balance Bill
 * had to grow a `payment_method` it deliberately does not have.
 *
 * The amount shown under the code and the amount the code encodes are both one
 * `amountPaise` prop, handed to `UpiQrCard` unchanged, so the figure a payer reads and the
 * figure their app asks for cannot drift apart.
 *
 * Presentational: it fetches nothing and holds no money state.
 *
 * @param {{
 *   bankRows?: Array<{ label: string, value: string }>,
 *   upiId?: string,
 *   showBank?: boolean,
 *   showQr?: boolean,
 *   amountPaise?: number,
 *   payeeName?: string,
 *   note?: string,
 *   methodLabel?: string | null,
 *   hint?: string | null,
 * }} props
 */

import Icon from '../../components/ui/Icon.jsx'
import UpiQrCard from './UpiQrCard.jsx'
import styles from './PaymentDetailsCard.module.css'

export default function PaymentDetailsCard({
  bankRows = [],
  upiId = '',
  showBank = false,
  showQr = false,
  amountPaise = 0,
  payeeName = '',
  note = '',
  methodLabel = null,
  hint = null,
}) {
  // The UPI address is printed as a row in the same grid as the bank fields, so the
  // whole rail reads as one list rather than as a QR with a separate address bolted on.
  // Its value is supplied by the caller because it is read live from Settings on the
  // invoice (§8.4) and from the balance payload on the Balance Bill - two different
  // sources that happen to agree, and this component must not pretend otherwise.
  const rows = showBank ? bankRows.filter((row) => row.value) : []
  if (upiId) rows.push({ label: 'UPI ID', value: upiId })

  // Nothing to instruct anybody with: no rails, no method line. Rendering an empty
  // bordered card on a customer-facing document reads as a defect (§21.24).
  if (!showQr && rows.length === 0 && !methodLabel) return null

  return (
    <section className={styles.card} data-payment-card data-document-bank>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          <Icon name="wallet" size={15} strokeWidth={1.5} className={styles.icon} />
          <span>Payment Details</span>
        </h2>
        {/* Only when there is a code: a "Scan to pay" label beside an empty right-hand
            column points nowhere, which is the same defect as a caption over no QR. */}
        {showQr ? (
          <p className={styles.scanLabel}>
            <Icon name="qrCode" size={15} strokeWidth={1.5} className={styles.icon} />
            <span>Scan to Pay</span>
          </p>
        ) : null}
      </div>

      <div className={styles.body}>
        <div className={styles.details}>
          {methodLabel ? (
            <p className={styles.methodLine}>
              <strong>Payment Method: {methodLabel}</strong>
            </p>
          ) : null}

          {rows.length > 0 ? (
            <dl className={styles.rows}>
              {rows.map((row) => (
                <div key={row.label} className={styles.row}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {hint ? <p className={styles.hint}>{hint}</p> : null}
        </div>

        {showQr ? (
          <div className={styles.tile}>
            <UpiQrCard
              variant="tile"
              vpa={upiId}
              payeeName={payeeName}
              amountPaise={amountPaise}
              note={note}
              className={styles.qr}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
