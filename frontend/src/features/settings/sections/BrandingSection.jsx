import { useState } from 'react'
import Button from '../../../components/ui/Button.jsx'
import Section from '../Section.jsx'
import { removeLogo, uploadLogo } from '../../../api/endpoints/settings.js'
import { useSettings } from '../SettingsProvider.jsx'
import styles from '../settings.module.css'

const ACCEPTED = ['png', 'jpg', 'jpeg', 'webp']
const MAX_BYTES = 2 * 1024 * 1024

const offlineMessage = 'No connection — changes not saved.'

/**
 * §15 "Branding" — the company logo (FR-S3).
 *
 * Upload is immediate (no Save button): picking a file *is* the intent, and a
 * two-step upload would only add a way to forget the second step. Validation
 * mirrors the server's — extension and size checked here for a fast answer,
 * magic bytes and MIME checked server-side because the client cannot be
 * trusted (§16).
 *
 * @param {{ notify: (message: string) => void }} props
 */
export default function BrandingSection({ notify }) {
  // The provider owns the row so the sidebar re-renders with the new logo the
  // moment it lands — that is the Phase 3 "logo renders in app shell" exit.
  const { settings, logoSrc, refresh } = useSettings()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const hasLogo = Boolean(settings?.logo_path)

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
      setError('The logo must be 2 MB or smaller.')
      return
    }

    setBusy(true)
    try {
      await uploadLogo(file)
      await refresh({ silent: true })
      notify('Logo uploaded.')
    } catch (requestError) {
      setError(requestError?.offline ? offlineMessage : requestError?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setBusy(true)
    try {
      await removeLogo()
      await refresh({ silent: true })
      notify('Logo removed.')
    } catch (requestError) {
      setError(requestError?.offline ? offlineMessage : requestError?.message || 'Could not remove the logo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Branding"
      description="The company logo used in the app shell and on printed documents."
      headingId="settings-branding"
    >
      <div className={styles.brandRow}>
        <div className={styles.logoBox}>
          {logoSrc ? (
            <img className={styles.logoBoxImage} src={logoSrc} alt="Current company logo" />
          ) : (
            <img className={styles.logoBoxImage} src="/brand/logo.svg" alt="Bundled brand mark" />
          )}
        </div>

        <div className={styles.brandActions}>
          <label className={styles.fieldLabel} htmlFor="settings-logo-file">
            Company logo
          </label>
          <div className={styles.fileRow}>
            <input
              id="settings-logo-file"
              type="file"
              className={styles.fileInput}
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              disabled={busy}
              aria-describedby="settings-logo-hint"
            />
            {hasLogo ? (
              <Button type="button" variant="ghost" size="sm" icon="x" onClick={handleRemove} disabled={busy}>
                Remove logo
              </Button>
            ) : null}
          </div>
          <p className={styles.inlineNote} id="settings-logo-hint">
            {hasLogo
              ? 'Your logo is live in the app shell and on documents.'
              : 'No logo uploaded — the bundled brand mark is in use.'}{' '}
            PNG, JPEG or WEBP, up to 2 MB. SVG is rejected for security.
          </p>
          {error ? (
            <p className={styles.inlineError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
