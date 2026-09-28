import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
// Self-hosted variable fonts (§18.9): no Google Fonts request, no layout shift
// from a late font swap, and the family names in tokens.css resolve offline.
import '@fontsource-variable/inter'
import '@fontsource-variable/playfair-display'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
