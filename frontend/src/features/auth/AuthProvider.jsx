/**
 * Ruchita Interiors — auth context.
 *
 * Holds the one piece of state the whole app depends on: is there a session, and
 * who is signed in.
 *
 * The server is the authority. On mount this calls GET /auth/me, so a reload or a
 * fresh browser restore the session from the refresh cookie without a login form.
 * `RequireAuth` redirects on `status === 'anonymous'`.
 *
 * `client.js` handles token refresh transparently, so nothing here deals with
 * tokens - only with "is there a user".
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as authApi from '../../api/endpoints/auth.js'

/** @typedef {{ id: number, email: string, name: string, role: string }} AuthUser */

const AuthContext = createContext(null)

/** 'checking' avoids flashing the login page before /auth/me has answered. */
const INITIAL_STATUS = 'checking'

export function AuthProvider({ children, initialUser = null }) {
  // An injected user (tests, storybook) seeds the state directly, so there is no
  // status flip and no network call on mount.
  const [user, setUser] = useState(initialUser)
  const [status, setStatus] = useState(initialUser ? 'authenticated' : INITIAL_STATUS)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (initialUser) return

    let cancelled = false

    async function resolveSession() {
      // A CSRF token is needed for the logout/refresh calls that follow, and
      // getting it early keeps the first mutation from failing with a 403.
      await authApi.bootstrapCsrf()

      try {
        const data = await authApi.fetchCurrentUser()
        if (cancelled) return
        setUser(data.user)
        setStatus('authenticated')
      } catch (requestError) {
        if (cancelled) return
        // 401 is the expected answer for a signed-out visitor, not a failure.
        // Anything else (server down) is surfaced so the shell can say so.
        if (requestError?.status === 401) {
          setUser(null)
          setStatus('anonymous')
        } else {
          setError(requestError)
          setStatus('anonymous')
        }
      }
    }

    resolveSession()

    return () => {
      cancelled = true
    }
  }, [initialUser])

  const signIn = useCallback(async (email, password) => {
    setError(null)
    try {
      const data = await authApi.login(email, password)
      setUser(data.user)
      setStatus('authenticated')
      return data.user
    } catch (requestError) {
      setError(requestError)
      throw requestError
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Even if the server call fails, the cookies must not be trusted locally, so
      // the local session is dropped either way.
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      status,
      error,
      isAuthenticated: status === 'authenticated',
      isChecking: status === INITIAL_STATUS,
      signIn,
      signOut,
    }),
    [user, status, error, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}

export { AuthContext }
