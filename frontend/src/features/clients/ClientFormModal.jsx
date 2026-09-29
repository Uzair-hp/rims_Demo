/**
 * Ruchita Interiors — client form modal (§4.2, FR-C1).
 *
 * A Sheet host for ClientForm. `mode` selects create vs edit; `client` provides the
 * edit seed and the id. Server-side field errors from the §9.1 envelope are mapped
 * back onto the form. `onSaved` fires with the saved record so the caller can
 * refresh; the caller owns closing.
 */

import { useState } from 'react'
import Sheet from '../../components/ui/Sheet.jsx'
import { createClient, updateClient } from '../../api/endpoints/clients.js'
import ClientForm from './ClientForm.jsx'

export default function ClientFormModal({ open, onClose, mode = 'create', client, onSaved }) {
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  const isEdit = mode === 'edit'
  const initial = client
    ? {
        name: client.name,
        phone: client.phone,
        email: client.email,
        address: client.address,
        project_address: client.project_address,
        gstin: client.gstin,
        notes: client.notes,
      }
    : {}

  const handleSave = async (draft) => {
    setSubmitting(true)
    setFieldErrors({})
    try {
      const saved = isEdit ? await updateClient(client.id, draft) : await createClient(draft)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setFieldErrors(_detailsToMap(e.details))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Edit client' : 'New client'}>
      <ClientForm initial={initial} errors={fieldErrors} onSave={handleSave} submitting={submitting} />
    </Sheet>
  )
}

function _detailsToMap(details) {
  const map = {}
  for (const detail of details || []) {
    if (detail?.field) {
      map[detail.field] = map[detail.field] ? `${map[detail.field]}; ${detail.message}` : detail.message
    }
  }
  return map
}
