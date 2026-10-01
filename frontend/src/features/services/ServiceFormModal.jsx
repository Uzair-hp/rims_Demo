/**
 * Ruchita Interiors — service form modal (SERVICES_PLAN §6, FR-SV1).
 *
 * A Sheet host for ServiceForm, mirroring ClientFormModal. `mode` selects create
 * vs edit; `service` provides the edit seed and the id. Server-side field errors
 * from the §9.1 envelope are mapped back onto the form. `onSaved` fires with the
 * saved record so the caller can refresh; the caller owns closing.
 */

import { useState } from 'react'
import Sheet from '../../components/ui/Sheet.jsx'
import { createService, updateService } from '../../api/endpoints/services.js'
import { useSettings } from '../settings/SettingsProvider.jsx'
import ServiceForm from './ServiceForm.jsx'

export default function ServiceFormModal({ open, onClose, mode = 'create', service, onSaved }) {
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  // Category/unit suggestions come from the existing Settings → Catalogue lists
  // (S6) — no new lists to maintain.
  const { settings } = useSettings()
  const units = settings?.units || []
  const categories = settings?.item_categories || []

  const isEdit = mode === 'edit'
  const initial = service
    ? {
        name: service.name,
        category: service.category,
        description: service.description,
        unit: service.unit,
        default_qty_milli: service.default_qty_milli,
        rate_paise: service.rate_paise,
      }
    : {}

  const handleSave = async (draft) => {
    setSubmitting(true)
    setFieldErrors({})
    try {
      const saved = isEdit ? await updateService(service.id, draft) : await createService(draft)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setFieldErrors(_detailsToMap(e.details))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Edit service' : 'New service'}>
      <ServiceForm
        initial={initial}
        errors={fieldErrors}
        units={units}
        categories={categories}
        onSave={handleSave}
        submitting={submitting}
        isEdit={isEdit}
      />
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
