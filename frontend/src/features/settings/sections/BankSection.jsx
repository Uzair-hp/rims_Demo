import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

const FIELDS = ['bank_account_name', 'bank_account_number', 'bank_name', 'bank_ifsc', 'bank_branch', 'upi_id']

/**
 * §15: this block is snapshotted onto invoices at conversion (§8.4), so the IFSC is
 * validated as the exact 11 characters banks issue — an empty value simply means
 * "not filled in yet".
 *
 * The UPI ID is checked for shape only (an "@", text either side, no spaces). Same
 * rule as the server's `validate_upi_id`, and for the same reason: the provider
 * suffix is not an enumerable set, so a stricter check would block legitimate
 * accounts.
 */
function validate(values) {
  const ifsc = String(values.bank_ifsc || '').trim()
  if (ifsc && ifsc.length !== 11) {
    return { bank_ifsc: 'IFSC must be exactly 11 characters.' }
  }

  const upi = String(values.upi_id || '').trim()
  if (upi) {
    if (/\s/.test(upi)) {
      return { upi_id: 'The UPI ID cannot contain spaces.' }
    }
    if (!upi.includes('@')) {
      return { upi_id: 'Use the form business@okaxis, or your bank’s own handle.' }
    }
    if (!upi.split('@')[0] || !upi.split('@').slice(1).join('@')) {
      return { upi_id: 'The UPI ID needs text on both sides of the @.' }
    }
  }

  return null
}

/**
 * §15 "Payment / bank" — details printed on the invoice and snapshotted at
 * conversion so later edits never rewrite an issued invoice.
 *
 * The UPI ID is the only field here with teeth: the QR is now **generated** from it
 * (§8.5, amended from Phase 8's uploaded image), so a typo does not produce a bad
 * document, it directs a customer's payment to a handle that does not exist. The
 * check is deliberately permissive — a provider suffix is not a fixed list, and
 * rejecting a real one would block a real payment — and mirrors the server's own
 * `validate_upi_id` so the user is told before a round trip.
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
          maxLength={100}
          hint="Generates the scannable QR on invoices. Leave empty to print the ID as text only."
        />
      </div>

      {/* Why the QR needs no upload. Phase 8 stored an owner-uploaded image; it is
          generated now (§8.5, amended), so a customer can never scan a code that
          still asks for a total they have already paid. */}
      <p className={styles.inlineNote}>
        The UPI QR is generated from this ID and the outstanding balance, so it always asks for what is
        actually owed. Nothing to upload, and a printed invoice can no longer over-collect.
      </p>
    </Section>
  )
}
