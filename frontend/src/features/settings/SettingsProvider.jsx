/**
 * Ruchita Interiors — settings context (placeholder).
 *
 * `routes.jsx` wraps the authenticated shell in `SettingsProvider`, and
 * `Sidebar` reads `logoSrc` from it (Phase 3: the uploaded company logo renders
 * in the app shell). The settings/upload API is not built yet, so this provider
 * supplies `logoSrc: null` — `BrandLockup` then keeps its bundled vector, so the
 * brand slot is never empty (§20).
 *
 * When the settings endpoints land, fetch the settings row here (mirroring
 * `AuthProvider`'s GET /auth/me pattern) and expose the real logo URL.
 */

import { createContext, useContext, useMemo } from 'react'

/** @typedef {{ logoSrc: string | null }} SettingsValue */

const SettingsContext = createContext(null)

export function SettingsProvider({ children, value }) {
  // Until the settings API exists, there is no uploaded logo; null makes
  // BrandLockup fall back to the bundled mark.
  const resolved = useMemo(() => ({ logoSrc: null, ...value }), [value])

  return <SettingsContext.Provider value={resolved}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === null) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
