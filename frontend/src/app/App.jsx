import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { AuthProvider } from '../features/auth/AuthProvider.jsx'
import { ThemeProvider } from './useTheme.js'

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
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
