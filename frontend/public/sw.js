// Keeps the farmer form usable when the signal drops, and sends saved
// entries in the background where the browser allows it (Android Chrome).
// Must match the name in src/main.tsx. A new name drops the old copies.
const CACHE = 'seedcode-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('/'))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

// Only the app itself is kept: the page, and the built files whose names
// change whenever their content does. Nothing else on the site, and never
// an answer from the API, which may hold farmers' details.
function isAppFile(url) {
  return url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg'
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
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

  if (!isAppFile(url)) return

  // Built files: the saved copy first. Their names change with their
  // content, so a saved copy is never out of date.
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

// Answers that mean the server will never take the entry (see outbox.ts).
const REFUSED = [400, 404, 413, 422]

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
    if (!response.ok && !REFUSED.includes(response.status)) throw new Error('Entry was not accepted')
    await run(db, 'readwrite', (store) => store.delete(entry.id))
  }
}
