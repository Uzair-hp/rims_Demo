import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'

const FIELDS = ['invoice_prefix']

const PREFIX_SHAPE = /^[A-Za-z0-9-]{1,12}$/

function validate(values) {
  const prefix = String(values.invoice_prefix || '').trim()
  if (!PREFIX_SHAPE.test(prefix)) {
    return { invoice_prefix: 'Use 1–12 letters, digits or dashes.' }
  }
  return null
}

/**
 * §15 "Invoice settings" — numbering prefix for the Phase 7 invoice sequence.
 * Default invoice terms live in the Terms section (scope: invoice).
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function InvoiceDefaultsSection({ settings, onSaved }) {
  const [values, set, reset] = useFormValues(settings, FIELDS)
  const { submitting, saved, error, fieldErrors, handleSubmit } = useSectionForm({
    save: companySave(values),
    validate: () => validate(values),
    onSaved: (row) => {
      if (row) reset(row)
      onSaved?.(row)
    },
  })

  return (
    <Section
      title="Invoice settings"
      description="Prefix for the independent invoice sequence (INV-2026-0001)."
      headingId="settings-invoices"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <TextField
        label="Invoice prefix"
        value={values.invoice_prefix}
        onChange={(next) => set('invoice_prefix')(next.toUpperCase())}
        error={fieldErrors.invoice_prefix}
        hint="Changing it only affects invoices created afterwards."
        maxLength={12}
        required
      />
    </Section>
  )
}
