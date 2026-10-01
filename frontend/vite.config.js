import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// PLAN §18.8 and §23: the dev server proxies /api to Flask so cookies are
// same-origin in development, and the production build emits an installable,
// offline-capable app.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png', 'brand/logo.svg'],
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // No `runtimeCaching` for the API, deliberately.
        //
        // An earlier version cached every `GET /api/v1/*` response for 24 hours,
        // which reads well as offline support and is wrong here: those responses
        // are authenticated business data. Client names, invoice amounts and
        // payment records sit in Cache Storage, which is not cleared by signing
        // out — so the next person to use the device, or anyone who opens devtools,
        // can read the whole ledger. Cache Storage is also not bound by
        // `Cache-Control`, so a `no-store` response header does not save it.
        //
        // Offline reads of business data are the wrong trade for an app whose
        // value is that its numbers are current. The app shell is precached
        // above, so the app still opens offline and shows its own "can't reach
        // the server" state rather than stale figures.
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: {
    // Bound explicitly rather than left to Vite's default. The default resolved to
    // `::1` (IPv6 loopback) on this machine, which made `http://127.0.0.1:5173`
    // refuse connections while `http://localhost:5173` worked - a confusing split
    // that made a healthy dev server look broken to any IPv4 health check.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/test/**'],
    },
  },
})
