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
import {
  CHART_GRID,
  CHART_TICK,
  CHART_TIP_ITEM,
  CHART_TIP_LABEL,
  QUOTATION_CHART_COLOURS,
  chartSeries,
  chartTooltipStyle,
  useChartTheme,
} from './chartTheme.js'
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

/**
 * Shared axis/tooltip chrome. `money` axes are labelled in short rupees (§18.8).
 *
 * `stroke` and `tick.fill` are separate tokens on purpose. The stroke is the grid
 * line and wants to sit just off the background; the tick is text and has to be
 * readable. Sharing `--chart-grid` between them is what made every axis label
 * illegible in dark mode — see `CHART_TICK`.
 *
 * Exported so the tick/stroke separation can be asserted directly. It cannot be
 * tested through the DOM: Recharts emits its tick labels as *empty* `<g>` elements
 * under jsdom (no `<text>` child at all), so a rendered chart shows nothing to
 * check. Asserting on this prop is what actually pins the bug.
 */
export function chrome(money = false) {
  return {
    stroke: CHART_GRID(),
    tick: { fill: CHART_TICK(), fontSize: 11 },
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
 * Range options for the trend chart.
 *
 * `null` is the 12-month view — the default, and the one the Dashboard opened on
 * before this control existed. The numeric options slice the `daily` series the
 * server already returned; no option triggers a refetch, so the page keeps its
 * single request (§9.2).
 */
export const RANGE_OPTIONS = [
  { value: null, label: '12 months' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

/** `2026-04-18` -> `18 Apr`, dropping the year: every day shown is the last 30. */
function dayLabel(key) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = Number(key?.slice(5, 7))
  return `${Number(key?.slice(8, 10))} ${months[month - 1] || ''}`.trim()
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
 * Range selector for the trend chart.
 *
 * A radio group, not a set of toggle buttons: exactly one range is active, and
 * native radios give arrow-key movement and a single tab stop for free. A plain
 * button per option would need `aria-pressed` bookkeeping to say the same thing.
 *
 * It is labelled as a group so a screen reader announces "trend range" before
 * the options, rather than three unlabelled radios.
 */
function RangeFilter({ value, onChange }) {
  return (
    <div className={styles.range} role="radiogroup" aria-label="Trend range">
      {RANGE_OPTIONS.map((option) => {
        const id = `range-${option.value ?? 'all'}`
        return (
          <label key={id} className={styles.rangeOption} htmlFor={id}>
            <input
              id={id}
              type="radio"
              name="dashboard-trend-range"
              className={styles.rangeInput}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

/**
 * The invoiced-vs-received trend (FR-D3).
 *
 * Two series, not more (§18.8 caps a chart at three): invoiced is what was
 * billed, received is what actually came in, and the gap between them is the
 * whole point — so they share an axis and the difference is legible.
 *
 * **Range.** The default is the 12-month `monthly` series. Choosing 7, 14 or 30
 * days slices the `daily` series the same request already returned, so the chart
 * is measured rather than approximated and nothing is refetched. Switching back
 * to 12 months restores the original view exactly.
 *
 * Values are converted from paise to rupees here, which is a unit change and not
 * a re-computation: no total is derived, and the paise figures on the tiles
 * remain the authority.
 */
export function TrendChart({ monthly, daily, range = null, onRangeChange, width, height }) {
  // Re-render on a theme switch, then read the tokens — Recharts needs them as
  // props, so it cannot follow `data-theme` on its own (§18.8).
  useChartTheme()
  const series = chartSeries()
  const grid = CHART_GRID()

  const isDaily = typeof range === 'number'
  const source = isDaily ? (daily || []).slice(-range) : monthly || []
  const data = source.map((row) => ({
    label: isDaily ? dayLabel(row.date) : monthLabel(row.month),
    invoiced: (row.invoiced_value || 0) / 100,
    received: (row.received_value || 0) / 100,
  }))

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Invoiced vs received
        <span className={styles.captionHint}>{isDaily ? `last ${range} days` : 'last 12 months'}</span>
      </figcaption>

      {onRangeChange ? <RangeFilter value={range} onChange={onRangeChange} /> : null}

      <div className={styles.plot} data-chart="trend" data-range={isDaily ? `${range}d` : '12m'}>
        {sized(
          (w, h) => (
            <LineChart width={w} height={h} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="label" {...chrome(false)} interval="preserveStartEnd" />
              <YAxis {...chrome(true)} width={44} />
              <Tooltip
                formatter={(value, name) => [formatPaise(Math.round(value * 100)), name]}
                contentStyle={chartTooltipStyle()}
                labelStyle={{ fill: CHART_TIP_LABEL() }}
                itemStyle={{ color: CHART_TIP_ITEM() }}
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
  useChartTheme()
  const grid = CHART_GRID()
  const colours = QUOTATION_CHART_COLOURS()
  const data = Object.entries(counts || {}).map(([status, count]) => ({ status, count: count || 0 }))

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Quotations by status <span className={styles.captionHint}>all quotations</span>
      </figcaption>

      {/* Holds the plot on the same line as the trend chart's, which has the
          range filter in this row. Without it the bar chart rides higher. */}
      <div className={styles.rangeSpacer} aria-hidden="true" />

      <div className={styles.plot} data-chart="status-breakdown">
        {sized(
          (w, h) => (
            <BarChart width={w} height={h} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="status" {...chrome(false)} />
              <YAxis {...chrome(false)} width={28} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [value, 'Quotations']}
                contentStyle={chartTooltipStyle()}
                labelStyle={{ fill: CHART_TIP_LABEL() }}
                itemStyle={{ color: CHART_TIP_ITEM() }}
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
