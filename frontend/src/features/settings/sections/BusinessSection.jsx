import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'
import styles from '../settings.module.css'

const FIELDS = [
  'company_name',
  'tagline',
  'phone',
  'email',
  'website',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'pincode',
  'gstin',
]

// Deliberately permissive: this address is printed on documents, not used to
// deliver mail, so a corporate address without a dot-TLD must still pass.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(values) {
  const problems = {}
  if (!String(values.company_name || '').trim()) {
    problems.company_name = 'A company name is required.'
  }
  const email = String(values.email || '').trim()
  if (email && !EMAIL_SHAPE.test(email)) {
    problems.email = 'Enter a valid email address.'
  }
  return problems
}

/**
 * §15 "Business information" — who the company is on every document.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function BusinessSection({ settings, onSaved }) {
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
      title="Business information"
      description="Company identity and contact details, printed on quotations and invoices."
      headingId="settings-business"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <div className={styles.fieldGrid}>
        <TextField
          label="Company name"
          value={values.company_name}
          onChange={set('company_name')}
          error={fieldErrors.company_name}
          autoComplete="organization"
          required
        />
        <TextField
          label="Tagline"
          value={values.tagline}
          onChange={set('tagline')}
          error={fieldErrors.tagline}
          hint="Short line under the brand, if any."
        />
        <TextField
          label="Phone"
          value={values.phone}
          onChange={set('phone')}
          error={fieldErrors.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
        />
        <TextField
          label="Email"
          value={values.email}
          onChange={set('email')}
          error={fieldErrors.email}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <TextField
          label="Website"
          value={values.website}
          onChange={set('website')}
          error={fieldErrors.website}
          inputMode="url"
          placeholder="ruchitainteriors.in"
        />
        <TextField
          label="GSTIN"
          value={values.gstin}
          onChange={(next) => set('gstin')(next.toUpperCase())}
          error={fieldErrors.gstin}
          maxLength={15}
          hint="15-character GST number, if registered."
        />
        <TextField
          label="Address line 1"
          value={values.address_line1}
          onChange={set('address_line1')}
          error={fieldErrors.address_line1}
          autoComplete="address-line1"
          className={styles.span2}
        />
        <TextField
          label="Address line 2"
          value={values.address_line2}
          onChange={set('address_line2')}
          error={fieldErrors.address_line2}
          autoComplete="address-line2"
          className={styles.span2}
        />
        <TextField label="City" value={values.city} onChange={set('city')} error={fieldErrors.city} />
        <TextField label="State" value={values.state} onChange={set('state')} error={fieldErrors.state} />
        <TextField
          label="Pincode"
          value={values.pincode}
          onChange={set('pincode')}
          error={fieldErrors.pincode}
          inputMode="numeric"
          maxLength={12}
          autoComplete="postal-code"
        />
      </div>
    </Section>
  )
}
