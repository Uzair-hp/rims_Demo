import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
// Fonts (§18.9), self-hosted via @fontsource so nothing is fetched from a CDN
// and the woff2 files land in the PWA precache. The family names here match the
// tokens in styles/tokens.css: DM Sans (UI/body 400·500·600), Cormorant Garamond
// (headings 600) and Cinzel (wordmark 500). Latin subset only — the app is en-IN.
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import '@fontsource/cinzel/latin-500.css'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
