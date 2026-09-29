import { InvoiceDetailPage, InvoicesPage } from '../features/invoices'

/** Invoices list, and the single-invoice route. Both wired to the real feature. */
export default function Invoices() {
  return <InvoicesPage />
}

export function InvoiceDetail() {
  return <InvoiceDetailPage />
}
