import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

const FIELDS = ['bank_account_name', 'bank_account_number', 'bank_name', 'bank_ifsc', 'bank_branch', 'upi_id']

// §15: this block is snapshotted onto invoices at conversion (§8.4), so the
// IFSC is validated as the exact 11 characters banks issue — an empty value
// simply means "not filled in yet".
function validate(values) {
  const ifsc = String(values.bank_ifsc || '').trim()
  if (ifsc && ifsc.length !== 11) {
    return { bank_ifsc: 'IFSC must be exactly 11 characters.' }
  }
  return null
}

/**
 * §15 "Payment / bank" — details printed on the invoice and snapshotted at
 * conversion so later edits never rewrite an issued invoice.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function BankSection({ settings, onSaved }) {
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
      title="Payment & bank details"
      description="Printed on invoices. Invoices snapshot these values when they are issued."
      headingId="settings-bank"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <div className={styles.fieldGrid}>
        <TextField
          label="Account name"
          value={values.bank_account_name}
          onChange={set('bank_account_name')}
          error={fieldErrors.bank_account_name}
          autoComplete="off"
        />
        <TextField
          label="Account number"
          value={values.bank_account_number}
          onChange={set('bank_account_number')}
          error={fieldErrors.bank_account_number}
          inputMode="numeric"
          autoComplete="off"
        />
        <TextField
          label="Bank name"
          value={values.bank_name}
          onChange={set('bank_name')}
          error={fieldErrors.bank_name}
        />
        <TextField
          label="IFSC"
          value={values.bank_ifsc}
          onChange={(next) => set('bank_ifsc')(next.toUpperCase())}
          error={fieldErrors.bank_ifsc}
          maxLength={11}
          hint="11 characters, e.g. HDFC0001234."
        />
        <TextField
          label="Branch"
          value={values.bank_branch}
          onChange={set('bank_branch')}
          error={fieldErrors.bank_branch}
        />
        <TextField
          label="UPI ID"
          value={values.upi_id}
          onChange={set('upi_id')}
          error={fieldErrors.upi_id}
          hint="Printed as a payment option on invoices."
        />
      </div>
    </Section>
  )
}
