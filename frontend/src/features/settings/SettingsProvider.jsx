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
  // Kept so consumers can tell a transport failure from a server error. They are
  // very different problems with very different fixes: "the API is not running"
  // versus "the API answered 500", and collapsing both into one message sends
  // the reader to the wrong place.
  const [error, setError] = useState(null)

  /**
   * Re-read the row. `silent` keeps the current status on screen — after a save
   * or upload the page must not flash back to its skeleton (§20).
   */
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading')
    try {
      const data = await fetchCompanySettings()
      setSettings(data?.settings ?? null)
      setError(null)
      setStatus('ready')
      return data?.settings ?? null
    } catch (caught) {
      // §20: the error is surfaced by consumers that care (the Settings page),
      // while the shell keeps working with the bundled logo.
      if (!silent) {
        setSettings(null)
        setError(caught)
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
        setError(null)
        setStatus('ready')
      } catch (caught) {
        if (cancelled) return
        setSettings(null)
        setError(caught)
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
      /** The last load failure, so consumers can describe it accurately. */
      error,
      logoSrc: logoImageUrl(settings),
      /**
       * No `qrSrc` any more. The UPI QR used to be an uploaded image served from
       * an authenticated route, so it had to be fetched and shared as a URL
       * (§8.5, Phase 8). It is now **generated** from a UPI intent URI for the
       * amount being collected, so there is no image to fetch: consumers build it
       * from `settings.upi_id` via `lib/upi.js`. Live from Settings and never from
       * a document's bank snapshot, which is the property that actually mattered.
       */
      refresh: load,
      /** Merge a freshly saved row into local state without a round trip. */
      applySettings: (row) => {
        if (row) setSettings(row)
      },
    }),
    [settings, status, error, load],
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
