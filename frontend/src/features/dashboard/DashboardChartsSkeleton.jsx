import Card from '../../components/ui/Card.jsx'
import styles from './DashboardSection.module.css'

/**
 * Placeholder for the chart section while its (lazily loaded) chunk is in
 * flight.
 *
 * It lives in its own module on purpose. It was originally exported from
 * `DashboardCharts.jsx` alongside the real charts, which meant importing the
 * skeleton pulled that module — and therefore Recharts — into the entry chunk and
 * silently undid the code split. Anything imported eagerly from the page must
 * not reach the charting code.
 *
 * The height matches `charts.module.css` so the swap cannot reflow the page.
 */
export default function DashboardChartsSkeleton() {
  return (
    <section className={styles.charts} aria-busy="true" aria-label="Charts, loading">
      <Card padding="md" className={styles.chartCard}>
        <div className={styles.placeholder} />
      </Card>
      <Card padding="md" className={styles.chartCard}>
        <div className={styles.placeholder} />
      </Card>
    </section>
  )
}
