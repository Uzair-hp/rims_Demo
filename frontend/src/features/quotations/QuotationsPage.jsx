/**
 * Ruchita Interiors — quotations list page (§9.2, §13).
 *
 * Debounced search, a status filter, and paginated rows showing number, client,
 * date, total and status. Reads from `useQuotations`; each row links to the
 * detail page. Numbers are allocated at draft creation, so every row has one.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import TextField from '../../components/ui/TextField.jsx'
import { formatPaise, rupeesToPaise } from '../../lib/money.js'
import { useQuotations } from './useQuotations.js'
import { STATUS_OPTIONS, statusLabel } from './status.js'
import styles from './QuotationsPage.module.css'

const DEBOUNCE_MS = 250

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date created' },
  { value: 'quotation_date', label: 'Quotation date' },
  { value: 'grand_total_paise', label: 'Amount' },
]

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function QuotationsPage() {
  const {
    items,
    total,
    page,
    pageSize,
    status,
    dateFrom,
    dateTo,
    sort,
    order,
    loadState,
    setQ,
    setStatus,
    setDateFrom,
    setDateTo,
    setMinAmount,
    setMaxAmount,
    setSort,
    setOrder,
    setPage,
  } = useQuotations()

  const [searchTerm, setSearchTerm] = useState('')
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')

  // Debounced search: 250 ms of idle typing before the list refetches.
  useEffect(() => {
    const handle = setTimeout(() => setQ(searchTerm), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchTerm, setQ])

  // Amounts are typed in rupees but filtered in paise (§8.1). Debounce the parse
  // so the list doesn't refetch on every keystroke, and reset to page 1.
  useEffect(() => {
    const handle = setTimeout(() => {
      setMinAmount(minInput.trim() === '' ? '' : rupeesToPaise(minInput))
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [minInput, setMinAmount, setPage])

  useEffect(() => {
    const handle = setTimeout(() => {
      setMaxAmount(maxInput.trim() === '' ? '' : rupeesToPaise(maxInput))
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [maxInput, setMaxAmount, setPage])

  const loading = loadState === 'loading'
  const isError = loadState === 'error'
  const hasFilters = Boolean(searchTerm || status || dateFrom || dateTo || minInput || maxInput)

  return (
    <div className={styles.page}>
      <PageHeader
        title="Quotations"
        description="Every quotation with its status, total and next action."
        actions={
          <Button variant="primary" icon="plus" to="/quotations/new">
            New quotation
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <TextField
          label="Search quotations"
          placeholder="Search by number or client…"
          value={searchTerm}
          onChange={setSearchTerm}
          className={styles.search}
        />
        <TextField
          as="select"
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          className={styles.filter}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </TextField>

        <div className={styles.filters}>
          <TextField
            label="From date"
            type="date"
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v)
              setPage(1)
            }}
          />
          <TextField
            label="To date"
            type="date"
            value={dateTo}
            onChange={(v) => {
              setDateTo(v)
              setPage(1)
            }}
          />
          <TextField
            label="Min amount (₹)"
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={minInput}
            onChange={setMinInput}
          />
          <TextField
            label="Max amount (₹)"
            type="number"
            inputMode="decimal"
            placeholder="Any"
            value={maxInput}
            onChange={setMaxInput}
          />
          <TextField
            as="select"
            label="Sort by"
            value={sort}
            onChange={(v) => {
              setSort(v)
              setPage(1)
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </TextField>
          <TextField
            as="select"
            label="Order"
            value={order}
            onChange={(v) => {
              setOrder(v)
              setPage(1)
            }}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </TextField>
        </div>
      </div>

      {isError ? (
        <p className={styles.message} role="alert">
          Quotations could not be loaded.
        </p>
      ) : loading ? (
        <ul className={styles.list}>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Skeleton height="3.75rem" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          icon="fileText"
          title="No quotations yet"
          message={
            hasFilters
              ? 'No quotations match your filters.'
              : 'Create your first quotation to send a priced estimate to a client.'
          }
          actionLabel="New quotation"
          actionIcon="plus"
          actionTo="/quotations/new"
        />
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((q) => (
              <li key={q.id}>
                <Card as="article" interactive>
                  <Link to={`/quotations/${q.id}`} className={styles.row}>
                    <div className={styles.summary}>
                      <span className={styles.number}>{q.number || `#${q.id}`}</span>
                      <span className={styles.client}>{q.client_snapshot?.name || 'Client'}</span>
                      <span className={styles.date}>{formatDate(q.quotation_date)}</span>
                    </div>
                    <div className={styles.meta}>
                      <span className={styles.total}>{formatPaise(q.grand_total_paise)}</span>
                      <StatusBadge status={q.status} className={styles.badge}>
                        {statusLabel(q.status)}
                      </StatusBadge>
                    </div>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
          {total > pageSize ? (
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  )
}
