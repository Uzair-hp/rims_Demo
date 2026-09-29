/**
 * Ruchita Interiors — client picker (§9.2, §4.2).
 *
 * A Sheet that lets the user search and pick a client. The search and
 * archived toggle are shared with `useClients`, so the picker and the
 * Clients page can never disagree on data. Selecting a client calls
 * `onSelect`. An inline "New client" row opens the create form inside
 * the sheet and returns the newly created client.
 */

import { useState } from 'react'
import Sheet from '../../components/ui/Sheet.jsx'
import TextField from '../../components/ui/TextField.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { useClients } from './useClients.js'
import ClientFormModal from './ClientFormModal.jsx'
import styles from './ClientPicker.module.css'

export default function ClientPicker({ open, onSelect, onClose }) {
  const { items, total, status, q, setQ, refetch } = useClients()
  const [formOpen, setFormOpen] = useState(false)

  const loading = status === 'loading'

  const handleCreate = (saved) => {
    setFormOpen(false)
    refetch()
    onSelect?.(saved)
    onClose()
  }

  const handleClose = () => {
    setFormOpen(false)
    onClose()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={handleClose}
        title="Pick a client"
        description="Search and select a client, or create a new one."
      >
        <div className={styles.sheet}>
          <TextField
            label="Search clients"
            placeholder="Name, phone or email…"
            value={q}
            onChange={setQ}
            className={styles.search}
          />

          {loading ? (
            <p className={styles.noResults}>Loading clients…</p>
          ) : items.length === 0 ? (
            <p className={styles.noResults}>No clients found.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => {
                      onSelect?.(client)
                      onClose()
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className={styles.itemName}>{client.name}</p>
                      <p className={styles.itemMeta}>
                        {client.phone || ''}
                        {client.phone && client.email ? ' · ' : ''}
                        {client.email || ''}
                      </p>
                    </div>
                    {client.is_archived ? (
                      <Icon name="archive" size={16} style={{ color: 'var(--color-ink-muted)' }} />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {total > 0 ? (
            <p
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-ink-subtle)',
                textAlign: 'center',
              }}
            >
              {total} client{total !== 1 ? 's' : ''}
            </p>
          ) : null}

          <button type="button" className={styles.createRow} onClick={() => setFormOpen(true)}>
            <Icon name="plus" size={16} /> New client
          </button>
        </div>
      </Sheet>

      <ClientFormModal
        open={formOpen}
        mode="create"
        client={null}
        onSaved={handleCreate}
        onClose={() => setFormOpen(false)}
      />
    </>
  )
}
