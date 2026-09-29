import { lazy, Suspense } from 'react'
import Button from '../components/ui/Button.jsx'
import Card from '../components/ui/Card.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import MetricCard from '../components/ui/MetricCard.jsx'
import PageHeader from '../components/ui/PageHeader.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import DashboardChartsSkeleton from '../features/dashboard/DashboardChartsSkeleton.jsx'
import RecentList from '../features/dashboard/RecentList.jsx'
import { useDashboard } from '../features/dashboard/useDashboard.js'
import { formatPaise } from '../lib/money.js'
import styles from './Dashboard.module.css'

/**
 * Recharts lives only in the charts section, and it is the single heaviest
 * dependency in the app. Loading it lazily keeps it out of the entry chunk, so
 * the routes that never draw a chart — `/login` most of all — do not pay for it.
 * The summary request and everything below the charts render without waiting.
 */
const DashboardCharts = lazy(() => import('../features/dashboard/DashboardCharts.jsx'))

/**
 * Dashboard — truthful business overview (§4.6, §9.2, §23).
 *
 * The single `<h1>` is `PageHeader`'s "Dashboard". Every other heading on the
 * page is an `<h2>` belonging to a section (§18.2), and the page keeps exactly
 * one at every viewport, including the loading and error states.
 *
 * **One request, one truth.** Everything below comes from a single
 * `GET /dashboard/summary` (§9.2). The page adds up nothing: the tiles render
 * `money.invoiced_value` and friends exactly as the server computed them, and the
 * only arithmetic anywhere is `shortRupees` shortening a figure for a chart axis
 * — a unit change, not a total. If this page re-derived the money it would be a
 * second implementation of §11, which is precisely what §11's "computed, never
 * stored" rule forbids.
 *
 * The FR-D1 metrics are grouped rather than flattened into one long strip:
 * quotation counts, the money trio, then the charts and recent activity. FR-D1
 * asks for counts by status, total quotation value, approved value, invoiced,
 * received and outstanding — all six are present as tiles.
 */

/** Tiles shown while loading, matching the real layout so nothing shifts. */
const SKELETON_TILES = [
  'Quotations',
  'Quotation value',
  'Approved value',
  'Invoiced',
  'Received',
  'Outstanding',
]

function Tiles({ data }) {
  const { quotation_counts: counts, quotation_values: values, money } = data

  return (
    <>
      <section className={styles.tiles} aria-label="Quotation position">
        <MetricCard
          label="Quotations"
          value={String(Object.values(counts).reduce((a, b) => a + b, 0))}
          hint={`${counts.approved} approved · ${counts.sent} awaiting reply`}
        />
        <MetricCard
          label="Quotation value"
          value={formatPaise(values.total_quotation_value)}
          hint="all quotations, any status"
        />
        <MetricCard
          label="Approved value"
          value={formatPaise(values.approved_value)}
          hint={`${counts.approved} approved`}
        />
      </section>

      {/* The money trio. `due` marks money the business is owed, so outstanding
          is the only toned tile here — invoiced and received are neutral. */}
      <section className={styles.tiles} aria-label="Money position">
        <MetricCard label="Invoiced" value={formatPaise(money.invoiced_value)} hint="issued invoices only" />
        <MetricCard
          label="Received"
          value={formatPaise(money.received_total)}
          hint="from recorded payments"
        />
        <MetricCard
          label="Outstanding"
          value={formatPaise(money.outstanding_total)}
          tone={money.outstanding_total > 0 ? 'due' : 'positive'}
          hint="invoiced less received"
        />
      </section>
    </>
  )
}

function Recent({ data }) {
  return (
    <section className={styles.recent} aria-label="Recent activity">
      <Card padding="md" className={styles.recentCard}>
        <RecentList kind="quotations" title="Recent quotations" rows={data.recent.quotations} />
      </Card>
      <Card padding="md" className={styles.recentCard}>
        <RecentList kind="invoices" title="Recent invoices" rows={data.recent.invoices} />
      </Card>
      <Card padding="md" className={styles.recentCard}>
        <RecentList kind="clients" title="Recent clients" rows={data.recent.clients} />
      </Card>
    </section>
  )
}

export default function Dashboard() {
  const { data, loadState, error, retry } = useDashboard()

  return (
    <>
      <PageHeader
        eyebrow="Ruchita Interiors"
        title="Dashboard"
        description="Where the business stands right now: what is quoted, what is billed, and what is still owed."
        actions={
          <Button variant="primary" icon="plus" to="/quotations/new" size="sm">
            New quotation
          </Button>
        }
      />

      {loadState === 'loading' ? (
        /* §20: skeletons for a page load, never a spinner for a list. */
        <div className={styles.tiles} aria-busy="true" aria-label="Summary totals, loading">
          {SKELETON_TILES.map((label) => (
            <Card key={label} padding="md">
              <Skeleton height="0.75rem" width="60%" />
              <Skeleton height="1.75rem" width="45%" />
              <Skeleton height="0.75rem" width="80%" />
            </Card>
          ))}
        </div>
      ) : null}

      {loadState === 'error' ? (
        /*
         * The message distinguishes the two failures a reader can act on
         * differently. A 5xx means the API is running and the request failed, so
         * "the server did not answer" would send them in the wrong direction —
         * the same class of misdirection a pending migration caused once already.
         */
        <EmptyState
          icon="alert"
          tone="muted"
          title="Dashboard could not be loaded"
          message={
            error?.offline
              ? 'You appear to be offline. The Dashboard needs a connection.'
              : Number(error?.status) >= 500
                ? 'The server returned an error. It is running, but the request failed — try again.'
                : (error?.message ?? 'The Dashboard could not be loaded.')
          }
          actionLabel="Try again"
          actionIcon="chevronRight"
          onAction={retry}
        />
      ) : null}

      {loadState === 'ready' && data ? (
        data.recent.quotations.length === 0 &&
        data.recent.invoices.length === 0 &&
        data.recent.clients.length === 0 ? (
          /* §20: an empty business gets a CTA, not six zeroes and three blank
             panels. A fresh install should read as "start here". */
          <EmptyState
            icon="fileText"
            title="Nothing here yet"
            message="Create your first client and quotation, and this page will fill with the business position."
            actionLabel="New quotation"
            actionTo="/quotations/new"
            actionIcon="chevronRight"
          />
        ) : (
          <>
            <Tiles data={data} />
            <Suspense fallback={<DashboardChartsSkeleton />}>
              <DashboardCharts data={data} />
            </Suspense>
            <Recent data={data} />
          </>
        )
      ) : null}
    </>
  )
}
