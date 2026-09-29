import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { companySave, useFormValues, useSectionForm } from '../useSettingsForm.js'

const FIELDS = ['footer_text', 'signatory_name']

function validate(values) {
  const footer = String(values.footer_text || '')
  if (footer.length > 500) {
    return { footer_text: 'Keep the footer under 500 characters.' }
  }
  return null
}

/**
 * §15 "Document / footer" — the closing block of printed documents.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function DocumentFooterSection({ settings, onSaved }) {
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
      title="Document & footer"
      description="Text that closes every printed document, and the signatory above the signature line."
      headingId="settings-document"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <TextField
        as="textarea"
        label="Footer text"
        value={values.footer_text}
        onChange={set('footer_text')}
        error={fieldErrors.footer_text}
        hint="Shown at the bottom of quotations and invoices. 500 characters maximum."
        maxLength={500}
        rows={3}
      />
      <TextField
        label="Signatory name"
        value={values.signatory_name}
        onChange={set('signatory_name')}
        error={fieldErrors.signatory_name}
        hint="Name printed above the signature line on documents."
      />
    </Section>
  )
}
