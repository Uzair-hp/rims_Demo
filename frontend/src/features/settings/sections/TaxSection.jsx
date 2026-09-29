import { useState } from 'react'
import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { saveCompanySettings } from '../../../api/endpoints/settings.js'
import { useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

function validate(percent) {
  const raw = String(percent ?? '').trim()
  const value = Number(raw)
  if (raw === '' || Number.isNaN(value) || value < 0 || value > 28) {
    return { default_gst_bp: 'Enter a GST rate between 0% and 28%.' }
  }
  return null
}

/**
 * §15 "Tax settings" — the default GST rate for new documents.
 *
 * The API stores basis points (§8.1: 1800 = 18%); this field speaks percent,
 * because that is how the owner reads it. The conversion happens here, once,
 * in both directions.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function TaxSection({ settings, onSaved }) {
  // Own state rather than `useFormValues`: the stored unit (bp) and the typed
  // unit (percent) differ, so the generic pick-from-row would show 1800.
  const [percent, setPercent] = useState(() => (settings?.default_gst_bp ?? 0) / 100)

  const { submitting, saved, error, fieldErrors, handleSubmit } = useSectionForm({
    save: async () => {
      const data = await saveCompanySettings({
        default_gst_bp: Math.round(Number(String(percent).trim()) * 100),
      })
      return data?.settings
    },
    validate: () => validate(percent),
    onSaved: (row) => {
      if (row) setPercent(row.default_gst_bp / 100)
      onSaved?.(row)
    },
  })

  return (
    <Section
      title="Tax settings"
      description="Default GST rate applied to new quotations and invoices."
      headingId="settings-tax"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <div className={styles.fieldGrid}>
        <TextField
          label="Default GST (%)"
          value={percent}
          onChange={setPercent}
          error={fieldErrors.default_gst_bp}
          hint="Enter a percentage, e.g. 18 for 18%."
          inputMode="decimal"
          type="number"
          min={0}
          max={28}
          step="0.5"
          required
        />
      </div>
    </Section>
  )
}
