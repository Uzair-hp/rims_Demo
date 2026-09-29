import { useState } from 'react'
import Section from '../Section.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import { saveCompanySettings } from '../../../api/endpoints/settings.js'
import { useSectionForm } from '../useSettingsForm.js'

const MAX_LABELS = 50
const MAX_LABEL_LENGTH = 100

const toLines = (list) => (Array.isArray(list) ? list.join('\n') : '')
const toList = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function validate(lines) {
  const problems = {}
  for (const [field, text] of Object.entries(lines)) {
    const labels = toList(text)
    if (labels.length > MAX_LABELS) {
      problems[field] = `Use at most ${MAX_LABELS} labels.`
    } else if (labels.some((label) => label.length > MAX_LABEL_LENGTH)) {
      problems[field] = `Keep every label under ${MAX_LABEL_LENGTH} characters.`
    }
  }
  return Object.keys(problems).length > 0 ? problems : null
}

/**
 * §15 "Catalogue (S)" — the suggestion lists behind the quotation editor.
 *
 * Stored as JSON arrays on the settings row (§8.3), edited here as one label
 * per line: the most direct mobile-friendly list editor there is.
 *
 * @param {{ settings: object, onSaved?: (row: object) => void }} props
 */
export default function CatalogueSection({ settings, onSaved }) {
  const [categories, setCategories] = useState(() => toLines(settings?.item_categories))
  const [units, setUnits] = useState(() => toLines(settings?.units))

  const { submitting, saved, error, fieldErrors, handleSubmit } = useSectionForm({
    save: async () => {
      const data = await saveCompanySettings({
        item_categories: toList(categories),
        units: toList(units),
      })
      return data?.settings
    },
    validate: () => validate({ item_categories: categories, units }),
    onSaved: (row) => {
      if (row) {
        setCategories(toLines(row.item_categories))
        setUnits(toLines(row.units))
      }
      onSaved?.(row)
    },
  })

  return (
    <Section
      title="Catalogue"
      description="Suggestion lists for the quotation editor — item categories and units of measure."
      headingId="settings-catalogue"
      form={{ submitting, saved, error, handleSubmit }}
    >
      <TextField
        as="textarea"
        label="Item categories"
        value={categories}
        onChange={setCategories}
        error={fieldErrors.item_categories}
        hint="One per line. These become the category chips when building quotations."
        rows={7}
      />
      <TextField
        as="textarea"
        label="Units"
        value={units}
        onChange={setUnits}
        error={fieldErrors.units}
        hint="One per line — sq.ft, running ft, no., and so on."
        rows={5}
      />
    </Section>
  )
}
