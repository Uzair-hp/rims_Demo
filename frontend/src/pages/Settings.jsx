import PagePlaceholder from './PagePlaceholder.jsx'

export default function Settings() {
  return (
    <PagePlaceholder
      title="Settings"
      description="Business profile, logo, document terms and catalogue lists used across quotations and invoices."
      icon="settings"
      emptyTitle="Settings arrive in Phase 3"
      emptyMessage="Company profile, logo upload and default terms live here. The shell already reads this state; the editing UI and its API are Phase 3."
      actionLabel="Back to dashboard"
      actionTo="/"
      actionIcon="chevronLeft"
    />
  )
}
