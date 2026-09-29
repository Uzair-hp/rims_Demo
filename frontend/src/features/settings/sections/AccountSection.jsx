import { useState } from 'react'
import TextField from '../../../components/ui/TextField.jsx'
import Section from '../Section.jsx'
import { changePassword } from '../../../api/endpoints/auth.js'
import styles from '../settings.module.css'

const MIN_PASSWORD = 10

/**
 * §15 "Account & security" — the owner's password change (FR-A2).
 *
 * The server revokes every session (including this one) on success, so the
 * section hands back to `signOut`, which lands on the login screen — staying
 * "signed in" locally after the server revoked the tokens would be exactly the
 * fake-success state §17 forbids.
 *
 * @param {{ signOut: () => Promise<void>, notify: (message: string) => void }} props
 */
export default function AccountSection({ signOut, notify }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return

    const problems = {}
    if (!current) problems.current_password = 'Enter your current password.'
    if (!next) problems.new_password = 'Enter a new password.'
    else if (next.length < MIN_PASSWORD) {
      problems.new_password = `Use at least ${MIN_PASSWORD} characters.`
    } else if (next === current) {
      problems.new_password = 'The new password must be different from the current one.'
    }
    if (confirm !== next) problems.confirm = 'Passwords do not match.'
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems)
      return
    }

    setFieldErrors({})
    setError(null)
    setSaving(true)
    try {
      await changePassword(current, next)
      notify('Password updated — signing you out.')
      setCurrent('')
      setNext('')
      setConfirm('')
      await signOut()
    } catch (requestError) {
      const details = (requestError?.details || []).filter((detail) => detail.field)
      if (details.length > 0) {
        setFieldErrors(Object.fromEntries(details.map((detail) => [detail.field, detail.message])))
      }
      setError(
        requestError?.offline
          ? 'No connection — changes not saved.'
          : requestError?.message || 'Could not change the password.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Account & security"
      description="Changing your password signs out every session, including this one."
      headingId="settings-account"
      form={{ submitting: saving, saved: false, error, handleSubmit }}
      saveLabel="Change password"
    >
      <TextField
        label="Current password"
        value={current}
        onChange={setCurrent}
        error={fieldErrors.current_password}
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        label="New password"
        value={next}
        onChange={setNext}
        error={fieldErrors.new_password}
        hint={`At least ${MIN_PASSWORD} characters.`}
        type="password"
        autoComplete="new-password"
        required
      />
      <TextField
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        error={fieldErrors.confirm}
        type="password"
        autoComplete="new-password"
        required
      />
      <p className={styles.inlineNote}>
        For your safety, the system has no password reset by email — keep the new password safe.
      </p>
    </Section>
  )
}
