/**
 * Re-render the caller when the theme changes, so the tokens are re-read.
 *
 * Reading a token on every render is only half the job. Recharts needs the colours
 * as props, so it cannot repaint itself when `data-theme` changes — and nothing
 * else re-renders the Dashboard on a theme switch, because the toggle lives in the
 * header. The charts therefore kept the colours of whichever theme was active the
 * last time something *else* happened to re-render them: switching light to dark
 * left the axis labels, grid and legend in the old theme until the reader changed
 * the date range, which is the first thing that forced a render.
 *
 * `useTheme` sets the attribute in an effect, so this watches the DOM rather than
 * the React state: one source of truth for "the theme changed", independent of
 * whether the change came from the toggle, the OS preference, or the pre-paint
 * script in `index.html`.
 */
export function useChartTheme() {
  const [, repaint] = useReducer((n) => n + 1, 0)

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(repaint)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
}

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
 * `useChartTheme` is what guarantees a render actually happens on a theme switch.
 *
 * The fallbacks are the §18.8 light-theme values, so a chart still renders if it
 * is ever drawn outside a document (no computed style to read).
 */

import { useEffect, useReducer } from 'react'

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
  '--color-surface': '#ffffff',
  '--color-border': '#e4e0d5',
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
 * Axis and tick-label text colour.
 *
 * Deliberately NOT `--chart-grid`. That token is the grid *line* colour, and the
 * two have opposite contrast requirements: a grid line should sit just off the
 * background, while tick text has to be readable. In dark mode `--chart-grid` is
 * `#353026` against the `#1c1915` card surface — about 1.5:1 — so using it as text
 * made the month labels and the `approved` / `rejected` status labels effectively
 * invisible. `--color-ink-muted` is `#b5afa2` in dark and `#57534a` in light, both
 * comfortably past 4.5:1, and it is the same token the surrounding CSS uses for
 * secondary text, so the charts now agree with the page around them.
 */
export const CHART_TICK = () => chartToken('--color-ink-muted')

/**
 * Tooltip styling, so the popup follows the theme too.
 *
 * Recharts ships a light-mode default (`#fff` background, `#333` text). Overridden
 * only for the properties, never for the whole component: left alone it rendered a
 * white box in dark mode, which is legible but reads as a foreign element against
 * the page.
 */
export function chartTooltipStyle() {
  return {
    backgroundColor: chartToken('--color-surface'),
    border: `1px solid ${chartToken('--color-border')}`,
    borderRadius: 8,
    color: chartToken('--color-ink'),
  }
}

/** Tooltip heading (the hovered month's label), a step below the values. */
export const CHART_TIP_LABEL = () => chartToken('--color-ink-subtle')

/** Tooltip values — the figures the reader is actually here for. */
export const CHART_TIP_ITEM = () => chartToken('--color-ink')

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
