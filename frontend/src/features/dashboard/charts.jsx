import {
  ResponsiveContainer,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatPaise } from '../../lib/money.js'
import { CHART_GRID, QUOTATION_CHART_COLOURS, chartSeries } from './chartTheme.js'
import styles from './charts.module.css'

/**
 * Dashboard charts (FR-D3, §18.8, §18.10).
 *
 * Recharts draws to SVG attributes, so it cannot consume `var(--chart-1)` the way
 * every other stylesheet here does; the tokens are read back out of the computed
 * stylesheet by `chartTheme.js` and handed in as props.
 *
 * **Axes are hidden on purpose.** §18.8 requires magnitude by position and label
 * rather than by hue, and the metric tiles already state the exact figure. A
 * twelve-point axis down each side of every chart would be noise. The tooltip
 * carries the numbers.
 *
 * **`width`/`height` exist for renderers without a layout engine.** By default
 * the charts are responsive, which is right in a browser. Recharts' own
 * `ResponsiveContainer` measures its parent, and there is no layout engine in
 * jsdom, so under test — and anywhere else the chart is drawn into a fixed-size
 * surface such as a generated PDF — passing explicit dimensions bypasses the
 * measurement entirely. That is the only difference; the chart itself is
 * identical either way.
 */

const HEIGHT = '100%'

/** Shared axis/tooltip chrome. `money` axes are labelled in short rupees (§18.8). */
function chrome(money = false) {
  return {
    stroke: CHART_GRID(),
    tick: { fill: CHART_GRID(), fontSize: 11 },
    tickLine: false,
    axisLine: false,
    tickFormatter: money ? (value) => shortRupees(value * 100) : undefined,
  }
}

/** `₹1.2L` / `₹40.5K` — Indian short units, so a 12-point axis stays legible. */
export function shortRupees(paise) {
  const rupees = Math.round((paise || 0) / 100)
  const abs = Math.abs(rupees)
  if (abs >= 10000000) return `₹${(rupees / 10000000).toFixed(abs >= 100000000 ? 0 : 1)}Cr`
  if (abs >= 100000) return `₹${(rupees / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`
  if (abs >= 1000) return `₹${(rupees / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`
  return `₹${rupees}`
}

/** `2026-04` -> `Apr`, which is what a 12-bucket axis has room for. */
function monthLabel(key) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = Number(key?.slice(5, 7))
  return months[month - 1] || key
}

/**
 * Wrap chart content responsively, or at an explicit size when one is given.
 *
 * Returns the element to render; the caller supplies the <svg>-producing chart.
 */
function sized(content, { width, height }) {
  if (typeof width === 'number' && typeof height === 'number') return content(width, height)
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      {content('100%', HEIGHT)}
    </ResponsiveContainer>
  )
}

/**
 * The 12-month invoiced-vs-received trend (FR-D3).
 *
 * Two series, not more (§18.8 caps a chart at three): invoiced is what was
 * billed, received is what actually came in, and the gap between them is the
 * whole point — so they share an axis and the difference is legible.
 *
 * Values are converted from paise to rupees here, which is a unit change and not
 * a re-computation: no total is derived, and the paise figures on the tiles
 * remain the authority.
 */
export function TrendChart({ monthly, width, height }) {
  // Tokens are read per render so a theme switch repaints the charts (§18.8).
  const series = chartSeries()
  const grid = CHART_GRID()
  const data = (monthly || []).map((row) => ({
    month: monthLabel(row.month),
    invoiced: (row.invoiced_value || 0) / 100,
    received: (row.received_value || 0) / 100,
  }))

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Invoiced vs received <span className={styles.captionHint}>last 12 months</span>
      </figcaption>
      <div className={styles.plot} data-chart="trend">
        {sized(
          (w, h) => (
            <LineChart width={w} height={h} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="month" {...chrome(false)} />
              <YAxis {...chrome(true)} width={44} />
              <Tooltip
                formatter={(value, name) => [formatPaise(Math.round(value * 100)), name]}
                contentStyle={{ borderRadius: 8, border: `1px solid ${grid}` }}
              />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="invoiced"
                name="Invoiced"
                stroke={series[1]}
                strokeWidth={2}
                dot={false}
                /* §18.10: "no entrance animations on data". Recharts animates
                   series in by default, so the shape is absent until the
                   animation settles. */
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="received"
                name="Received"
                stroke={series[0]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          ),
          { width, height },
        )}
      </div>
    </figure>
  )
}

/**
 * Quotation status breakdown (FR-D3).
 *
 * One bar per status. A status with no rows still gets a bar of zero height and
 * stays on the axis: a status that silently vanished from the chart would be a
 * worse lie than a flat one.
 */
export function StatusBreakdownChart({ counts, width, height }) {
  const grid = CHART_GRID()
  const colours = QUOTATION_CHART_COLOURS()
  const data = Object.entries(counts || {}).map(([status, count]) => ({ status, count: count || 0 }))

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Quotations by status <span className={styles.captionHint}>all quotations</span>
      </figcaption>
      <div className={styles.plot} data-chart="status-breakdown">
        {sized(
          (w, h) => (
            <BarChart width={w} height={h} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="status" {...chrome(false)} />
              <YAxis {...chrome(false)} width={28} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [value, 'Quotations']}
                contentStyle={{ borderRadius: 8, border: `1px solid ${grid}` }}
              />
              <Bar dataKey="count" name="Quotations" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((row) => (
                  <Cell key={row.status} fill={colours[row.status] || series3()} />
                ))}
              </Bar>
            </BarChart>
          ),
          { width, height },
        )}
      </div>
    </figure>
  )
}

/** Tertiary series colour, for a status with no token of its own. */
function series3() {
  return chartSeries()[2]
}
