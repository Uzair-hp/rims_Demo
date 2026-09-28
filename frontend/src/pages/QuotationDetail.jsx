import { useParams } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Card from '../components/ui/Card.jsx'
import styles from './QuotationDetail.module.css'

/** Readable stub for the single-quotation route, used by /quotations/:id and the edit route. */
export default function QuotationDetail({ mode = 'view' }) {
  const { id } = useParams()
  const isEdit = mode === 'edit'

  return (
    <>
      <PageHeader
        eyebrow="Quotations"
        title={isEdit ? 'Edit quotation' : 'Quotation'}
        description={`Quotation #${id ?? '—'} resolves against the API in Phase 2. This route already owns its title, back link and print entry point.`}
        actions={
          <>
            <Button variant="ghost" size="sm" icon="chevronLeft" to="/quotations">
              Back
            </Button>
            {isEdit ? (
              <Button variant="primary" size="sm" icon="check">
                Save changes
              </Button>
            ) : (
              <>
                <Button variant="secondary" size="sm" icon="printer">
                  Print
                </Button>
                <Button variant="primary" size="sm" to={`/quotations/${id}/edit`}>
                  Edit
                </Button>
              </>
            )}
          </>
        }
      />

      <div className={styles.grid}>
        <Card className={styles.spanFull}>
          <h2 className={styles.cardTitle}>Line items</h2>
          <p className={styles.note}>
            The item table, totals and tax summary are Phase 2 work. Tokens for spacing, borders and
            typography are already in place, so the table inherits the shell&apos;s look without new values.
          </p>
        </Card>
        <Card>
          <h2 className={styles.cardTitle}>Client</h2>
          <p className={styles.note}>Picked in Phase 4 from the client list.</p>
        </Card>
        <Card>
          <h2 className={styles.cardTitle}>Status</h2>
          <p className={styles.note}>Draft, sent, accepted, expired — Phase 2.</p>
        </Card>
      </div>
    </>
  )
}
