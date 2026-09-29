/**
 * Ruchita Interiors — route table.
 *
 * The single source of truth for paths, so the shell, the navigation map and the
 * tests can never disagree about a URL.
 *
 * The pathless root element below is `RootLayout`, which renders `DocumentTitle`
 * and an `<Outlet />`. It exists so the title stays inside the router by
 * construction: it needs `useLocation()`, which throws if called outside a
 * `<Router>`. Mounting it as a sibling of `<RouterProvider>` in main.jsx shipped a
 * crash that every test missed, because tests render `routes` with their own
 * memory router and never mount the real entry point. The router now owns every
 * component that needs router context.
 *
 * `/login` sits outside `AppShell` because it has no chrome (§18.6) and is wrapped
 * in `RedirectIfAuthenticated`. Every other route is behind `RequireAuth` (§16):
 * the guard is a UX convenience, and the backend enforces auth independently.
 *
 * The print routes are the other chrome-less surfaces (§14.2). They are
 * deliberately *outside* `AppShell` but still inside `RequireAuth` and
 * `SettingsProvider` — a quotation document needs the company settings row for
 * its header, signatory and footer, and it must not render a sidebar.
 * `/print/invoice/:id` arrives with Phase 7 and reuses `PrintQuotation`.
 */
import AppShell from '../components/layout/AppShell.jsx'
import Clients, { ClientDetail } from '../pages/Clients.jsx'
import Dashboard from '../pages/Dashboard.jsx'
import Invoices, { InvoiceDetail } from '../pages/Invoices.jsx'
import NotFound from '../pages/NotFound.jsx'
import PrintQuotation from '../pages/PrintQuotation.jsx'
import QuotationDetail from '../pages/QuotationDetail.jsx'
import RootLayout from './RootLayout.jsx'
import Quotations, { QuotationNew } from '../pages/Quotations.jsx'
import Settings from '../pages/Settings.jsx'
import Login from '../features/auth/LoginPage.jsx'
import { RedirectIfAuthenticated, RequireAuth } from '../features/auth/guards.jsx'
import { SettingsProvider } from '../features/settings/SettingsProvider.jsx'

export const routes = [
  {
    element: <RootLayout />,
    children: [
      {
        path: '/login',
        element: (
          <RedirectIfAuthenticated>
            <Login />
          </RedirectIfAuthenticated>
        ),
      },
      {
        // Chrome-less print surface (§14.2): authenticated, settings-aware, no shell.
        // The providers are inlined on the leaf route rather than hoisted onto a
        // pathless parent, because a parent element must render an <Outlet /> and
        // this route has exactly one child — a wrapper here would render the page
        // twice, once for the parent and once for the child.
        path: 'print/quotation/:id',
        element: (
          <RequireAuth>
            <SettingsProvider>
              <PrintQuotation documentType="quotation" />
            </SettingsProvider>
          </RequireAuth>
        ),
      },
      {
        element: (
          <RequireAuth>
            {/* Phase 3: one settings fetch for the whole authenticated shell —
                the sidebar logo and the Settings page share this state. */}
            <SettingsProvider>
              <AppShell />
            </SettingsProvider>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'quotations', element: <Quotations /> },
          { path: 'quotations/new', element: <QuotationNew /> },
          { path: 'quotations/:id', element: <QuotationDetail mode="view" /> },
          { path: 'quotations/:id/edit', element: <QuotationDetail mode="edit" /> },
          { path: 'invoices', element: <Invoices /> },
          { path: 'invoices/:id', element: <InvoiceDetail /> },
          { path: 'clients', element: <Clients /> },
          { path: 'clients/:id', element: <ClientDetail /> },
          { path: 'settings', element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]
