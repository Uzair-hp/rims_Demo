/**
 * Ruchita Interiors — service picker (SERVICES_PLAN FR-SV5/SV6, Phase 9A.3).
 *
 * The quotation editor's bridge to the rate card. Read through the shared
 * `useServices` hook — the same fetch path the Services page uses — so the two
 * surfaces can never disagree about what is in the catalogue.
 *
 * Three deliberate behaviours:
 *
 * - **It stays open.** Tapping a service appends a line and leaves the sheet up,
 *   with an "N added" count and a Done button, so a user pricing a room adds a
 *   handful of services in one visit instead of reopening the sheet per line
 *   (FR-SV6). The editor therefore receives several `onAdd` calls that can land
 *   before React re-renders, and appends functionally.
 * - **Archived services are never offered.** The list endpoint excludes them by
 *   default and this surface never asks for them: quoting a retired rate card
 *   entry is not a thing you can do. Lines already quoted keep theirs.
 * - **No provenance chrome.** The sheet shows plain name, category and rate. The
 *   "Catalog" marker and the "Standard ₹X" hint belong to the editor only, so a
 *   saved line prints like any other line (S8).
 *
 * @param {{
 *   open: boolean,
 *   onAdd?: (service: object) => void,
 *   onClose: () => void,
 * }} props
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Sheet from '../../components/ui/Sheet.jsx'
import TextField from '../../components/ui/TextField.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { formatPaise } from '../../lib/money.js'
import { useServices, PICKER_PAGE_SIZE } from './useServices.js'
import styles from './ServicePicker.module.css'

const DEBOUNCE_MS = 250

export default function ServicePicker({ open, onAdd, onClose }) {
  const { items, total, status, setQ } = useServices({ pageSize: PICKER_PAGE_SIZE })
  const [searchTerm, setSearchTerm] = useState('')
  const [added, setAdded] = useState(0)

  // Debounced search, matching the Services page so both surfaces behave the same
  // way under the same typing (FR-SV4). The hook owns the request; this only owns
  // the idle timer.
  useEffect(() => {
    const handle = setTimeout(() => setQ(searchTerm), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchTerm, setQ])

  const loading = status === 'loading'
  const isEmpty = !loading && items.length === 0

  const handleAdd = (service) => {
    onAdd?.(service)
    setAdded((n) => n + 1)
  }

  const handleClose = () => {
    setAdded(0)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Add from services"
      description="Tap a service to add it as an editable line. You can add several."
    >
      <div className={styles.sheet}>
        <TextField
          label="Search services"
          placeholder="Name, category or description…"
          value={searchTerm}
          onChange={setSearchTerm}
          className={styles.search}
        />

        {loading ? (
          <p className={styles.noResults}>Loading services…</p>
        ) : isEmpty ? (
          <>
            <p className={styles.noResults}>
              {searchTerm
                ? 'No services match your search.'
                : 'Your catalogue is empty — add a service first, then it will show up here.'}
            </p>
            {!searchTerm ? (
              // FR-SV10: the Services page honours ?new=1 and opens its create form,
              // so this is a real shortcut rather than a dead-end instruction.
              <Link className={styles.createRow} to="/services?new=1" onClick={handleClose}>
                <Icon name="plus" size={16} /> New service
              </Link>
            ) : null}
          </>
        ) : (
          <ul className={styles.list}>
            {items.map((service) => (
              <li key={service.id}>
                <button type="button" className={styles.item} onClick={() => handleAdd(service)}>
                  <div className={styles.itemBody}>
                    <p className={styles.itemName}>{service.name}</p>
                    <p className={styles.itemMeta}>
                      {service.category || 'Uncategorised'}
                      {service.unit ? ` · per ${service.unit}` : ''}
                    </p>
                  </div>
                  <span className={styles.rate}>{formatPaise(service.rate_paise)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footer}>
          <p className={styles.count}>
            {added > 0 ? `${added} added` : ''}
            {total > 0 ? ` · ${total} service${total !== 1 ? 's' : ''} in catalogue` : ''}
          </p>
          <button type="button" className={styles.done} onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </Sheet>
  )
}
