import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { AuthProvider } from '../features/auth/AuthProvider.jsx'

/**
 * The provider composition for the running app.
 *
 * Kept separate from `main.jsx` so tests can mount the real tree. The original bug
 * was a `DocumentTitle` mounted as a sibling of `<RouterProvider>` here, which
 * threw and blanked the app; the tests missed it because they each built their own
 * memory router instead of mounting this. `src/app/main.test.jsx` now mounts this
 * component, and `DocumentTitle` lives in the route table (`RootLayout`) so no
 * sibling of `RouterProvider` can be introduced here.
 */
export default function App() {
  return (
    <ErrorBoundary>
      {/* Outermost provider: RequireAuth reads it, and it must be able to redirect
          the whole tree without an ancestor remounting it. */}
      <AuthProvider>
        {/* RouterProvider renders no DOM itself, so nothing may be mounted as its
            sibling. Anything needing router context (useLocation, useNavigate,
            useParams) belongs in the route table in app/routes.jsx. */}
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  )
}
