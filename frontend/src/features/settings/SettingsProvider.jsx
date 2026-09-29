/**
 * Ruchita Interiors — company settings context (§15, §17).
 *
 * Fetches `GET /settings/company` once when the authenticated shell mounts and
 * hands the row to everything inside it: the sidebar reads the uploaded logo,
 * and the Settings page reads and refreshes the same state after each save.
 *
 * A failed load is not fatal — the shell falls back to the bundled brand mark
 * and the Settings page shows a retry state (§20). Settings are fetched once
 * per session (no polling): §17 keeps settings cached longer than anything else,
 * and a save already writes the fresh row back into this state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchCompanySettings, logoImageUrl } from '../../api/endpoints/settings.js'

const SettingsContext = createContext(null)

/** 'loading' → 'ready' | 'error'. Ready with a null row only happens on a malformed payload. */
const INITIAL_STATUS = 'loading'

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [status, setStatus] = useState(INITIAL_STATUS)

  /**
   * Re-read the row. `silent` keeps the current status on screen — after a save
   * or upload the page must not flash back to its skeleton (§20).
   */
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading')
    try {
      const data = await fetchCompanySettings()
      setSettings(data?.settings ?? null)
      setStatus('ready')
      return data?.settings ?? null
    } catch {
      // §20: the error is surfaced by consumers that care (the Settings page),
      // while the shell keeps working with the bundled logo.
      if (!silent) {
        setSettings(null)
        setStatus('error')
      }
      return null
    }
  }, [])

  useEffect(() => {
    // Declared inline (the AuthProvider pattern): a function defined *inside*
    // the effect may setState after its await, while calling one defined in
    // component scope reads as a synchronous update to the linter.
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchCompanySettings()
        if (cancelled) return
        setSettings(data?.settings ?? null)
        setStatus('ready')
      } catch {
        if (cancelled) return
        setSettings(null)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      settings,
      status,
      isLoading: status === INITIAL_STATUS,
      isError: status === 'error',
      logoSrc: logoImageUrl(settings),
      refresh: load,
      /** Merge a freshly saved row into local state without a round trip. */
      applySettings: (row) => {
        if (row) setSettings(row)
      },
    }),
    [settings, status, load],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used inside a SettingsProvider')
  }
  return context
}
