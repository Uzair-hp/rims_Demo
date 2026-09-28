import PagePlaceholder from './PagePlaceholder.jsx'

export default function Quotations() {
  return (
    <PagePlaceholder
      title="Quotations"
      description="Every quotation with its status, total and next action, filterable by status and client."
      icon="fileText"
      emptyTitle="No quotations yet"
      emptyMessage="Quotations, filters and row actions arrive in Phase 2, together with the numbering and print layout."
      actionLabel="Start a quotation"
      actionTo="/quotations/new"
      actionIcon="plus"
    />
  )
}

export function QuotationNew() {
  return (
    <PagePlaceholder
      title="New quotation"
      description="Client, line items, tax and notes — then save as draft or send for approval."
      icon="plusCircle"
      emptyTitle="The quotation editor arrives in Phase 2"
      emptyMessage="This route is wired and reachable from the New button, the quotations list and the dashboard. Line item maths, client lookup and numbering are all Phase 2."
      actionLabel="Back to quotations"
      actionTo="/quotations"
      actionIcon="chevronLeft"
    />
  )
}
