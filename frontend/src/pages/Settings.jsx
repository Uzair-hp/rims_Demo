import SettingsPage from '../features/settings/SettingsPage.jsx'

/**
 * Route wrapper (§23: pages/ stays thin, features/ owns the screen).
 * The real page — all §15 sections — lives in `features/settings/`.
 */
export default function Settings() {
  return <SettingsPage />
}
