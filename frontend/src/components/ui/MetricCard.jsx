import Card from './Card.jsx'
import styles from './MetricCard.module.css'

/**
 * A dashboard metric tile (§18.11 "MetricCard").
 *
 * Built on `Card` rather than re-declaring a surface, so the Dashboard's tiles
 * are the same border / radius / shadow as every other card in the system
 * (§18.3 "one card treatment").
 *
 * Three rules it exists to enforce:
 *
 * - **The value is passed in already computed.** This component formats with the
 *   shared `formatPaise` used by every other money surface and does nothing
 *   else. The Dashboard's figures arrive computed from `GET /dashboard/summary`,
 *   so there is exactly one implementation of the money rules and it is on the
 *   server (§11).
 * - **Money is tabular** (§18.9), so a row of tiles stays aligned and a changing
 *   figure does not make the tiles jitter.
 * - **`tone` is semantic, not decorative.** `due` marks money the business is
 *   owed; it is not a way to make a neutral figure stand out.
 *
 * @param {{
 *   label: string,
 *   value: string,
 *   hint?: string,
 *   tone?: 'default' | 'due' | 'positive',
 * }} props
 */
export default function MetricCard({ label, value, hint, tone = 'default' }) {
  return (
    <Card
      padding="md"
      className={[styles.card, tone !== 'default' ? styles[tone] : ''].filter(Boolean).join(' ')}
      data-metric={label}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </Card>
  )
}
