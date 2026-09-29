/**
 * Ruchita Interiors — settings section form hooks (§15).
 *
 * §15's rule is that *every* section is a separate form with its own Save and
 * success feedback. Three small pieces make that rule cheap to follow:
 *
 * - `useFormValues` holds this section's slice of the settings row, with a
 *   setter per key and a reset from the server's normalized answer.
 * - `useSectionForm` owns the submit lifecycle — busy state, client-side
 *   `validate`, per-field errors from the §9.1 `details`, an offline-aware
 *   form message, and the saved flag the footer reports via `role="status"`.
 * - `companySave(values)` PUTs only this section's fields; the server merges
 *   partial payloads, so one section's save can never clobber another's.
 *
 * A section never fakes success: `saved` flips only after the server answers,
 * and a network failure surfaces the §17 "not saved" message (FR-U3).
 */

import { useState } from 'react'
import { saveCompanySettings } from '../../api/endpoints/settings.js'

export const OFFLINE_MESSAGE = 'No connection — changes not saved.'

function errorMessage(requestError) {
  if (requestError?.offline) return OFFLINE_MESSAGE
  return requestError?.message || 'Could not save your changes.'
}

function fieldErrorsFrom(requestError) {
  const details = (requestError?.details || []).filter((detail) => detail.field)
  return Object.fromEntries(details.map((detail) => [detail.field, detail.message]))
}

/**
 * Controlled values for one section's fields.
 *
 * @param {object} settings the loaded row (read once, at mount)
 * @param {string[]} fields this section's column names
 * @returns {[Record<string, any>, (field: string) => (value: any) => void, (row: object) => void]}
 */
export function useFormValues(settings, fields) {
  const pick = (row) => Object.fromEntries(fields.map((field) => [field, row?.[field] ?? '']))
  const [values, setValues] = useState(() => pick(settings))

  const set = (field) => (value) => setValues((previous) => ({ ...previous, [field]: value }))
  const reset = (row) => setValues(pick(row))

  return [values, set, reset]
}

/** Save fn for company-settings sections: PUT `values`, return the normalized row. */
export function companySave(values) {
  return async () => {
    const data = await saveCompanySettings(values)
    return data?.settings
  }
}

/**
 * Submit lifecycle for one section form.
 *
 * @param {{
 *   save: () => Promise<any>,
 *   validate?: () => Record<string, string> | null,
 *   onSaved?: (result: any) => void,
 * }} options
 */
export function useSectionForm({ save, validate, onSaved }) {
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    setError(null)
    setSaved(false)
    setFieldErrors({})

    // Client-side checks run first so a malformed field never costs a round
    // trip; the server stays the authority and its 422s land in the same state.
    const problems = validate ? validate() : null
    if (problems && Object.keys(problems).length > 0) {
      setFieldErrors(problems)
      return
    }

    setSubmitting(true)
    try {
      const result = await save()
      setSaved(true)
      onSaved?.(result)
    } catch (requestError) {
      setFieldErrors(fieldErrorsFrom(requestError))
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, saved, error, fieldErrors, handleSubmit, setFieldErrors, setError }
}
