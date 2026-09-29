/**
 * Ruchita Interiors — invoices list data hook (§9.2, FR-I5).
 *
 * Owns search, the payment-status filter, page and a reload token so the invoices
 * page has one fetch path. Mirrors `useQuotations`; query/filter/page are
 * component state (not URL) to match the quotations and clients lists.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchInvoices } from '../../api/endpoints/invoices.js'

export const PAGE_SIZE = 25

export function useInvoices() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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
    fetchInvoices({
      q,
      paymentStatus,
      dateFrom,
      dateTo,
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
  }, [q, paymentStatus, dateFrom, dateTo, sort, order, page, reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => setReload((n) => n + 1), [])

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    q,
    paymentStatus,
    dateFrom,
    dateTo,
    sort,
    order,
    loadState,
    error,
    setQ,
    setPaymentStatus,
    setDateFrom,
    setDateTo,
    setSort,
    setOrder,
    setPage,
    refetch,
  }
}
