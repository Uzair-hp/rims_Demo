/**
 * Ruchita Interiors — clients list page (§9.2, §4.2).
 *
 * Search (debounced), an archived toggle, paginated cards, and the create/edit
 * modal + archive confirmation. Read directly from `useClients`, which is shared
 * with the ClientPicker so the two surfaces can never disagree.
 */

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '../../components/ui/Button.jsx'
import Card from '../../components/ui/Card.jsx'
import Checkbox from '../../components/ui/Checkbox.jsx'
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { archiveClient } from '../../api/endpoints/clients.js'
import { formatPhone } from '../../lib/phone.js'
import ClientFormModal from './ClientFormModal.jsx'
import { useClients } from './useClients.js'
import styles from './ClientsPage.module.css'

const DEBOUNCE_MS = 250

export default function ClientsPage() {
  const [searchParams] = useSearchParams()
  const {
    items,
    total,
    page,
    pageSize,
    status,
    includeArchived,
    setQ,
    setIncludeArchived,
    setPage,
    refetch,
  } = useClients()

  const [searchTerm, setSearchTerm] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)

  // ?new=1 opens the create modal on first paint (shareable / reload-safe).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null)
      setFormOpen(true)
    }
  }, [searchParams])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced search: 250 ms of idle typing before the list refetches (FR-C2).
  useEffect(() => {
    const handle = setTimeout(() => setQ(searchTerm), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchTerm, setQ])

  const handleSaved = () => {
    refetch()
    setFormOpen(false)
    setEditing(null)
  }

  const handleArchive = async () => {
    if (!archiveTarget) return
    try {
      await archiveClient(archiveTarget.id)
      refetch()
    } finally {
      setArchiveTarget(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (client) => {
    setEditing(client)
    setFormOpen(true)
  }

  const loading = status === 'loading'
  const isError = status === 'error'

  return (
    <div className={styles.page}>
      <PageHeader
        title="Clients"
        description="Searchable directory of your clients and their linked documents."
        actions={
          <Button variant="primary" icon="plus" onClick={openCreate}>
            New client
          </Button>
        }
      />

      <div className={styles.toolbar}>
        {/*
         * The same raw input as `ServicesPage` (SERVICES_PLAN §6), icon and clear
         * button included, so the two directories cannot drift apart visually.
         * A raw input rather than `TextField`: this field needs a leading search
         * icon and a trailing clear button, and `TextField` has no slot for
         * either. The label is `visually-hidden` rather than dropped, so the
         * control keeps its accessible name; the placeholder is a short hint, not
         * the label.
         */}
        <div className={styles.searchWrap}>
          <label htmlFor="clients-search" className="visually-hidden">
            Search clients
          </label>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            id="clients-search"
            type="search"
            className={styles.search}
            placeholder="Search by name, phone or email"
            value={searchTerm}
            onChange={setSearchTerm}
            autoComplete="off"
          />
          {searchTerm ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
            >
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </div>
        <Checkbox
          label="Show archived"
          checked={includeArchived}
          onChange={(next) => {
            setIncludeArchived(next)
            setPage(1)
          }}
        />
      </div>

      {isError ? (
        <p className={styles.message} role="alert">
          Clients could not be loaded.
        </p>
      ) : loading ? (
        <ul className={styles.list}>
          {Array.from({ length: pageSize }).map((_, i) => (
            <li key={i}>
              <Skeleton height="3.5rem" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          icon="users"
          title="No clients yet"
          message={
            searchTerm
              ? 'No clients match your search.'
              : 'Add your first client to start building an address book.'
          }
          actionLabel="New client"
          actionIcon="plus"
          onAction={openCreate}
        />
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((client) => (
              <li key={client.id}>
                <Card as="article" interactive className={client.is_archived ? styles.archived : undefined}>
                  <div className={styles.row}>
                    <div className={styles.summary}>
                      <Link to={`/clients/${client.id}`} className={styles.rowTitle}>
                        {client.name}
                      </Link>
                      {client.is_archived ? (
                        <StatusBadge archived className={styles.badge}>
                          Archived
                        </StatusBadge>
                      ) : null}
                      {client.phone ? <p className={styles.meta}>{formatPhone(client.phone)}</p> : null}
                      {client.email ? <p className={styles.meta}>{client.email}</p> : null}
                    </div>
                    <div className={styles.actions}>
                      {/*
                        Visible text alongside each icon.

                        These were icon-only ghost buttons, which at `sm` size
                        render as a small bordered square — a shape users read as
                        a tick box rather than a button. The label removes the
                        ambiguity.

                        The `aria-label`s that used to supply the accessible name
                        are gone: with visible text present, a duplicate
                        `aria-label` would override it and make voice control
                        match on the hidden string instead of what is on screen.
                      */}
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(client)}>
                        Edit
                      </Button>
                      {!client.is_archived ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="archive"
                          onClick={() => setArchiveTarget(client)}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          {total > pageSize ? (
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          ) : null}
        </>
      )}

      <ClientFormModal
        open={formOpen}
        mode={editing ? 'edit' : 'create'}
        client={editing}
        onSaved={handleSaved}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive client?"
        message="Archived clients are hidden from lists and pickers, but their quotations and invoices keep their history."
        confirmLabel="Archive"
        danger
        onConfirm={handleArchive}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  )
}
