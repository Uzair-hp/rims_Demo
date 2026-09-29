import { QuotationsPage, QuotationEditor } from '../features/quotations'

export default function Quotations() {
  return <QuotationsPage />
}

export function QuotationNew() {
  return <QuotationEditor mode="create" />
}
