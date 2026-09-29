import { useParams } from 'react-router-dom'
import { QuotationDetailPage, QuotationEditor } from '../features/quotations'

/** Single-quotation route: read-only detail, or the editor in edit mode. */
export default function QuotationDetail({ mode = 'view' }) {
  const { id } = useParams()
  if (mode === 'edit') {
    return <QuotationEditor mode="edit" quotationId={id} />
  }
  return <QuotationDetailPage />
}
