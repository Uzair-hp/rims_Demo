/**
 * Ruchita Interiors — route guard.
 *
 * A UX convenience, not a security control. The backend enforces auth on every
 * endpoint regardless (§16, R9); this only decides what the user sees, so that a
 * signed-out visitor lands on /login instead of a shell full of failing requests.
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider.jsx'

/**
 * A neutral placeholder shown while `/auth/me` is in flight.
 *
 * Rendering the login page during this window would flash the wrong screen at every
 * reload, which is the most visible symptom of getting auth wrong.
 */
function CheckingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
      }}
    >
      <p>Checking your session…</p>
    </div>
  )
}

export function RequireAuth({ children }) {
  const { isAuthenticated, isChecking } = useAuth()
  const location = useLocation()

  if (isChecking) return <CheckingScreen />

  if (!isAuthenticated) {
    // `state.from` lets Login return the user to where they were headed.
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

/**
 * Keeps a signed-in user off the login page.
 *
 * Without this, a signed-in user who navigates to /login sees a form that will
 * only log them out again.
 */
export function RedirectIfAuthenticated({ children }) {
  const { isAuthenticated, isChecking } = useAuth()

  if (isChecking) return <CheckingScreen />
  if (isAuthenticated) return <Navigate to="/" replace />

  return children
}
