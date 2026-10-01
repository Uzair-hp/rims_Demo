/**
 * Ruchita Interiors — Balance / Payment Due document (§8.5).
 *
 * A **collection notice**, not a second invoice. The original invoice stays the only
 * billing document and the payment ledger stays the only record of money received;
 * this sheet re-states the original's figures and asks for the remainder. The server
 * derives every number from that ledger on each request, so nothing here is stored
 * and nothing can go stale.
 *
 * What makes it honest rather than a second sale:
 *
 * - **No document number of its own.** It is headed by the invoice it is about.
 *   `numbering.py` allocates per (doc_type, year); giving this a `PD-` prefix would
 *   need a new counter and would read as a second billing document, which is exactly
 *   the confusion a payment reminder must not create.
 * - **Every figure is the server's.** `outstanding_paise` and `paid_paise` arrive on
 *   the payload; nothing is recomputed here, so the amount on the paper is the
 *   amount the ledger reports (D2).
 * - **The QR encodes the outstanding balance**, not the invoice total, and it is
 *   built by the shared `PaymentDetailsCard` from the same `amountPaise` shown above
 *   it.
 * - **The amount is a snapshot.** Paper cannot be updated, so the sheet says
 *   "Verify the amount before paying." — a later payment will change the real
 *   balance, and the next generated document will show it.
 *
 * ## The fully-paid state
 *
 * When the ledger says the invoice is settled, the outstanding balance is ₹0 and there
 * is nothing to collect. This sheet then becomes a **statement of settlement** rather
 * than a demand, and it says so in the only terms a customer needs: a green FULLY PAID
 * stamp, the amount due reading ₹0.00, **no QR and no bank details**, and a footer
 * thanking them. Hiding the payment rails is the point — a scan-to-pay code on a
 * zero-balance document would invite a payment of nothing, and a customer seeing a
 * live QR beneath a "fully paid" stamp would reasonably distrust the stamp.
 *
 * It is derived from `fully_paid` on the payload (with the outstanding balance as a
 * fallback for an older server), never from a comparison made here, so the sheet can
 * never disagree with the ledger about whether an invoice is settled.
 *
 * It is presentational: it fetches nothing and holds no money state. The caller
 * passes the payload the API returned.
 *
 * @param {{
 *   doc: object,
 *   settings?: object,
 *   logoSrc?: string | null,
 *   titleLevel?: 1 | 2,
 * }} props
 */

import { formatDate } from '../../lib/format.js'
import { formatPaise } from '../../lib/money.js'
import { formatPhone } from '../../lib/phone.js'
import DocumentHeader from '../documents/DocumentHeader.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PaymentDetailsCard from '../payments/PaymentDetailsCard.jsx'
import styles from './PaymentDuePaper.module.css'

export default function PaymentDuePaper({ doc, settings = null, logoSrc = null, titleLevel: Title = 'h1' }) {
  const s = settings || {}
  const client = doc.client || {}
  const bank = doc.bank || {}

  // The server's own verdict. The fallback keeps an older payload honest rather than
  // throwing: an absent flag with a zero balance is the same state, and `?? 0` on the
  // balance means a missing field cannot masquerade as "still owed".
  const fullyPaid = doc.fully_paid ?? (doc.outstanding_paise ?? 0) <= 0

  const clientAddress = [client.address, client.city, client.state, client.pincode]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(', ')

  const bankRows = [
    bank.account_name && { label: 'Account Name', value: bank.account_name },
    bank.account_number && { label: 'Account Number', value: bank.account_number },
    bank.bank_name && { label: 'Bank', value: bank.bank_name },
    bank.branch && { label: 'Branch', value: bank.branch },
    bank.ifsc && { label: 'IFSC', value: bank.ifsc },
  ].filter(Boolean)

  // The one figure to print under the code and to encode in it. Zero when settled, and
  // `buildUpiUri` refuses a non-positive amount, so a fully-paid sheet cannot produce a
  // ₹0 code even if the card were somehow rendered.
  const amountDue = doc.amount_due_paise ?? doc.outstanding_paise ?? 0

  return (
    <article
      className={`${styles.paper} ${fullyPaid ? styles.paperSettled : ''}`}
      data-document-paper
      data-payment-due
      data-fully-paid={fullyPaid ? 'true' : 'false'}
    >
      <DocumentHeader settings={s} logoSrc={logoSrc} />

      <section className={styles.titleStrip}>
        <div className={styles.heading}>
          <Title className={styles.title}>{doc.title || 'PAYMENT DUE'}</Title>
          <p className={styles.headingNote}>
            <Icon name="calendar" size={15} strokeWidth={1.5} className={styles.labelIcon} />
            <span className={styles.microLabel}>Due date</span>
            <span className={styles.dateValue}>{formatDate(doc.due_date) || '—'}</span>
          </p>
        </div>
        <div className={styles.referenceBlock}>
          {/* The stamp sits above the reference it qualifies. It is a statement about
              that invoice, not a general banner, so it reads as bound to the number
              rather than floating over the sheet. */}
          {fullyPaid ? (
            <p className={styles.paidStamp} data-paid-stamp="true">
              Fully Paid
            </p>
          ) : null}
          <p className={styles.reference}>
            <span className={styles.referenceLabel}>Reference</span>
            <span className={styles.referenceValue}>{doc.source_invoice_number}</span>
          </p>
        </div>
      </section>

      {/* Bill To on the left, Project / Site Address on the right — two equal columns,
          the same shape as the Tax Invoice so the two sheets read as one system. */}
      <section className={styles.clientBlock}>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>
            <Icon name="user" size={15} strokeWidth={1.5} className={styles.labelIcon} />
            <span>Bill To</span>
          </h2>
          <p className={styles.clientName}>{client.name || '—'}</p>
          {clientAddress ? (
            <p className={styles.clientLine}>
              <Icon name="mapPin" size={14} strokeWidth={1.5} className={styles.inlineIcon} />
              <span>{clientAddress}</span>
            </p>
          ) : null}
          {client.phone ? (
            <p className={styles.clientLine}>
              <Icon name="phone" size={14} strokeWidth={1.5} className={styles.inlineIcon} />
              <span>{formatPhone(client.phone)}</span>
            </p>
          ) : null}
          {client.email ? (
            <p className={styles.clientLine}>
              <Icon name="mail" size={14} strokeWidth={1.5} className={styles.inlineIcon} />
              <span>{client.email}</span>
            </p>
          ) : null}
          {client.gstin ? (
            <p className={styles.clientLine}>
              <Icon name="badgeCheck" size={14} strokeWidth={1.5} className={styles.inlineIcon} />
              <span>GSTIN: {client.gstin}</span>
            </p>
          ) : null}
        </div>
        <div className={styles.clientCell}>
          <h2 className={styles.blockLabel}>
            <Icon name="mapPin" size={15} strokeWidth={1.5} className={styles.labelIcon} />
            <span>Project / Site Address</span>
          </h2>
          {client.project_address ? (
            <p className={styles.clientLine}>
              <Icon name="mapPin" size={14} strokeWidth={1.5} className={styles.inlineIcon} />
              <span>{client.project_address}</span>
            </p>
          ) : (
            <p className={styles.clientLine}>—</p>
          )}
        </div>
      </section>

      {/* The reconciliation: original total, money received, and what is left. The
          order is fixed and reads as arithmetic, so a customer can check it. */}
      <section className={styles.summary} data-document-totals>
        <h2 className={styles.blockLabel}>
          <Icon name="wallet" size={15} strokeWidth={1.5} className={styles.labelIcon} />
          <span>Balance Summary</span>
        </h2>
        <dl className={styles.summaryRows}>
          <div className={styles.summaryRow}>
            <dt>Original invoice total</dt>
            <dd>{formatPaise(doc.grand_total_paise)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Total received</dt>
            <dd>{formatPaise(doc.paid_paise)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Outstanding balance</dt>
            <dd className={fullyPaid ? styles.summarySettled : null}>{formatPaise(doc.outstanding_paise)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Amount due now</dt>
            <dd className={fullyPaid ? styles.summaryDueSettled : styles.summaryDue}>
              {formatPaise(amountDue)}
            </dd>
          </div>
        </dl>
      </section>

      {/* The amount-bearing code lives **here** and not on the original invoice. This
          document is the collection notice: its whole purpose is to ask for what is
          still owed, so an `am` that tracks the live outstanding is exactly right — and
          because the document is derived rather than stored, the next one reflects
          whatever the ledger says by then.

          It is the same `PaymentDetailsCard` the Tax Invoice prints, so bank details
          appear once per document, in one consistent layout, rather than as a QR beside
          a separate block. Hidden entirely when settled: there is nothing left to
          instruct anyone about. */}
      {/*
          No `hint` here, unlike the invoice's card. This sheet already carries
          "Verify the amount before paying." in its footer, and passing the same
          sentence into the card as well printed it twice on one page — which is the
          duplication this card exists to remove. */}
      {fullyPaid ? null : (
        <section className={styles.paymentSection} data-document-payment>
          <PaymentDetailsCard
            bankRows={bankRows}
            upiId={doc.upi_id}
            showBank={bankRows.length > 0 || Boolean(doc.upi_id)}
            showQr={Boolean(doc.upi_id)}
            amountPaise={amountDue}
            payeeName={doc.payee_name}
            note={doc.source_invoice_number}
          />
        </section>
      )}

      <footer className={styles.footer}>
        {fullyPaid ? (
          <>
            <p className={styles.thanks} data-settled-footer="true">
              Payment received in full. Thank you.
            </p>
            <p className={styles.generated}>
              Generated {formatDate(doc.generated_on)}
              {doc.due_date ? ` · Invoice ${doc.source_invoice_number}` : ''}
            </p>
          </>
        ) : (
          <>
            <p className={styles.generated}>
              Generated {formatDate(doc.generated_on)}
              {doc.due_date ? ` · Due ${formatDate(doc.due_date)}` : ''}
            </p>
            <p className={styles.disclaimer}>
              This is a payment reminder for invoice {doc.source_invoice_number}, not a new invoice. The
              balance shown is what the ledger recorded as outstanding when this document was generated.
            </p>
            <p className={styles.notice}>Verify the amount before paying.</p>
          </>
        )}
        {s.signatory_name ? <p className={styles.signatory}>{s.signatory_name}</p> : null}
        {s.footer_text ? <p className={styles.footerText}>{s.footer_text}</p> : null}
      </footer>
    </article>
  )
}
