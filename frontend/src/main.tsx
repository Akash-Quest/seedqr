import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/public-sans'
import './index.css'
import App from './App.tsx'
import { startAutoSend } from './data/outbox'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Send anything a lost signal left behind on this phone.
startAutoSend()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      // Save the files this page has already loaded, so that a refresh
      // without signal still shows the form.
      const files = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(location.origin) && !url.includes('/api/'))
      const cache = await caches.open('seedcode-v1')
      await cache.addAll(files)
    })
    .catch(() => {})
}
