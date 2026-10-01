/**
 * Ruchita Interiors — client form (§4.2).
 *
 * Shared by the create and edit modals, and by the picker's inline "create as
 * new" path, so one set of fields and one set of rules serve all three. There is
 * no second copy of the phone logic here: `lib/phone.js` owns the rules and
 * `lib/money`-style formatting is the only thing this file adds.
 *
 * The phone field is the interesting one. It is required, it is `type="tel"`
 * with a numeric keypad, it groups itself as the user types, it takes a pasted
 * `+91 90000 12345` and quietly turns it into ten digits, and it validates on
 * **blur** rather than on every keystroke — because `90000` is a legitimate
 * intermediate state, not a wrong one, and complaining mid-number is the single
 * most annoying thing a form can do.
 */

import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import TextField from '../../components/ui/TextField.jsx'
import { groupPhoneAsTyped, isValidPhone, normalizePhone, phoneDigits } from '../../lib/phone.js'
import styles from './ClientForm.module.css'

// The optional fields. `name` and `phone` are rendered explicitly above the
// map because both need behaviour the plain loop cannot give them: the name has
// a local validity rule, and the phone needs its `+91` prefix and its grouping.
const FIELDS = [
  { key: 'email', label: 'Email', type: 'email', inputMode: 'email' },
  { key: 'address', label: 'Billing address', as: 'textarea' },
  { key: 'project_address', label: 'Project address', as: 'textarea' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'notes', label: 'Notes', as: 'textarea' },
]

const EMPTY = { name: '', phone: '', email: '', address: '', project_address: '', gstin: '', notes: '' }

const PHONE_ERROR = 'Enter a valid 10-digit Indian mobile number'

/**
 * @param {{
 *   initial?: object,
 *   errors?: Record<string, string>,
 *   onSave: (draft: object) => void,
 *   submitting?: boolean,
 * }} props
 */
export default function ClientForm({ initial = {}, errors: serverErrors = {}, onSave, submitting = false }) {
  // Seeded values are normalised on the way in, so an edit form shows
  // `90000 12345` rather than the raw `9000012345` the API sent. Without this the
  // field would present differently depending on whether the user had typed in
  // it, which is its own small confusion.
  const [values, setValues] = useState(() => ({
    ...EMPTY,
    ...initial,
    phone: initial.phone ? groupPhoneAsTyped(phoneDigits(initial.phone)) : (initial.phone ?? ''),
  }))
  const [touched, setTouched] = useState({})

  const nameValid = values.name.trim().length > 0
  const phoneValid = isValidPhone(values.phone)
  const formValid = nameValid && phoneValid

  const nameError = touched.name && !nameValid ? 'A client name is required.' : undefined
  const phoneError =
    touched.phone && !phoneValid
      ? PHONE_ERROR
      : // A server message for phone is authoritative (a 409 duplicate names the
        // client that holds it, which no local rule can know).
        serverErrors.phone

  const handleChange = (field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (field === 'name' && value.trim().length > 0) setTouched((t) => ({ ...t, name: false }))
    if (field === 'phone' && isValidPhone(value)) setTouched((t) => ({ ...t, phone: false }))
  }

  // Grouping happens on the way in, so a paste and a keystroke take the same
  // path. `groupPhoneAsTyped` also strips `+91`, spaces and dashes, which is
  // what makes "+91 90000 12345" pasted into the field land as `90000 12345`.
  const handlePhoneChange = (value) => {
    handleChange('phone', groupPhoneAsTyped(value))
  }

  // Blur is what marks a field touched, so a rule can be shown. A paste is
  // handled the same way but *does* strip a country code: a pasted value is
  // complete by definition, so there is no mid-typing state to protect and
  // `+91 90000 12345` should land as the ten digits it stands for. Typing
  // deliberately does not (see `groupPhoneAsTyped`), because a keystroke stream
  // passes through the two-digit state `+9`.
  const handlePhonePaste = (event) => {
    const pasted = event.clipboardData?.getData('text') ?? ''
    if (!pasted) return
    event.preventDefault()
    handleChange('phone', groupPhoneAsTyped(phoneDigits(pasted)))
  }

  const handleBlur = (field) => () => setTouched((t) => ({ ...t, [field]: true }))

  const handleSubmit = (event) => {
    event.preventDefault()
    // Mark everything touched so the messages appear against the fields rather
    // than only in a summary the user has to find.
    setTouched({ name: true, phone: true })
    if (!formValid) return
    // The stored form is ten bare digits, whatever the field currently shows.
    onSave({ ...values, phone: normalizePhone(values.phone) })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <TextField
        label="Client name"
        name="name"
        value={values.name}
        onChange={(value) => handleChange('name', value)}
        maxLength={200}
        required
        onBlur={handleBlur('name')}
        error={nameError || serverErrors.name}
      />

      {/* The `+91` is a fixed prefix inside the field, not part of the value:
          the stored number is bare digits, so the country code would be a lie
          if it were submitted. See `lib/phone.js`. */}
      <div className={styles.phoneField}>
        <span className={styles.phonePrefix} aria-hidden="true">
          +91
        </span>
        <TextField
          className={styles.phoneInput}
          label="Phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={14}
          value={values.phone}
          onChange={handlePhoneChange}
          onPaste={handlePhonePaste}
          onBlur={handleBlur('phone')}
          required
          error={phoneError}
        />
      </div>

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
          error={serverErrors[field.key]}
        />
      ))}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={submitting} disabled={!formValid || submitting}>
          Save client
        </Button>
      </div>
    </form>
  )
}
