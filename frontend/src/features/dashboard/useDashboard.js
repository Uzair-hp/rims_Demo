/**
 * Ruchita Interiors — Dashboard data hook (§9.2, §20).
 *
 * Mirrors `useInvoices` (loadState / error / reload) rather than introducing a
 * query library. §17 mentions TanStack Query as "the cache", but nothing in the
 * project uses it, and adding it for one read-only page would be a dependency
 * decision the phase does not ask for.
 *
 * There is exactly one fetch and no parameters: §9.2 defines no query string for
 * this endpoint, and the Dashboard's figures are whole-of-business totals, not a
 * filtered view. `reload` exists so the "Try again" action in the error state
 * re-issues the same single request.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardSummary } from '../../api/endpoints/dashboard.js'

export function useDashboard() {
  const [data, setData] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setError(null)
    fetchDashboardSummary()
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setLoadState('ready')
      })
      .catch((caught) => {
        if (cancelled) return
        setData(null)
        setError(caught)
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const retry = useCallback(() => setReload((n) => n + 1), [])

  return { data, loadState, error, retry }
}
