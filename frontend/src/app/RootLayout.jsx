import { Outlet } from 'react-router-dom'
import DocumentTitle from './DocumentTitle.jsx'

/**
 * Pathless root layout.
 *
 * Renders the document title and then an `<Outlet />` for the child routes. The
 * outlet is the important part: a route element is the *parent* of its children,
 * so an element that does not render an `<Outlet />` renders nothing at all and
 * silently blanks every child route.
 *
 * This exists so `DocumentTitle` stays inside the router by construction. It calls
 * `useLocation()`, which throws if invoked outside a `<Router>`. Mounting it as a
 * sibling of `<RouterProvider>` in main.jsx shipped a crash that every test missed,
 * because tests render `routes` with their own memory router and never mount the
 * real entry point.
 *
 * Renders no DOM of its own, so it does not affect the single-`<h1>`-per-page rule.
 */
export default function RootLayout() {
  return (
    <>
      <DocumentTitle />
      <Outlet />
    </>
  )
}
