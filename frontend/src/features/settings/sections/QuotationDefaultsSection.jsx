import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

const FIELDS = ['quotation_prefix', 'default_validity_days']

// §12: the prefix is baked into every future number (`QTN-2026-0001`), so it
// must be short and separator-free to keep the format predictable.
const PREFIX_SHAPE = /^[A-Za-z0-9-]{1,12}$/

function validate(values) {
  const problems = {}
  const prefix = String(values.quotation_prefix || '').trim()
  if (!PREFIX_SHAPE.test(prefix)) {
    problems.quotation_prefix = 'Use 1–12 letters, digits or dashes.'
  }
  const days = String(values.default_validity_days ?? '').trim()
  if (!/^\d{1,3}$/.test(days) || Number(days) > 365) {
    problems.default_validity_days = 'Enter a number of days between 0 and 365.'
  }
  return problems
}

/**
 * §15 "Quotation settings" — numbering prefix and default validity.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function QuotationDefaultsSection({ settings, onSaved }) {
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
      title="Quotation settings"
      description="Defaults for new quotations. Already-issued numbers never change (§12)."
      headingId="settings-quotations"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <div className={styles.fieldGrid}>
        <TextField
          label="Quotation prefix"
          value={values.quotation_prefix}
          onChange={(next) => set('quotation_prefix')(next.toUpperCase())}
          error={fieldErrors.quotation_prefix}
          hint="Next quotation becomes QTN-2026-0001 with this prefix."
          maxLength={12}
          required
        />
        <TextField
          label="Default validity (days)"
          value={values.default_validity_days}
          onChange={set('default_validity_days')}
          error={fieldErrors.default_validity_days}
          hint="How long a new quotation stays valid."
          inputMode="numeric"
          type="number"
          min={0}
          max={365}
          required
        />
      </div>
    </Section>
  )
}
