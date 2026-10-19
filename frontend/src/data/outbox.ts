// Runs on the farmer's phone. Entries are written to IndexedDB first and
// removed only after the server has accepted them, so a lost signal never
// loses what was typed.
import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { useSyncExternalStore } from 'react'
import type { FarmerEntry, PublicLot } from './types'

let dbPromise: Promise<IDBPDatabase> | undefined

// Must match the database opened in public/sw.js.
function db() {
  dbPromise ??= openDB('seedcode', 1, {
    upgrade(database) {
      database.createObjectStore('outbox', { keyPath: 'id' })
      database.createObjectStore('lots', { keyPath: 'id' })
    },
  })
  return dbPromise
}

let pending = 0
const listeners = new Set<() => void>()

async function refreshCount() {
  try {
    const count = await (await db()).count('outbox')
    if (count !== pending) {
      pending = count
      listeners.forEach((listener) => listener())
    }
  } catch {
    // No IndexedDB on this phone: nothing can be waiting.
  }
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pending,
  )
}

// What became of one try at sending an entry: taken, to be tried again
// later (no signal, or the server is busy), or refused for good.
export type Sent = 'sent' | 'later' | 'refused'

// The server will never take an entry it answered with one of these, so
// trying again is pointless, and keeping it would leave the farmer's details
// (an ID number, perhaps) on a phone that may be shared.
const REFUSED = [400, 404, 413, 422]

export async function postEntry(entry: FarmerEntry): Promise<Sent> {
  try {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (response.ok) return 'sent'
    return REFUSED.includes(response.status) ? 'refused' : 'later'
  } catch {
    return 'later'
  }
}

// Entries the server refused while this page was open, so the form can say
// so instead of "Sent".
const refused = new Set<string>()

export function wasRefused(id: string): boolean {
  return refused.has(id)
}

export async function queueEntry(entry: FarmerEntry) {
  await (await db()).put('outbox', entry)
  await refreshCount()
}

let sending: Promise<void> | null = null

export function sendPending(): Promise<void> {
  sending ??= sendAll().finally(() => {
    sending = null
  })
  return sending
}

async function sendAll() {
  try {
    const database = await db()
    const entries = (await database.getAll('outbox')) as FarmerEntry[]
    for (const entry of entries) {
      const result = await postEntry(entry)
      if (result === 'refused') refused.add(entry.id)
      if (result !== 'later') await database.delete('outbox', entry.id)
    }
  } catch {
    // Try again on the next trigger.
  }
  await refreshCount()
  if (pending > 0) askBrowserToSendLater()
}

// Android Chrome can send after the page is closed. Other browsers ignore this.
function askBrowserToSendLater() {
  navigator.serviceWorker?.ready
    .then((registration) => {
      const sync = (
        registration as ServiceWorkerRegistration & {
          sync?: { register(tag: string): Promise<void> }
        }
      ).sync
      return sync?.register('send-entries')
    })
    .catch(() => {})
}

export function startAutoSend() {
  void sendPending()
  window.addEventListener('online', () => void sendPending())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sendPending()
  })
  // The "online" event is not reliable on weak signal, so keep trying.
  setInterval(() => {
    if (pending > 0) void sendPending()
  }, 20_000)
}

export async function loadLot(id: string): Promise<PublicLot | 'missing' | 'offline'> {
  try {
    const response = await fetch(`/api/lots/${encodeURIComponent(id)}`)
    if (response.status === 404) return 'missing'
    if (response.ok) {
      const lot = (await response.json()) as PublicLot
      db()
        .then((database) => database.put('lots', lot))
        .catch(() => {})
      return lot
    }
  } catch {
    // No signal: use the copy saved by an earlier scan, if there is one.
  }
  try {
    const saved = (await (await db()).get('lots', id)) as PublicLot | undefined
    if (saved) return saved
  } catch {
    // fall through
  }
  return 'offline'
}
