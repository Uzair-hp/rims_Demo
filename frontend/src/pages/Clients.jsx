import PagePlaceholder from './PagePlaceholder.jsx'

export default function Clients() {
  return (
    <PagePlaceholder
      title="Clients"
      description="Searchable directory of clients with contact details and linked quotations and invoices."
      icon="users"
      emptyTitle="Clients arrive in Phase 4"
      emptyMessage="This shell already supports the client pickers used later. The CRUD, address book and search are Phase 4."
      actionLabel="Back to dashboard"
      actionTo="/"
      actionIcon="chevronLeft"
    />
  )
}

export function ClientDetail() {
  return (
    <PagePlaceholder
      title="Client"
      description="Client profile with contact details and linked documents."
      icon="users"
      emptyTitle="Client detail arrives in Phase 4"
      emptyMessage="Linked quotations and invoices appear once those APIs exist, without changing this chrome."
      actionLabel="All clients"
      actionTo="/clients"
      actionIcon="chevronLeft"
    />
  )
}
