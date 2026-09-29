/**
 * Ruchita Interiors — quotation preview overlay (§14.2, FR-DOC1).
 *
 * Hosts the real `DocumentPaper` in a Sheet, so the preview is the same component
 * the print route renders — there is no second document implementation to drift.
 *
 * Deliberately NOT the print route in a hidden iframe or a second route: the
 * sheet renders the sheet in place, and the Print action hands off to
 * `/print/quotation/:id` (opened in a new tab) when the quotation is saved.
 *
 * **Unsaved quotations render honestly.** A quotation that has never been sent
 * to the server has no number — the server is the sole authority for numbering
 * (§12), so the overlay shows a "not yet saved" placeholder rather than a
 * fabricated one, and the toolbar says so. Nothing here writes to the server;
 * saving stays an explicit action the user takes.
 */

import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Sheet from '../../components/ui/Sheet.jsx'
import DocumentPaper from './DocumentPaper.jsx'
import styles from './QuotationPreview.module.css'

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   document: object,
 *   settings?: object,
 *   logoSrc?: string | null,
 *   isUnsaved?: boolean,
 *   onSave?: () => void,
 *   saving?: boolean,
 * }} props
 */
export default function QuotationPreview({
  open,
  onClose,
  document: doc,
  settings = null,
  logoSrc = null,
  isUnsaved = false,
  onSave,
  saving = false,
}) {
  const navigate = useNavigate()

  const canPrint = !isUnsaved && Boolean(doc?.id)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quotation preview"
      description={isUnsaved ? 'Not saved yet — this preview cannot be shared until you save.' : undefined}
    >
      <div className={styles.preview}>
        {/*
          The sheet is a scrollable overlay, not paper, so the preview never
          prints. The class is belt-and-braces with the route's own behaviour:
          closing the overlay is what removes it, and printing is a separate,
          explicit action.
        */}
        <div className={styles.notice} role="status">
          {isUnsaved
            ? 'This quotation has not been saved yet, so it has no number and exists only in this browser session. Save it to get a real number before printing or sharing.'
            : 'Check the details below, then print or save as PDF.'}
        </div>

        <div className={styles.sheetScroll}>
          <DocumentPaper
            document={doc}
            settings={settings}
            logoSrc={logoSrc}
            titleLevel="h2"
            isUnsaved={isUnsaved}
          />
        </div>

        <div className={`${styles.actions} no-print`}>
          {isUnsaved && onSave ? (
            <Button variant="primary" size="sm" icon="check" loading={saving} onClick={onSave}>
              Save draft
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            icon="printer"
            disabled={!canPrint}
            title={canPrint ? undefined : 'Save the quotation first'}
            onClick={() => {
              if (!canPrint) return
              window.open(`/print/quotation/${doc.id}?autoprint=1`, '_blank', 'noopener')
            }}
          >
            Print
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="fileText"
            onClick={() => {
              onClose()
              navigate(`/quotations/${doc.id}`)
            }}
          >
            Back to quotation
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
