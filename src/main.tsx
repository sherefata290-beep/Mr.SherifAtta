import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  preloadImage,
  readCachedHomepageImage,
  writeCachedHomepageImage,
} from './lib/imageOptimize'

// 1) Instant warm from localStorage (previous visit)
const cachedHome = readCachedHomepageImage()
if (cachedHome) preloadImage(cachedHome)

// 2) Warm serverless + homepage image in parallel with React boot (non-blocking)
const homeImageReq = fetch('/api/settings?key=homepage_image')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    const url = (data?.value || '').trim()
    writeCachedHomepageImage(url)
    if (url) preloadImage(url)
    try {
      window.dispatchEvent(new CustomEvent('em:homepage-image', { detail: { url } }))
    } catch {
      /* ignore */
    }
    return url
  })
  .catch(() => '')

// Wake database + warm common public APIs so first navigation feels instant
try {
  const warm = (url: string) => {
    fetch(url, { method: 'GET', keepalive: true, cache: 'no-store' }).catch(() => {})
  }
  // health triggers restore/ping if the project was paused
  warm('/api/health')
  warm('/api/courses')
  warm('/api/quizzes')
  warm('/api/stats')
  warm('/api/footer')
  warm('/api/leaderboard')
} catch {
  /* ignore */
}

// Expose for debugging / late subscribers
;(window as unknown as { __emHomeImageReady?: Promise<string> }).__emHomeImageReady = homeImageReq

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
