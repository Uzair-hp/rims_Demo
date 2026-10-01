/**
 * Ruchita Interiors — services list data hook (SERVICES_PLAN §6).
 *
 * Owns the search term, category filter, archived toggle, page and reload token
 * so the Services page and the ServicePicker share one fetch path — the same
 * contract `useClients` establishes, so the two surfaces can never disagree.
 *
 * `pageSize` is an argument rather than a constant because the two surfaces have
 * genuinely different shapes: the Services page paginates at 25 with a pager,
 * while the picker is a single scrolling sheet and asks for a large page instead.
 * The default keeps the page's behaviour (and `PAGE_SIZE`, which the page's own
 * skeleton count and pager both read) untouched.
 *
 * @param {{ pageSize?: number }} [options]
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchServices } from '../../api/endpoints/services.js'

export const PAGE_SIZE = 25

/** The picker asks for one wide page — it has no pager to fall back on. */
export const PICKER_PAGE_SIZE = 100

export function useServices({ pageSize = PAGE_SIZE } = {}) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState([])
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    fetchServices({ q, category, includeArchived, page, pageSize })
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setTotal(data.total || 0)
        setCategories(data.categories || [])
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [q, category, includeArchived, page, pageSize, reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => setReload((n) => n + 1), [])

  return {
    items,
    total,
    categories,
    page,
    pageSize,
    q,
    category,
    includeArchived,
    status,
    error,
    setQ,
    setCategory,
    setIncludeArchived,
    setPage,
    refetch,
  }
}
