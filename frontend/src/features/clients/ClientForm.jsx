/**
 * Ruchita Interiors — client form (§4.2).
 *
 * Shared by the create and edit modals. One source of truth for the field list and
 * the empty-name rule (FR-C1), so the list, the detail, the picker and the manual
 * API all validate the same input.
 */

import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import TextField from '../../components/ui/TextField.jsx'
import styles from './ClientForm.module.css'

const FIELDS = [
  { key: 'name', label: 'Client name', required: true, maxLength: 200 },
  { key: 'phone', label: 'Phone', type: 'tel', inputMode: 'tel' },
  { key: 'email', label: 'Email', type: 'email', inputMode: 'email' },
  { key: 'address', label: 'Billing address', as: 'textarea' },
  { key: 'project_address', label: 'Project address', as: 'textarea' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'notes', label: 'Notes', as: 'textarea' },
]

const EMPTY = { name: '', phone: '', email: '', address: '', project_address: '', gstin: '', notes: '' }

/**
 * @param {{ initial?: object, errors?: Record<string,string>, onSave: (draft: object) => void, submitting?: boolean }} props
 */
export default function ClientForm({ initial = {}, errors: serverErrors = {}, onSave, submitting = false }) {
  const [values, setValues] = useState({ ...EMPTY, ...initial })
  const [touched, setTouched] = useState({})

  const nameValid = values.name.trim().length > 0
  const nameError = touched.name && !nameValid ? 'A client name is required.' : undefined

  const handleChange = (field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (field === 'name' && value.trim().length > 0) setTouched((t) => ({ ...t, name: false }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!nameValid) {
      setTouched({ name: true })
      return
    }
    onSave(values)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          name={field.key}
          value={values[field.key]}
          onChange={(value) => handleChange(field.key, value)}
          as={field.as || 'input'}
          type={field.type}
          inputMode={field.inputMode}
          required={field.required}
          maxLength={field.maxLength}
          error={field.key === 'name' ? nameError : serverErrors[field.key]}
        />
      ))}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={submitting} disabled={!nameValid || submitting}>
          Save client
        </Button>
      </div>
    </form>
  )
}
