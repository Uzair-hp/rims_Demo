import { createContext, createElement, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'ri.theme'
const THEMES = ['system', 'light', 'dark']
const DARK_QUERY = '(prefers-color-scheme: dark)'
const ThemeContext = createContext(null)

/**
 * Subscribes to the operating system colour preference.
 *
 * `useSyncExternalStore` rather than an effect plus state: the browser owns this
 * value, so reading it during render keeps the theme right on the first paint and
 * avoids a cascading render when the OS preference changes mid-session.
 *
 * @returns {'light' | 'dark'}
 */
export function useSystemTheme() {
  const subscribe = useCallback((onStoreChange) => {
    const media = window.matchMedia(DARK_QUERY)
    media.addEventListener('change', onStoreChange)
    return () => media.removeEventListener('change', onStoreChange)
  }, [])

  const getSnapshot = useCallback(() => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'), [])
  const getServerSnapshot = useCallback(() => 'light', [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** @returns {'system' | 'light' | 'dark'} */
function readStoredTheme() {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return THEMES.includes(/** @type {string} */ (stored)) ? /** @type {any} */ (stored) : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Theme state: system default plus a manual override, persisted locally (§18.7).
 *
 * The pre-paint script in index.html sets the same `data-theme` attribute before
 * React runs, so a stored dark theme never flashes white on reload.
 */
function useThemeState() {
  const [theme, setThemeState] = useState(readStoredTheme)
  const systemTheme = useSystemTheme()
  const resolvedTheme = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable (private mode): the session default still applies */
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  return { theme, resolvedTheme, setTheme, toggleTheme }
}

export function ThemeProvider({ children }) {
  const value = useThemeState()
  return createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme() {
  const value = useContext(ThemeContext)
  // Keep isolated route/component tests and embedded consumers usable without
  // requiring them to recreate the full application provider tree.
  const fallback = useThemeState()
  return value || fallback
}
