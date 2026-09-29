import { useState } from 'react'
import Button from '../../../components/ui/Button.jsx'
import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { removePaymentQr, uploadPaymentQr } from '../../../api/endpoints/settings.js'
import { useSettings } from '../SettingsProvider.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

const FIELDS = ['bank_account_name', 'bank_account_number', 'bank_name', 'bank_ifsc', 'bank_branch', 'upi_id']

// Mirrors the server's shared image policy (§15/§16) for a fast local answer.
// Magic bytes and MIME are still checked server-side, because the client cannot
// be trusted.
const ACCEPTED = ['png', 'jpg', 'jpeg', 'webp']
const MAX_BYTES = 2 * 1024 * 1024

const offlineMessage = 'No connection — changes not saved.'

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
 * The UPI QR upload control (§8.5), shown as a subsection of Payment & bank.
 *
 * Upload is immediate rather than Save-driven, matching Branding: choosing a
 * file is the intent, and a second "Save" step is only another way to forget it.
 * Its own status text sits beside it instead of in the section footer, so an
 * upload failure is never reported as a failed save of the bank fields.
 *
 * The QR is **not** part of the snapshot: invoices read it live. That is a
 * deliberate asymmetry with every field above, and the copy says so.
 */
function PaymentQrControl({ qrSrc, onChanged }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const hasQr = Boolean(qrSrc)

  async function handleFile(event) {
    const input = event.target
    const file = input.files?.[0]
    // Reset first, so re-picking the same file after a failure still fires.
    input.value = ''
    if (!file) return

    setError(null)
    const extension = (file.name.split('.').pop() || '').toLowerCase()
    if (!ACCEPTED.includes(extension)) {
      setError('Use a PNG, JPEG or WEBP image. SVG files are not accepted for security reasons.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('The payment QR must be 2 MB or smaller.')
      return
    }

    setBusy(true)
    try {
      await uploadPaymentQr(file)
      await onChanged()
    } catch (requestError) {
      setError(requestError?.offline ? offlineMessage : requestError?.message || 'The upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setBusy(true)
    try {
      await removePaymentQr()
      await onChanged()
    } catch (requestError) {
      setError(
        requestError?.offline ? offlineMessage : requestError?.message || 'Could not remove the payment QR.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.subsection}>
      <h3 className={styles.subsectionTitle}>UPI QR code</h3>
      <div className={styles.brandRow}>
        <div className={styles.qrBox}>
          {qrSrc ? (
            <img className={styles.qrBoxImage} src={qrSrc} alt="Current UPI payment QR code" />
          ) : (
            <span className={styles.qrBoxEmpty}>No QR</span>
          )}
        </div>
        <div className={styles.brandActions}>
          <label className={styles.fieldLabel} htmlFor="settings-payment-qr-file">
            UPI QR code
          </label>
          <div className={styles.fileRow}>
            <input
              id="settings-payment-qr-file"
              type="file"
              className={styles.fileInput}
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              disabled={busy}
              aria-describedby="settings-payment-qr-hint"
            />
            {hasQr ? (
              <Button type="button" variant="ghost" size="sm" icon="x" onClick={handleRemove} disabled={busy}>
                Remove QR
              </Button>
            ) : null}
          </div>
          <p className={styles.inlineNote} id="settings-payment-qr-hint">
            {hasQr
              ? 'Printed on invoices, read live from Settings.'
              : 'No QR uploaded — invoices show the UPI ID as text only.'}{' '}
            PNG, JPEG or WEBP, up to 2 MB. SVG is rejected for security.
          </p>
          <p className={styles.inlineNote}>
            Unlike the bank details above, the QR is never snapshotted onto an invoice: replacing it here
            immediately changes what already-issued invoices show, so an old QR can never point customers at a
            closed account.
          </p>
          {error ? (
            <p className={styles.inlineError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
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
  const { qrSrc, refresh } = useSettings()

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

      <PaymentQrControl qrSrc={qrSrc} onChanged={() => refresh({ silent: true })} />
    </Section>
  )
}
