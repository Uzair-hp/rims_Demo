/**
 * Ruchita Interiors — quotations list data hook (§9.2).
 *
 * Owns search term, status filter, page and a reload token so the Quotations
 * page has one fetch path. Query/filter/page are component state (not URL),
 * mirroring `useClients`.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchQuotations } from '../../api/endpoints/quotations.js'

export const PAGE_SIZE = 25

export function useQuotations() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sort, setSort] = useState('created_at')
  const [order, setOrder] = useState('desc')
  const [loadState, setLoadState] = useState('loading')
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setError(null)
    fetchQuotations({
      q,
      status,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      sort,
      order,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setTotal(data.total || 0)
        setLoadState('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e)
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [q, status, dateFrom, dateTo, minAmount, maxAmount, sort, order, page, reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => setReload((n) => n + 1), [])

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    q,
    status,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    sort,
    order,
    loadState,
    error,
    setQ,
    setStatus,
    setDateFrom,
    setDateTo,
    setMinAmount,
    setMaxAmount,
    setSort,
    setOrder,
    setPage,
    refetch,
  }
}
