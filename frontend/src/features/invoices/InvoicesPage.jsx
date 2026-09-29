/**
 * Ruchita Interiors — invoices list page (§9.2, FR-I5).
 *
 * Debounced search, a payment-status filter, and paginated rows showing number,
 * client, issue date, total and paid/outstanding. Reads from `useInvoices`; each row
 * links to the detail page.
 *
 * There is no "New invoice" button, and that is the design, not an omission: an
 * invoice is only ever created by converting an approved quotation (FR-I1). The
 * empty state says so and points at the quotations that can be converted.
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
import { formatPaise } from '../../lib/money.js'
import { useInvoices } from './useInvoices.js'
import { PAYMENT_STATUS_OPTIONS, paymentStatusLabel } from './status.js'
import styles from './InvoicesPage.module.css'

const DEBOUNCE_MS = 250

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date created' },
  { value: 'issue_date', label: 'Issue date' },
  { value: 'grand_total_paise', label: 'Amount' },
]

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function InvoicesPage() {
  const {
    items,
    total,
    page,
    pageSize,
    paymentStatus,
    dateFrom,
    dateTo,
    sort,
    order,
    loadState,
    setQ,
    setPaymentStatus,
    setDateFrom,
    setDateTo,
    setSort,
    setOrder,
    setPage,
  } = useInvoices()

  const [searchTerm, setSearchTerm] = useState('')

  // Debounced search: 250 ms of idle typing before the list refetches.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(searchTerm)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchTerm, setQ, setPage])

  const loading = loadState === 'loading'
  const isError = loadState === 'error'
  const hasFilters = Boolean(searchTerm || paymentStatus || dateFrom || dateTo)

  return (
    <div className={styles.page}>
      <PageHeader
        title="Invoices"
        description="Every invoice with its payment status, total and what is still outstanding."
        actions={
          <Button variant="secondary" icon="fileText" to="/quotations?status=approved">
            Approved quotations
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <TextField
          label="Search invoices"
          placeholder="Search by number or client…"
          value={searchTerm}
          onChange={setSearchTerm}
          className={styles.search}
        />
        <TextField
          as="select"
          label="Payment status"
          value={paymentStatus}
          onChange={(v) => {
            setPaymentStatus(v)
            setPage(1)
          }}
          className={styles.filter}
        >
          {PAYMENT_STATUS_OPTIONS.map((opt) => (
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
          Invoices could not be loaded.
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
          icon="receipt"
          title="No invoices yet"
          message={
            hasFilters
              ? 'No invoices match your filters.'
              : 'Approve a quotation, then use “Create invoice” on it to bill the client.'
          }
          actionLabel="Go to quotations"
          actionIcon="fileText"
          actionTo="/quotations"
        />
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((invoice) => (
              <li key={invoice.id}>
                <Card as="article" interactive>
                  <Link to={`/invoices/${invoice.id}`} className={styles.row}>
                    <div className={styles.summary}>
                      <span className={styles.number}>{invoice.number || `#${invoice.id}`}</span>
                      <span className={styles.client}>{invoice.client_snapshot?.name || 'Client'}</span>
                      <span className={styles.date}>{formatDate(invoice.issue_date)}</span>
                    </div>
                    <div className={styles.meta}>
                      {invoice.payment_status === 'paid' ? (
                        <span className={styles.total}>{formatPaise(invoice.grand_total_paise)}</span>
                      ) : (
                        <>
                          <span className={styles.total}>{formatPaise(invoice.grand_total_paise)}</span>
                          <span className={styles.outstanding}>
                            {formatPaise(invoice.outstanding_paise)} due
                          </span>
                        </>
                      )}
                      <StatusBadge status={invoice.payment_status}>
                        {paymentStatusLabel(invoice.payment_status)}
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
