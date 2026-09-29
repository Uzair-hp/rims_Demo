/**
 * Ruchita Interiors — invoice preview overlay (§14.2, FR-I6).
 *
 * The invoice sibling of `QuotationPreview`: same `DocumentPaper` in a Sheet, so
 * the preview and the printed invoice cannot drift apart.
 *
 * An invoice is never "unsaved" — it always exists on the server with a real
 * `INV-` number, because it can only be created by converting a quotation
 * (FR-I1). So unlike the quotation overlay there is no placeholder-number path
 * and no Save action here.
 */

import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Sheet from '../../components/ui/Sheet.jsx'
import DocumentPaper from './DocumentPaper.jsx'
import styles from './InvoicePreview.module.css'

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   document: object,
 *   settings?: object,
 *   logoSrc?: string | null,
 *   qrSrc?: string | null,
 * }} props
 */
export default function InvoicePreview({
  open,
  onClose,
  document: doc,
  settings = null,
  logoSrc = null,
  qrSrc = null,
}) {
  const navigate = useNavigate()

  return (
    <Sheet open={open} onClose={onClose} title="Invoice preview">
      <div className={styles.preview}>
        <div className={styles.sheetScroll}>
          <DocumentPaper
            document={doc}
            settings={settings}
            logoSrc={logoSrc}
            qrSrc={qrSrc}
            titleLevel="h2"
            docKind="invoice"
          />
        </div>

        <div className={`${styles.actions} no-print`}>
          <Button
            variant="primary"
            size="sm"
            icon="printer"
            onClick={() => window.open(`/print/invoice/${doc.id}?autoprint=1`, '_blank', 'noopener')}
          >
            Print
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="receipt"
            onClick={() => {
              onClose()
              navigate(`/invoices/${doc.id}`)
            }}
          >
            Back to invoice
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
