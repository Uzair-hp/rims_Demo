import PageHeader from '../components/ui/PageHeader.jsx'
import Button from '../components/ui/Button.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import Card from '../components/ui/Card.jsx'
import styles from './Dashboard.module.css'

/** Stat tiles planned for §18.4, shown as skeletons until Phase 2 supplies data. */
const TILES = [
  { label: 'Draft quotations', icon: 'fileText' },
  { label: 'Sent, awaiting reply', icon: 'clock' },
  { label: 'Outstanding invoices', icon: 'receipt' },
  { label: 'Overdue', icon: 'alert' },
]

export default function Dashboard() {
  return (
    <>
      <PageHeader
        eyebrow="Ruchita Interiors"
        title="Dashboard"
        description="Quotations, invoices and clients in one place. Totals appear once Phase 2 lands the quotation API."
        actions={
          <>
            <Button variant="secondary" icon="download" size="sm">
              Export
            </Button>
            <Button variant="primary" icon="plus" to="/quotations/new" size="sm">
              New quotation
            </Button>
          </>
        }
      />

      <div className={styles.tiles} aria-busy="true" aria-label="Summary totals, loading">
        {TILES.map((tile) => (
          <Card key={tile.label} className={styles.tile}>
            <Skeleton height="0.75rem" width="60%" />
            <Skeleton height="1.75rem" width="45%" className={styles.tileValue} />
            <Skeleton height="0.75rem" width="80%" />
          </Card>
        ))}
      </div>

      <section className={styles.section} aria-labelledby="recent-heading">
        <div className={styles.sectionHead}>
          <h2 id="recent-heading" className={styles.sectionTitle}>
            Recent activity
          </h2>
          <Button variant="ghost" size="sm" iconRight="chevronRight" to="/quotations">
            All quotations
          </Button>
        </div>
        <p className={styles.sectionNote}>
          Phase 1 ships the shell, tokens and routing only, so this panel stays empty on purpose. The list,
          filters and row actions are built in Phase 2 against the same tokens used here.
        </p>
      </section>
    </>
  )
}
