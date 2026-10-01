/**
 * Ruchita Interiors — login screen (FR-A1).
 *
 * Chrome-less by design (§18.6) — no sidebar, no bottom bar. The layout is
 * mobile-first and single-column; from `lg` the brand panel appears on the
 * left, carrying the gold-on-ink logo (`/brand/logo.svg` via the shared
 * BrandLockup — never a PNG wordmark) beside the form. Structure follows the
 * authentication flow: brand → heading → supporting line → email → password
 * with a reveal control → primary action → messaging.
 *
 * Failure handling is deliberate: the API returns one generic message for a
 * wrong email and a wrong password, so this screen must not try to be clever
 * about which was wrong. The only field-level errors shown are (a) the
 * client's own empty/format checks, which cost no request, and (b) the ones
 * the server identified per field (§9.1 `details`).
 */

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BrandLockup from '../../components/layout/BrandLockup.jsx'
import Button from '../../components/ui/Button.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { useAuth } from './AuthProvider.jsx'
import styles from './Login.module.css'

// Permissive enough for corporate addresses, strict enough to catch typos.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return

    setFormError(null)

    // Client-side first: an empty form must not cost a round trip, and the
    // message belongs under the field that is wrong (§20).
    const problems = {}
    const trimmedEmail = email.trim()
    if (!trimmedEmail) problems.email = 'Enter your email address.'
    else if (!EMAIL_SHAPE.test(trimmedEmail)) problems.email = 'Enter a valid email address.'
    if (!password) problems.password = 'Enter your password.'
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems)
      return
    }

    setFieldErrors({})
    setSubmitting(true)

    try {
      await signIn(trimmedEmail, password)
      // Return to wherever the guard interrupted, or the dashboard.
      const destination = location.state?.from?.pathname || '/'
      navigate(destination, { replace: true })
    } catch (requestError) {
      if (requestError?.offline) {
        setFormError('Cannot reach the server. Check your connection and try again.')
      } else if (requestError?.status === 401) {
        // Intentionally the same message the server sent: naming the cause would
        // tell an attacker whether the account exists.
        setFormError(requestError.message)
      } else if (requestError?.details?.length) {
        setFieldErrors(
          Object.fromEntries(requestError.details.filter((d) => d.field).map((d) => [d.field, d.message])),
        )
      } else {
        setFormError(requestError?.message || 'Sign-in failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const emailError = fieldErrors.email || null
  const passwordError = fieldErrors.password || null

  return (
    <main className={styles.page} id="main-content">
      {/* Desktop brand panel: hidden below lg, where the compact plate on top
          of the form carries the brand instead (§19 mobile-first). */}
      <aside className={styles.brandPanel}>
        <div className={styles.panelTop}>
          <BrandLockup variant="login" height={56} />
          <p className={styles.panelHeadline}>
            Quotations, invoices and clients, one calm place to run the studio.
          </p>
        </div>

        <ul className={styles.panelPoints}>
          <li>
            <Icon name="fileText" size={20} />
            <span>Brand-styled quotations, ready to send in minutes</span>
          </li>
          <li>
            <Icon name="receipt" size={20} />
            <span>Invoices and payments tracked to the last rupee</span>
          </li>
          <li>
            <Icon name="users" size={20} />
            <span>Every client&apos;s history in one directory</span>
          </li>
        </ul>

        <p className={styles.panelFoot}>© Ruchita Interiors</p>
      </aside>

      <div className={styles.formPane}>
        <div className={styles.formCol}>
          <div className={styles.mobileBrand}>
            <header className={styles.mobileHeader}>
              <BrandLockup variant="login" height={40} />
            </header>
          </div>

          <header className={styles.header}>
            <h1 className={styles.title}>Sign in</h1>
            <span className={styles.titleRule} aria-hidden="true" />
            <p className={styles.subtitle}>
              Ruchita Interiors keeps quotations, invoices and clients in one place.
            </p>
          </header>

          {formError ? (
            <p className={styles.formError} role="alert">
              <span className={styles.formErrorIcon} aria-hidden="true">
                <Icon name="alert" size={16} />
              </span>
              <span>{formError}</span>
            </p>
          ) : null}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="login-email">
                Email
              </label>
              <div className={styles.inputWrap}>
                <span className={styles.inputIcon} aria-hidden="true">
                  <Icon name="mail" size={20} />
                </span>
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={`${styles.input} ${emailError ? styles.inputInvalid : ''}`.trim()}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  required
                  aria-invalid={emailError ? 'true' : undefined}
                  aria-describedby={emailError ? 'login-email-error' : undefined}
                />
              </div>
              {emailError ? (
                <span className={styles.fieldError} id="login-email-error" role="alert">
                  {emailError}
                </span>
              ) : null}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="login-password">
                Password
              </label>
              <div className={styles.passwordWrap}>
                <span className={`${styles.inputIcon} ${styles.passwordIcon}`} aria-hidden="true">
                  <Icon name="lock" size={20} />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  className={`${styles.input} ${styles.passwordInput} ${passwordError ? styles.inputInvalid : ''}`.trim()}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  required
                  aria-invalid={passwordError ? 'true' : undefined}
                  aria-describedby={passwordError ? 'login-password-error' : undefined}
                />
                <button
                  type="button"
                  className={styles.reveal}
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={submitting}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
                </button>
              </div>
              {passwordError ? (
                <span className={styles.fieldError} id="login-password-error" role="alert">
                  {passwordError}
                </span>
              ) : null}
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className={styles.note}>
            This system is for Ruchita Interiors only. If you have lost your password, contact the
            administrator to reset it.
          </p>
        </div>
      </div>
    </main>
  )
}
