/**
 * Chart colours, read from the §18.8 design tokens at render time.
 *
 * Recharts draws to SVG with attributes, not CSS, so it cannot consume
 * `var(--chart-1)` the way every other stylesheet in the project does. The
 * tokens are therefore read back out of the computed stylesheet and handed to
 * Recharts as props.
 *
 * Reading on each render rather than once at import is deliberate: the app has a
 * light/dark switch, and caching the values at module load would pin the charts
 * to whichever theme happened to be active when the bundle was first evaluated.
 *
 * The fallbacks are the §18.8 light-theme values, so a chart still renders if it
 * is ever drawn outside a document (no computed style to read).
 */

const FALLBACKS = {
  '--chart-1': '#1d1b16',
  '--chart-2': '#c9a24b',
  '--chart-3': '#79736a',
  '--chart-grid': '#e4e0d5',
  // The status colours the breakdown chart borrows from §18.5. Kept here too so
  // the chart still renders if it is ever drawn before the stylesheet loads.
  '--color-ink-muted': '#6b665d',
  '--color-info': '#3f6f8f',
  '--color-success': '#3f7d58',
  '--color-danger': '#a8443c',
  '--color-ink-subtle': '#79736a',
}

/** Read one token off the document root, with a literal fallback. */
export function chartToken(name) {
  if (typeof window === 'undefined' || !document?.documentElement) return FALLBACKS[name] || '#79736a'
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name)
  return (value || FALLBACKS[name] || '#79736a').trim()
}

/**
 * The three series colours, in §18.8 order: received (ink, the metric that
 * matters most), invoiced (gold), tertiary.
 */
export function chartSeries() {
  return [chartToken('--chart-1'), chartToken('--chart-2'), chartToken('--chart-3')]
}

export const CHART_GRID = () => chartToken('--chart-grid')
export const CHART_SERIES = () => chartSeries()

/**
 * Per-status bars for the breakdown chart.
 *
 * Reuses the §18.5 status colours already in the token sheet so "rejected" is
 * the same red here as it is on a quotation row, rather than a second opinion
 * invented for one chart. `converted` is amber, matching the badge decision
 * recorded in `StatusBadge.jsx`.
 *
 * Colour is never the only signal: the x-axis labels every status in full, so the
 * chart is readable without relying on hue (which is also §18.5's rule for
 * series that must not sit at equal brightness).
 */
export function quotationChartColours() {
  return {
    draft: chartToken('--color-ink-muted'),
    sent: chartToken('--color-info'),
    approved: chartToken('--color-success'),
    rejected: chartToken('--color-danger'),
    converted: chartToken('--color-warning'),
  }
}

export const QUOTATION_CHART_COLOURS = () => quotationChartColours()
