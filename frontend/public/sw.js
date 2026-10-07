// Keeps the farmer form usable when the signal drops, and sends saved
// entries in the background where the browser allows it (Android Chrome).
const CACHE = 'seedcode-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('/'))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return
  }

  // Pages: try the network, fall back to the saved copy of the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('/', copy))
          }
          return response
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Scripts, styles and images: saved copy first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'send-entries') event.waitUntil(sendPending())
})

// Must match the database set up in src/data/outbox.ts.
function openDb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('seedcode', 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('outbox', { keyPath: 'id' })
      open.result.createObjectStore('lots', { keyPath: 'id' })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

function run(db, mode, work) {
  return new Promise((resolve, reject) => {
    const request = work(db.transaction('outbox', mode).objectStore('outbox'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function sendPending() {
  const db = await openDb()
  const entries = await run(db, 'readonly', (store) => store.getAll())
  for (const entry of entries) {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    // Throwing makes the browser try again later.
    if (!response.ok) throw new Error('Entry was not accepted')
    await run(db, 'readwrite', (store) => store.delete(entry.id))
  }
}
