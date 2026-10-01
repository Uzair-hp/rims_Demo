/**
 * Ruchita Interiors — services list page (SERVICES_PLAN §6, Phase 9A).
 *
 * The rate card: debounced search, a category chip scroller (the one permitted
 * horizontal scroll, §7), an archived toggle, paginated rows, and the create/edit
 * modal + archive confirmation. Read directly from `useServices` so the page and
 * the future ServicePicker can never disagree on the catalog.
 *
 * There is no detail page in v1 — a service has no history of its own (§6), so
 * Edit opens the form modal and Restore returns an archived row to the list.
 */

import { useEffect, useState } from 'react'
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
import { archiveService, restoreService } from '../../api/endpoints/services.js'
import { formatPaise } from '../../lib/money.js'
import ServiceFormModal from './ServiceFormModal.jsx'
import { useServices } from './useServices.js'
import styles from './ServicesPage.module.css'

const DEBOUNCE_MS = 250

export default function ServicesPage() {
  const {
    items,
    total,
    categories,
    page,
    pageSize,
    status,
    includeArchived,
    setQ,
    setCategory,
    setIncludeArchived,
    setPage,
    refetch,
  } = useServices()
  const [activeCategory, setActiveCategory] = useState('')

  const [searchTerm, setSearchTerm] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  // ?new=1 opens the create modal on first paint (shareable / reload-safe) — the
  // same hook the Clients page uses, which is what the picker's empty state (FR-SV10)
  // will link to.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setEditing(null)
      setFormOpen(true)
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced search: 250 ms of idle typing before the list refetches (FR-SV4).
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
    setBusy(true)
    try {
      await archiveService(archiveTarget.id)
      refetch()
    } finally {
      setBusy(false)
      setArchiveTarget(null)
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    setBusy(true)
    try {
      await restoreService(restoreTarget.id)
      refetch()
    } catch {
      // A name collision (409) re-renders with the row still archived; the list
      // refetch above shows the active service that now owns the name.
      refetch()
    } finally {
      setBusy(false)
      setRestoreTarget(null)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (service) => {
    setEditing(service)
    setFormOpen(true)
  }

  const loading = status === 'loading'
  const isError = status === 'error'

  return (
    <div className={styles.page}>
      <PageHeader
        title="Services"
        description="Your standard rate card — pick one while writing a quotation and edit the rate on the line."
        actions={
          <Button variant="primary" icon="plus" onClick={openCreate} fullWidth className={styles.newButton}>
            New service
          </Button>
        }
      />

      <div className={styles.toolbar}>
        {/*
         * A raw input rather than `TextField`: this field needs a leading search
         * icon and a trailing clear button, and `TextField` has no slot for
         * either. The label is `visually-hidden` rather than dropped, so the
         control keeps its accessible name; the placeholder is a short hint, not
         * the label.
         */}
        <div className={styles.searchWrap}>
          <label htmlFor="services-search" className="visually-hidden">
            Search services
          </label>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            id="services-search"
            type="search"
            className={styles.search}
            placeholder="Search services"
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

      {/*
        Category chip scroller (SERVICES_PLAN §6) — the one permitted horizontal
        scroll (§7). Chips are real toggle buttons; "All" clears the filter. The
        facet comes from the same list response as the rows, so it can never
        disagree with what is on screen.
      */}
      {categories.length > 0 ? (
        <div className={styles.chipScroller} role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`${styles.chip} ${activeCategory === '' ? styles.chipActive : ''}`.trim()}
            aria-pressed={activeCategory === ''}
            onClick={() => {
              setActiveCategory('')
              setCategory('')
              setPage(1)
            }}
          >
            All
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`${styles.chip} ${activeCategory === name ? styles.chipActive : ''}`.trim()}
              aria-pressed={activeCategory === name}
              onClick={() => {
                setActiveCategory(name)
                setCategory(name)
                setPage(1)
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {isError ? (
        <p className={styles.message} role="alert">
          Services could not be loaded.
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
          icon="spark"
          title="No services yet"
          message={
            searchTerm
              ? 'No services match your search.'
              : 'Add the services you quote most often, each with a standard rate.'
          }
          actionLabel="New service"
          actionIcon="plus"
          onAction={openCreate}
        />
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((service) => (
              <li key={service.id}>
                <Card as="article" className={service.is_archived ? styles.archived : undefined}>
                  {/*
                   * Stacked in four rows rather than one crowded line. The
                   * single-row layout put the name, the rate, the unit and two
                   * labelled buttons on one line, which broke at narrow widths:
                   * a long name ran under the price, the category wrapped to an
                   * orphan, "per job" collided with the text, and the actions
                   * squeezed the content instead of sitting below it.
                   */}
                  <div className={styles.headRow}>
                    {/* `min-width: 0` lets this truncate; without it the flex item
                        refuses to shrink below its content and overlaps the price. */}
                    <span className={styles.name}>{service.name}</span>
                    <span className={styles.rateValue}>{formatPaise(service.rate_paise)}</span>
                  </div>

                  <div className={styles.metaRow}>
                    <span className={styles.metaLeft}>
                      {service.is_archived ? <StatusBadge archived>Archived</StatusBadge> : null}
                      {service.category ? <span className={styles.pill}>{service.category}</span> : null}
                    </span>
                    <span className={styles.rateUnit}>per {service.unit || 'job'}</span>
                  </div>

                  {service.description ? <p className={styles.description}>{service.description}</p> : null}

                  <div className={styles.actions}>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(service)}>
                      Edit
                    </Button>
                    {service.is_archived ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="rotateCw"
                        disabled={busy}
                        onClick={() => setRestoreTarget(service)}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="archive"
                        onClick={() => setArchiveTarget(service)}
                      >
                        Archive
                      </Button>
                    )}
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

      <ServiceFormModal
        open={formOpen}
        mode={editing ? 'edit' : 'create'}
        service={editing}
        onSaved={handleSaved}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive service?"
        message="Archived services are hidden from lists and the quotation picker. Quotations already using it keep their lines."
        confirmLabel="Archive"
        danger
        onConfirm={handleArchive}
        onClose={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore service?"
        message="It will reappear in the list and can be added to new quotations again."
        confirmLabel="Restore"
        onConfirm={handleRestore}
        onClose={() => setRestoreTarget(null)}
      />
    </div>
  )
}
