import { useEffect, useState } from 'react'
import Button from '../../../components/ui/Button.jsx'
import Checkbox from '../../../components/ui/Checkbox.jsx'
import TextField from '../../../components/ui/TextField.jsx'
import Section from '../Section.jsx'
import { createTerm, deleteTerm, fetchTerms, updateTerm } from '../../../api/endpoints/settings.js'
import styles from '../settings.module.css'

const SCOPES = [
  { value: 'quotation', label: 'Quotations' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'both', label: 'Quotations & invoices' },
]

const SCOPE_LABEL = Object.fromEntries(SCOPES.map((scope) => [scope.value, scope.label]))

const EMPTY_DRAFT = { title: '', scope: 'both', body: '', is_default: false }

const offlineMessage = 'No connection — changes not saved.'

/**
 * §15 "Terms & Conditions" (FR-S4) — the CRUD list behind document snapshots.
 *
 * New documents copy the default entry for their scope into `terms_text`
 * (Phase 5+); editing a term afterwards never rewrites an issued document
 * (§8.4). Exclusivity follows the server's rule: promoting a default demotes
 * the previous default *of the same scope*, so after any save the list here is
 * merged locally to mirror that exactly — no second round trip, no stale flags.
 *
 * @param {{ notify: (message: string) => void }} props
 */
export default function TermsSection({ notify }) {
  const [terms, setTerms] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(null)
  const [editingId, setEditingId] = useState(null) // null = closed, 'new' = creating
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    // Initial load, declared inside the effect (AuthProvider pattern) so the
    // linter can see every setState happens after the await.
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchTerms()
        if (cancelled) return
        setTerms(data?.terms ?? [])
        setListError(null)
      } catch (requestError) {
        if (cancelled) return
        setListError(
          requestError?.offline ? offlineMessage : requestError?.message || 'Could not load terms.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openNew = () => {
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
    setEditingId('new')
  }

  const openEdit = (term) => {
    setDraft({
      title: term.title,
      scope: term.scope,
      body: term.body,
      is_default: Boolean(term.is_default),
    })
    setFieldErrors({})
    setFormError(null)
    setEditingId(term.id)
  }

  const cancel = () => setEditingId(null)

  const set = (key) => (value) => setDraft((previous) => ({ ...previous, [key]: value }))

  /** Mirror of the server's `_promote_default`: one default per scope. */
  const mergeSaved = (saved) =>
    setTerms((previous) => {
      const exists = previous.some((entry) => entry.id === saved.id)
      const next = exists
        ? previous.map((entry) => (entry.id === saved.id ? saved : entry))
        : [...previous, saved]
      if (!saved.is_default) return next
      return next.map((entry) =>
        entry.id !== saved.id && entry.scope === saved.scope && entry.is_default
          ? { ...entry, is_default: false }
          : entry,
      )
    })

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving || editingId === null) return

    const problems = {}
    if (!draft.title.trim()) problems.title = 'A title is required.'
    if (!draft.body.trim()) problems.body = 'The terms text is required.'
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems)
      return
    }

    setFieldErrors({})
    setFormError(null)
    setSaving(true)

    const payload = {
      scope: draft.scope,
      title: draft.title.trim(),
      body: draft.body.trim(),
      is_default: draft.is_default,
    }

    try {
      const data = editingId === 'new' ? await createTerm(payload) : await updateTerm(editingId, payload)
      if (data?.term) mergeSaved(data.term)
      setEditingId(null)
      notify('Terms saved.')
    } catch (requestError) {
      const details = (requestError?.details || []).filter((detail) => detail.field)
      if (details.length > 0) {
        setFieldErrors(Object.fromEntries(details.map((detail) => [detail.field, detail.message])))
      }
      setFormError(
        requestError?.offline ? offlineMessage : requestError?.message || 'Could not save the terms.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(term) {
    setFormError(null)
    try {
      await deleteTerm(term.id)
      setTerms((previous) => previous.filter((entry) => entry.id !== term.id))
      if (editingId === term.id) setEditingId(null)
      notify('Terms entry removed.')
    } catch (requestError) {
      setListError(requestError?.offline ? offlineMessage : requestError?.message || 'Could not delete.')
    }
  }

  return (
    <Section
      title="Terms & conditions"
      description="Default text copied into new documents. Editing one later never changes an issued document."
      headingId="settings-terms"
      form={{ submitting: saving, saved: false, error: formError, handleSubmit }}
      saveLabel={editingId === 'new' ? 'Add terms' : editingId !== null ? 'Save changes' : null}
    >
      {listError ? (
        <p className={styles.inlineError} role="alert">
          {listError}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.inlineNote}>Loading terms…</p>
      ) : terms.length === 0 && editingId === null ? (
        <p className={styles.inlineNote}>
          No terms yet. Add a default set — new quotations and invoices start from it.
        </p>
      ) : (
        <ul className={styles.termList}>
          {terms.map((term) => (
            <li key={term.id} className={styles.termItem}>
              <div className={styles.termHead}>
                <span className={styles.termTitle}>{term.title}</span>
                <span className={styles.badge}>{SCOPE_LABEL[term.scope] || term.scope}</span>
                {term.is_default ? (
                  <span className={`${styles.badge} ${styles.badgeDefault}`}>Default</span>
                ) : null}
              </div>
              <p className={styles.termBody}>{term.body}</p>
              <div className={styles.termActions}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => (editingId === term.id ? cancel() : openEdit(term))}
                >
                  {editingId === term.id ? 'Close' : 'Edit'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(term)}
                  disabled={saving}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId !== null ? (
        <div className={styles.termForm}>
          <TextField
            label="Title"
            value={draft.title}
            onChange={set('title')}
            error={fieldErrors.title}
            placeholder="Standard terms"
            required
          />
          <TextField
            as="select"
            label="Scope"
            value={draft.scope}
            onChange={set('scope')}
            error={fieldErrors.scope}
          >
            {SCOPES.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </TextField>
          <TextField
            as="textarea"
            label="Body"
            value={draft.body}
            onChange={set('body')}
            error={fieldErrors.body}
            hint="One numbered line per paragraph, as it should print on the document."
            rows={6}
            required
          />
          <Checkbox
            label="Use as the default for this scope"
            checked={draft.is_default}
            onChange={(next) => set('is_default')(next)}
          />
          <div className={styles.termFormActions}>
            <Button type="button" variant="secondary" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="secondary" icon="plus" onClick={openNew}>
            Add terms
          </Button>
        </div>
      )}
    </Section>
  )
}
