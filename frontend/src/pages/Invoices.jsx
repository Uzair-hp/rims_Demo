import PagePlaceholder from './PagePlaceholder.jsx'

export default function Invoices() {
  return (
    <PagePlaceholder
      title="Invoices"
      description="Invoice list with statuses, due dates and outstanding totals."
      icon="receipt"
      emptyTitle="Invoices arrive in Phase 7"
      emptyMessage="The navigation, titles, layout and empty state are live. Phase 7 brings the invoice API, conversion from quotations and the printable invoice."
      actionLabel="Back to dashboard"
      actionTo="/"
      actionIcon="chevronLeft"
    />
  )
}

export function InvoiceDetail() {
  return (
    <PagePlaceholder
      title="Invoice"
      description="Invoice # — client, line items, taxes, payments and due date."
      icon="receipt"
      emptyTitle="Invoice detail arrives in Phase 7"
      emptyMessage="Route is ready; actions such as Mark as paid and Print arrive with Phase 7."
      actionLabel="All invoices"
      actionTo="/invoices"
      actionIcon="chevronLeft"
    />
  )
}
