/**
 * Ruchita Interiors — service form (SERVICES_PLAN §6, FR-SV1).
 *
 * Shared by the create and edit modals, the same shape as ClientForm. Quantities
 * are entered in natural units and the rate in rupees, then stored as milli-units
 * and paise — the integer units the API expects (§8.1). Validation mirrors the
 * backend `ServiceSchema` through `validateService` (S3: rate > 0).
 */

import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import TextField from '../../components/ui/TextField.jsx'
import { milliToInput, unitsToMilli } from '../../lib/calc.js'
import { paiseToInput, rupeesToPaise } from '../../lib/money.js'
import { validateService } from '../../lib/validation.js'
import styles from './ServiceForm.module.css'

const EMPTY = { name: '', category: '', description: '', unit: 'job', defaultQty: '1', rate: '' }

/**
 * @param {{
 *   initial?: object,
 *   errors?: Record<string,string>,
 *   units?: string[],
 *   categories?: string[],
 *   onSave: (draft: object) => void,
 *   submitting?: boolean,
 *   isEdit?: boolean,
 * }} props
 */
export default function ServiceForm({
  initial = {},
  errors: serverErrors = {},
  units = [],
  categories = [],
  onSave,
  submitting = false,
  isEdit = false,
}) {
  const [values, setValues] = useState({
    name: initial.name || EMPTY.name,
    category: initial.category || EMPTY.category,
    description: initial.description || EMPTY.description,
    unit: initial.unit || EMPTY.unit,
    defaultQty:
      initial.default_qty_milli != null ? milliToInput(initial.default_qty_milli) : EMPTY.defaultQty,
    rate: initial.rate_paise != null ? paiseToInput(initial.rate_paise) : EMPTY.rate,
  })
  const [touched, setTouched] = useState({})

  const errors = validateService({
    name: values.name,
    category: values.category,
    description: values.description,
    unit: values.unit,
    default_qty_milli: unitsToMilli(values.defaultQty),
    rate_paise: rupeesToPaise(values.rate),
  })

  // A field shows its error once touched or when the server repeats it; the
  // helper text is the FR-SV5 contract made visible on the edit form.
  const fieldError = (field) => (touched[field] && errors[field]) || serverErrors[field] || undefined

  const handleChange = (field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setTouched((t) => ({ ...t, [field]: false }))
  }

  const markTouched = (field) => setTouched((t) => ({ ...t, [field]: true }))

  const rateInvalid = Boolean(fieldError('rate_paise'))

  const handleSubmit = (event) => {
    event.preventDefault()
    setTouched({
      name: true,
      rate_paise: true,
      default_qty_milli: true,
      unit: true,
      category: true,
      description: true,
    })
    if (Object.keys(errors).length > 0) return
    onSave({
      name: values.name.trim(),
      category: values.category.trim() || null,
      description: values.description.trim() || null,
      unit: values.unit.trim() || 'job',
      default_qty_milli: unitsToMilli(values.defaultQty) || 0,
      rate_paise: rupeesToPaise(values.rate),
    })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <TextField
        label="Service name"
        value={values.name}
        onChange={(v) => handleChange('name', v)}
        onBlur={() => markTouched('name')}
        required
        maxLength={200}
        error={fieldError('name')}
      />
      <TextField
        label="Category"
        value={values.category}
        onChange={(v) => handleChange('category', v)}
        onBlur={() => markTouched('category')}
        list="ri-service-categories"
        hint="Optional — e.g. Kitchen, Wardrobe, Ceiling"
        error={fieldError('category')}
      />
      {categories.length ? (
        <datalist id="ri-service-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      ) : null}
      <TextField
        label="Description"
        as="textarea"
        rows={3}
        value={values.description}
        onChange={(v) => handleChange('description', v)}
        onBlur={() => markTouched('description')}
        hint="Copied onto quotation lines as the item description"
        error={fieldError('description')}
      />
      <div className={styles.row}>
        <TextField
          label="Unit"
          value={values.unit}
          onChange={(v) => handleChange('unit', v)}
          onBlur={() => markTouched('unit')}
          list="ri-service-units"
          hint="e.g. job, sqft, day"
          error={fieldError('unit')}
        />
        <TextField
          label="Default quantity"
          type="text"
          inputMode="decimal"
          value={values.defaultQty}
          onChange={(v) => handleChange('defaultQty', v)}
          onBlur={() => markTouched('default_qty_milli')}
          hint="Pre-fills new lines"
          error={fieldError('default_qty_milli')}
        />
        <TextField
          label="Standard rate (₹)"
          type="text"
          inputMode="decimal"
          value={values.rate}
          onChange={(v) => handleChange('rate', v)}
          onBlur={() => markTouched('rate_paise')}
          className={styles.rateField}
          hint="Used as the starting rate on new lines"
          error={fieldError('rate_paise')}
        />
      </div>
      {units.length ? (
        <datalist id="ri-service-units">
          {units.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      ) : null}

      {isEdit ? (
        <p className={styles.notice} role="note">
          Changes apply to new quotation lines only — existing quotations and invoices keep the rate they were
          saved with.
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={rateInvalid && touched.rate_paise}
        >
          Save service
        </Button>
      </div>
    </form>
  )
}
