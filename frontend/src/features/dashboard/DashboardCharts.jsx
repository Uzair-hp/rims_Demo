import Card from '../../components/ui/Card.jsx'
import { StatusBreakdownChart, TrendChart } from './charts.jsx'
import styles from './DashboardSection.module.css'

/**
 * The two FR-D3 charts, in their own module so it can be code-split.
 *
 * Recharts is by far the heaviest dependency in the app (~112 KB gzip) and is
 * used nowhere else. Bundling it into the entry chunk pushed the main JavaScript
 * from 138 KB to 252 KB gzip, which every route paid for — including `/login`,
 * which never renders a chart. `Dashboard.jsx` therefore `lazy()`-loads this
 * module so Recharts arrives as a separate chunk, fetched only when the Dashboard
 * is actually opened.
 *
 * The split is invisible to the reader: the tiles and recent lists render from
 * the single summary request immediately, and this section is replaced in place
 * by `DashboardChartsSkeleton` (a separate module, so importing the placeholder
 * does not defeat the split) while the chunk loads.
 *
 * `width`/`height` are forwarded so a renderer without a layout engine — the
 * test suite, and eventually a generated PDF — can draw the same charts at a
 * fixed size. The page itself does not pass them, so the charts are responsive.
 */
export default function DashboardCharts({ data, width, height }) {
  const chartSize = { width, height }
  return (
    <section className={styles.charts} aria-label="Trends">
      <Card padding="md" className={styles.chartCard}>
        <TrendChart monthly={data.monthly} {...chartSize} />
      </Card>
      <Card padding="md" className={styles.chartCard}>
        <StatusBreakdownChart counts={data.quotation_counts} {...chartSize} />
      </Card>
    </section>
  )
}
