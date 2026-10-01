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
 *   built by the shared `UpiQrCard` from the same `amountPaise` shown above it.
 * - **The amount is a snapshot.** Paper cannot be updated, so the sheet says
 *   "Verify the amount before paying." — a later payment will change the real
 *   balance, and the next generated document will show it.
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
import UpiQrCard from '../payments/UpiQrCard.jsx'
import styles from './PaymentDuePaper.module.css'

export default function PaymentDuePaper({ doc, settings = null, logoSrc = null, titleLevel: Title = 'h1' }) {
  const s = settings || {}
  const client = doc.client || {}
  const bank = doc.bank || {}

  const bankLines = [
    bank.account_name && { label: 'Account name', value: bank.account_name },
    bank.account_number && { label: 'Account number', value: bank.account_number },
    bank.bank_name && { label: 'Bank', value: bank.bank_name },
    bank.branch && { label: 'Branch', value: bank.branch },
    bank.ifsc && { label: 'IFSC', value: bank.ifsc },
  ].filter(Boolean)

  return (
    <article className={styles.paper} data-document-paper data-payment-due>
      <header className={styles.header}>
        {logoSrc ? <img className={styles.logo} src={logoSrc} alt="" /> : null}
        <div className={styles.headerText}>
          <p className={styles.companyName}>{s.company_name || 'Ruchita Interiors'}</p>
          {s.address_line1 || s.city ? (
            <p className={styles.companyAddress}>
              {[s.address_line1, s.city, s.state, s.pincode].filter(Boolean).join(', ')}
            </p>
          ) : null}
          {s.phone ? <p className={styles.companyMeta}>{s.phone}</p> : null}
        </div>
      </header>

      <section className={styles.titleStrip}>
        <Title className={styles.title}>{doc.title || 'PAYMENT DUE'}</Title>
        <p className={styles.reference}>
          <span className={styles.referenceLabel}>Reference</span>
          <span className={styles.referenceValue}>{doc.source_invoice_number}</span>
        </p>
      </section>

      {client.name ? (
        <section className={styles.clientBlock}>
          <h2 className={styles.blockLabel}>Billed to</h2>
          <p className={styles.clientName}>{client.name}</p>
          {client.address || client.city ? (
            <p className={styles.clientAddress}>
              {[client.address, client.city, client.state, client.pincode].filter(Boolean).join(', ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* The reconciliation: original total, money received, and what is left. The
          order is fixed and reads as arithmetic, so a customer can check it. */}
      <section className={styles.summary} data-document-totals>
        <h2 className={styles.blockLabel}>Balance summary</h2>
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
            <dd>{formatPaise(doc.outstanding_paise)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Amount due now</dt>
            <dd className={styles.summaryDue}>{formatPaise(doc.amount_due_paise)}</dd>
          </div>
        </dl>
      </section>

      {/* The amount-bearing code lives **here** and not on the original invoice.
          This document is the collection notice: its whole purpose is to ask for
          what is still owed, so an `am` that tracks the live outstanding is exactly
          right — and because the document is derived rather than stored, the next
          one reflects whatever the ledger says by then.
          `variant="print"` keeps it compact and drops the screen chrome; the rules
          are in `UpiQrCard.module.css` because a parent's `.qrCard .actions` cannot
          reach across a CSS Modules boundary. */}
      {doc.upi_id ? (
        <UpiQrCard
          amountPaise={doc.amount_due_paise}
          vpa={doc.upi_id}
          payeeName={doc.payee_name}
          note={doc.source_invoice_number}
          title="Scan to pay the balance"
          variant="print"
          className={styles.qrCard}
        />
      ) : null}

      {/* Bank details are an alternative to the QR, not a second demand, so the
          heading says so — a customer who prefers a transfer should not read this
          as an additional amount owed. */}
      {bankLines.length > 0 ? (
        <section className={styles.bank} data-document-bank>
          <h2 className={styles.blockLabel}>Or pay by bank transfer</h2>
          <dl className={styles.bankRows}>
            {bankLines.map((line) => (
              <div key={line.label} className={styles.bankRow}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
            {bank.upi_id ? (
              <div className={styles.bankRow}>
                <dt>UPI ID</dt>
                <dd>{bank.upi_id}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <p className={styles.generated}>
          Generated {formatDate(doc.generated_on)}
          {doc.due_date ? ` · Due ${formatDate(doc.due_date)}` : ''}
        </p>
        <p className={styles.disclaimer}>
          This is a payment reminder for invoice {doc.source_invoice_number}, not a new invoice. The balance
          shown is what the ledger recorded as outstanding when this document was generated.
        </p>
        <p className={styles.notice}>Verify the amount before paying.</p>
        {s.signatory_name ? <p className={styles.signatory}>{s.signatory_name}</p> : null}
        {s.footer_text ? <p className={styles.footerText}>{s.footer_text}</p> : null}
      </footer>
    </article>
  )
}
