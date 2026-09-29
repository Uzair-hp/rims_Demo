/**
 * Ruchita Interiors — totals panel (§10.2, §18.6).
 *
 * Shows the live subtotal → discount → taxable → GST → grand total breakdown from
 * `lib/calc`. On the editor these numbers are a display mirror; the server's
 * response is authoritative once saved.
 *
 * Below `md` it collapses to a sticky bottom bar showing the grand total, which
 * expands to the full breakdown on tap (§18.6 "totals as collapsible bottom bar").
 */

import { useState } from 'react'
import Icon from '../../components/ui/Icon.jsx'
import { formatPaise } from '../../lib/money.js'
import styles from './TotalsPanel.module.css'

/**
 * @param {{
 *   totals: {
 *     subtotalPaise: number,
 *     discountPaise: number,
 *     taxablePaise: number,
 *     gstPaise: number,
 *     otherChargesPaise: number,
 *     grandTotalPaise: number,
 *   },
 *   gstBp?: number,
 *   otherChargesLabel?: string,
 *   sticky?: boolean,
 * }} props
 */
export default function TotalsPanel({
  totals,
  gstBp = 0,
  otherChargesLabel = 'Other charges',
  sticky = false,
}) {
  const [open, setOpen] = useState(false)
  const gstPercent = (gstBp / 100).toString().replace(/\.0$/, '')

  const breakdown = (
    <dl className={styles.rows}>
      <div className={styles.rowLine}>
        <dt>Subtotal</dt>
        <dd>{formatPaise(totals.subtotalPaise)}</dd>
      </div>
      {totals.discountPaise > 0 ? (
        <div className={styles.rowLine}>
          <dt>Discount</dt>
          <dd>−{formatPaise(totals.discountPaise)}</dd>
        </div>
      ) : null}
      <div className={styles.rowLine}>
        <dt>Taxable</dt>
        <dd>{formatPaise(totals.taxablePaise)}</dd>
      </div>
      <div className={styles.rowLine}>
        <dt>GST ({gstPercent}%)</dt>
        <dd>{formatPaise(totals.gstPaise)}</dd>
      </div>
      {totals.otherChargesPaise > 0 ? (
        <div className={styles.rowLine}>
          <dt>{otherChargesLabel || 'Other charges'}</dt>
          <dd>{formatPaise(totals.otherChargesPaise)}</dd>
        </div>
      ) : null}
      <div className={`${styles.rowLine} ${styles.grand}`}>
        <dt>Grand total</dt>
        <dd>{formatPaise(totals.grandTotalPaise)}</dd>
      </div>
    </dl>
  )

  if (!sticky) {
    return <div className={styles.panel}>{breakdown}</div>
  }

  return (
    <>
      <div className={styles.panelDesktop}>{breakdown}</div>

      <div className={styles.bottomBar}>
        <button
          type="button"
          className={styles.barToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.barLabel}>Grand total</span>
          <span className={styles.barValue}>
            {formatPaise(totals.grandTotalPaise)}
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={18} />
          </span>
        </button>
        {open ? <div className={styles.barBreakdown}>{breakdown}</div> : null}
      </div>
    </>
  )
}
