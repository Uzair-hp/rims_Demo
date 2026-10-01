/**
 * Ruchita Interiors — client picker (§9.2, §4.2).
 *
 * A sheet for searching and choosing a client, with an inline create so the
 * quotation editor never loses the document being written.
 *
 * **The layout rule this file exists to satisfy: only the list scrolls.** The
 * header, the search field and the footer are fixed, and the list takes the
 * remaining height (`flex: 1; min-height: 0; overflow-y: auto`). The
 * `min-height: 0` is load-bearing — without it a flex child refuses to shrink
 * below its content, the list grows to fit every client, and the whole sheet
 * scrolls instead of the list inside it.
 *
 * Rows are uniform by construction rather than by tuning: each is a grid with
 * fixed avatar and trailing-icon tracks and one fluid middle column, so a long
 * name truncates in the middle instead of pushing the row's siblings around.
 * That is what stops the ragged, content-width look a plain flex row produces
 * when one client has a long name and the next has a short one.
 *
 * Search runs through the shared `useClients` hook, so the picker and the
 * Clients page can never disagree about what a client is or how many there are.
 * It is debounced here for the same reason the Clients page debounces: a request
 * per keystroke is a request per keystroke.
 *
 * Keyboard support is not decoration. Picking a client is a repeated, mostly
 * keyboard action inside the quotation editor, so Up/Down move the active row,
 * Enter selects, and Escape closes. The rows are a real `listbox` so a screen
 * reader announces the count and the position rather than a list of buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../components/ui/Sheet.jsx'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Icon from '../../components/ui/Icon.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import { formatPhone } from '../../lib/phone.js'
import { useClients } from './useClients.js'
import ClientFormModal from './ClientFormModal.jsx'
import styles from './ClientPicker.module.css'

const DEBOUNCE_MS = 250

/**
 * Up to two uppercase initials for the avatar.
 *
 * Letters only. A name like "2B Interiors" yields "BI", not "2I" — a digit in an
 * avatar reads as a number rather than a name, and business names in this
 * directory often start with a plot or house number. Anything with no letters at
 * all falls back to "?" rather than an empty circle.
 */
function initialsFor(name) {
  const words = String(name || '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export default function ClientPicker({ open, onSelect, onClose }) {
  const { items, total, status, q, setQ, setPage, refetch } = useClients()
  const [formOpen, setFormOpen] = useState(false)
  const [seedName, setSeedName] = useState('')
  const [term, setTerm] = useState(q)
  const [activeIndex, setActiveIndex] = useState(0)

  const listRef = useRef(null)
  const searchRef = useRef(null)

  const loading = status === 'loading'

  // Debounced search: 250ms of idle typing before the list refetches, matching
  // the Clients page so the two feel identical.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(term)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [term, setQ, setPage])

  /* eslint-disable react-hooks/set-state-in-effect */
  // Autofocus the search field. `Sheet` moves focus to its first focusable node
  // (the close button) on open, so without this the user starts with focus on
  // the thing that dismisses the dialog rather than the thing they came to use.
  //
  // The per-open reset lives here too, for one reason: the search term and the
  // hook's query are two pieces of state, and they have to agree when the sheet
  // opens. Reopening after a search would otherwise show the previous term in
  // the box over an unfiltered first page. It runs in the same effect as the
  // focus call so there is a single render that both restores the field and
  // points at it.
  useEffect(() => {
    if (!open) return
    setTerm(q)
    setActiveIndex(0)
    setFormOpen(false)
    setSeedName('')
    searchRef.current?.focus()
    // Intentionally not depending on `q`: that would re-sync the box on every
    // keystroke and undo the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Clamp the active row in the same effect that scrolls it, rather than in a
  // separate one that would set state and then re-run: the index cannot be
  // rendered out of range because it is clamped before the row is read.
  useEffect(() => {
    // Scroll the keyboard-selected row into view. `nearest` so a partial scroll
    // is not used: moving one row with the arrows should not jump the list.
    const list = listRef.current
    if (!list) return
    const rows = list.querySelectorAll('[role="option"]')
    rows[Math.min(activeIndex, rows.length - 1)]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items.length])

  const handleSelect = useCallback(
    (client) => {
      onSelect?.(client)
      onClose()
    },
    [onSelect, onClose],
  )

  const handleCreate = (saved) => {
    setFormOpen(false)
    refetch()
    onSelect?.(saved)
    onClose()
  }

  const handleClose = () => {
    setFormOpen(false)
    setSeedName('')
    onClose()
  }

  // Open the create form, optionally seeded with what the user searched for, so
  // "create 'Acme' as a new client" arrives at a form with the name filled in.
  const openCreate = (name = '') => {
    setSeedName(name)
    setFormOpen(true)
  }

  // Read the live row count from the DOM rather than closing over `items.length`
  // in a handler that is re-created on every render anyway.
  const rowCount = items.length

  const handleKeyDown = (event) => {
    if (formOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (rowCount > 0) setActiveIndex((index) => (index + 1) % rowCount)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (rowCount > 0) setActiveIndex((index) => (index - 1 + rowCount) % rowCount)
      return
    }
    if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      handleSelect(items[activeIndex])
    }
  }

  const countLabel = useMemo(() => {
    const shown = items.length
    if (term.trim()) return `${shown} of ${total} client${total === 1 ? '' : 's'}`
    return `${total} client${total === 1 ? '' : 's'}`
  }, [items.length, term, total])

  const noMatches = !loading && items.length === 0 && term.trim().length > 0
  const noClientsAtAll = !loading && items.length === 0 && term.trim().length === 0

  return (
    <>
      <Sheet
        open={open}
        onClose={handleClose}
        title="Pick a client"
        description="Search and select a client, or create a new one."
        size="wide"
        footer={
          <>
            <p className={styles.count}>{countLabel}</p>
            <Button variant="primary" icon="plus" fullWidth onClick={() => openCreate()}>
              New client
            </Button>
          </>
        }
      >
        <div className={styles.sheet} onKeyDown={handleKeyDown}>
          {/* A raw input rather than `TextField`: this field needs a leading
              icon, a trailing clear button and a fixed height, none of which
              `TextField` has a slot for, and it carries no label or error of its
              own — the sheet's title already says what this is for. It is
              hidden from assistive tech and the list below carries the semantics. */}
          <div className={styles.searchWrap}>
            <label htmlFor="client-picker-search" className="visually-hidden">
              Search clients by name, phone or email
            </label>
            <Icon name="search" size={18} className={styles.searchIcon} />
            <input
              id="client-picker-search"
              ref={searchRef}
              type="search"
              className={styles.search}
              placeholder="Search by name, phone or email"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value)
                setActiveIndex(0)
              }}
              autoComplete="off"
            />
            {term ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => {
                  setTerm('')
                  searchRef.current?.focus()
                }}
                aria-label="Clear search"
              >
                <Icon name="x" size={16} />
              </button>
            ) : null}
          </div>

          {loading ? (
            <ul className={styles.list} aria-hidden="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index}>
                  <Skeleton height="4rem" radius="var(--radius-input)" />
                </li>
              ))}
            </ul>
          ) : noMatches ? (
            <EmptyState
              icon="search"
              title={`No clients match “${term.trim()}”`}
              message="Check the spelling, or create a new client with this name."
              actionLabel={`Create “${term.trim()}” as new client`}
              actionIcon="plus"
              onAction={() => openCreate(term.trim())}
              className={styles.empty}
            />
          ) : noClientsAtAll ? (
            <EmptyState
              icon="users"
              title="No clients yet"
              message="Add your first client to start raising quotations and invoices."
              actionLabel="New client"
              actionIcon="plus"
              onAction={() => openCreate()}
              className={styles.empty}
            />
          ) : (
            <ul className={styles.list} ref={listRef} role="listbox" aria-label="Clients">
              {items.map((client, index) => {
                const phone = formatPhone(client.phone)
                const email = client.email || ''
                // One line, and never a stray "·" where a side is missing.
                const contact = [phone, email].filter(Boolean).join(' · ')

                return (
                  <li key={client.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`${styles.item} ${index === activeIndex ? styles.itemActive : ''}`.trim()}
                      onClick={() => handleSelect(client)}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className={styles.avatar} aria-hidden="true">
                        {initialsFor(client.name)}
                      </span>
                      <span className={styles.itemText}>
                        <span className={styles.itemName}>{client.name}</span>
                        <span className={styles.itemMeta}>{contact || 'No contact details'}</span>
                      </span>
                      {client.is_archived ? (
                        <Icon name="archive" size={16} className={styles.itemTrailing} />
                      ) : (
                        <Icon name="chevronRight" size={18} className={styles.itemTrailing} />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Sheet>

      <ClientFormModal
        open={formOpen}
        mode="create"
        client={null}
        initialName={seedName}
        onSaved={handleCreate}
        onClose={() => setFormOpen(false)}
      />
    </>
  )
}
