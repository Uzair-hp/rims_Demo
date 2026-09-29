import { useCallback, useEffect, useState } from 'react'
import Card from '../../components/ui/Card.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PageHeader from '../../components/ui/PageHeader.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import AccountSection from './sections/AccountSection.jsx'
import BankSection from './sections/BankSection.jsx'
import BrandingSection from './sections/BrandingSection.jsx'
import BusinessSection from './sections/BusinessSection.jsx'
import CatalogueSection from './sections/CatalogueSection.jsx'
import DocumentFooterSection from './sections/DocumentFooterSection.jsx'
import InvoiceDefaultsSection from './sections/InvoiceDefaultsSection.jsx'
import QuotationDefaultsSection from './sections/QuotationDefaultsSection.jsx'
import TaxSection from './sections/TaxSection.jsx'
import TermsSection from './sections/TermsSection.jsx'
import { useSettings } from './SettingsProvider.jsx'
import styles from './settings.module.css'

const TOAST_MS = 3500

/**
 * Settings page — every §15 section on one scroll (§19: one column on mobile,
 * the same stack at a wider measure on desktop; no tab strip to misfire on a
 * phone).
 *
 * The page owns three things and delegates the rest: the loaded row (from the
 * provider), the success toast (§15 "own Save + success toast"), and the
 * loading / error states around the whole (§20). Each section form below is
 * independent — saving one never touches another's fields.
 */
export default function SettingsPage() {
  const { settings, status, isError, refresh } = useSettings()
  const { signOut } = useAuth()
  const [toast, setToast] = useState(null)

  const notify = useCallback((message) => {
    setToast({ id: Date.now(), message })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  /** After any save the row changes → refresh the provider so the sidebar follows. */
  const handleSaved = useCallback(
    (row) => {
      if (row) notify('Settings saved.')
      refresh({ silent: true })
    },
    [notify, refresh],
  )

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company profile, branding, document defaults and account — all editable without a code change."
      />

      {status === 'loading' ? (
        <div className={styles.loadingGrid} aria-busy="true" aria-label="Settings, loading">
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <Skeleton height="1.25rem" width="35%" />
              <Skeleton height="1rem" width="60%" />
              <Skeleton height="3rem" width="100%" />
            </Card>
          ))}
        </div>
      ) : isError || !settings ? (
        <div className={styles.errorWrap}>
          <EmptyState
            icon="alert"
            title="Settings could not be loaded"
            message={
              status === 'error'
                ? 'The server did not answer. Check that the API is running, then try again.'
                : 'No settings were returned by the server.'
            }
            actionLabel="Try again"
            onAction={() => refresh()}
            actionIcon="chevronRight"
            tone="muted"
          />
        </div>
      ) : (
        <div className={styles.sections}>
          <BusinessSection settings={settings} onSaved={handleSaved} />
          <BrandingSection notify={notify} />
          <QuotationDefaultsSection settings={settings} onSaved={handleSaved} />
          <InvoiceDefaultsSection settings={settings} onSaved={handleSaved} />
          <TaxSection settings={settings} onSaved={handleSaved} />
          <BankSection settings={settings} onSaved={handleSaved} />
          <TermsSection notify={notify} />
          <DocumentFooterSection settings={settings} onSaved={handleSaved} />
          <AccountSection signOut={signOut} notify={notify} />
          <CatalogueSection settings={settings} onSaved={handleSaved} />
        </div>
      )}

      {toast ? (
        <div className={styles.toast} role="status">
          <Icon name="check" size={16} />
          <span>{toast.message}</span>
        </div>
      ) : null}
    </>
  )
}
