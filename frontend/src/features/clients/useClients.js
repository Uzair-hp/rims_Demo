/**
 * Ruchita Interiors — clients list data hook (§9.2, §4.2).
 *
 * Owns the search term, archived toggle, page and reload token so both the Clients
 * page and the ClientPicker can share one fetch path. Query and page are component
 * state (not URL) here; the page layer syncs `?new=` separately.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchClients } from '../../api/endpoints/clients.js'

export const PAGE_SIZE = 25

export function useClients() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    fetchClients({ q, includeArchived, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setTotal(data.total || 0)
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
  }, [q, includeArchived, page, reload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => setReload((n) => n + 1), [])

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    q,
    includeArchived,
    status,
    error,
    setQ,
    setIncludeArchived,
    setPage,
    refetch,
  }
}
