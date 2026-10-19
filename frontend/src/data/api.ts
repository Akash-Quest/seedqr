import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const KEY = 'seedcode.token'
const listeners = new Set<() => void>()

function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

let token = stored()

export function setToken(next: string | null) {
  if (next !== token) {
    // Answers belong to whoever was signed in. The next person never sees them.
    forgetAll()
  }
  token = next
  try {
    if (next) sessionStorage.setItem(KEY, next)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Signed in for this page only.
  }
  listeners.forEach((listener) => listener())
}

// Who is signed in, for showing in the sidebar and for hiding what their
// role may not do. The server checks the role again on every request.
export type Role = 'admin' | 'editor' | 'viewer'

export const ROLE_NAMES: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const NAME_KEY = 'seedcode.username'
const ROLE_KEY = 'seedcode.role'

export function rememberUser(name: string, role: Role) {
  try {
    sessionStorage.setItem(NAME_KEY, name)
    sessionStorage.setItem(ROLE_KEY, role)
  } catch {
    // Not shown after a reload, nothing else is affected.
  }
}

export function signedInUsername(): string {
  try {
    const name = sessionStorage.getItem(NAME_KEY) ?? ''
    return name === 'undefined' ? '' : name
  } catch {
    return ''
  }
}

export function signedInRole(): Role {
  try {
    const role = sessionStorage.getItem(ROLE_KEY)
    return role === 'admin' || role === 'editor' ? role : 'viewer'
  } catch {
    return 'viewer'
  }
}

// Adds, changes and deletes seed lots; imports and exports entries.
export function canEdit(): boolean {
  return signedInRole() !== 'viewer'
}

// Also changes the form questions and manages staff accounts.
export function isAdmin(): boolean {
  return signedInRole() === 'admin'
}

// For the one request the browser makes by itself (the export download).
export function currentToken(): string {
  return token ?? ''
}

export function useSignedIn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => token !== null,
  )
}

// ---- Requests under way, for the thin bar at the top of the page ----

let underWay = 0
const busyListeners = new Set<() => void>()

function busy(change: number) {
  underWay += change
  busyListeners.forEach((listener) => listener())
}

export function useBusy(): boolean {
  return useSyncExternalStore(
    (listener) => {
      busyListeners.add(listener)
      return () => busyListeners.delete(listener)
    },
    () => underWay > 0,
  )
}

// GET when there is no body, POST when there is, unless a method is given.
export async function api<T>(
  path: string,
  body?: unknown,
  method: string = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  busy(1)
  try {
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new Error('Could not reach the server. Check your internet connection.')
    }

    const data = await response.json().catch(() => ({}))
    if (response.status === 401) setToken(null)
    if (!response.ok) {
      // A 5xx with no message means the backend itself did not answer.
      const fallback =
        response.status >= 500
          ? 'The server is not answering. Check that the backend is running.'
          : 'Something went wrong. Please try again.'
      throw new Error(data.error || fallback)
    }
    // Anything that changes data makes every kept answer stale.
    if (method !== 'GET') forgetAll()
    return data as T
  } finally {
    busy(-1)
  }
}

// ---- Kept answers ----------------------------------------------------------
// Pages show the last answer for a path at once, even after moving away and
// back, and ask again in the background when it is more than a few seconds
// old. Two parts of a page asking for the same path share one request.

const FRESH_MS = 15_000
type Kept = { data: unknown; at: number }
const kept = new Map<string, Kept>()
const asking = new Map<string, Promise<unknown>>()
// Bumped whenever kept answers are dropped, so a reply that was already on
// its way is not kept afterwards.
let generation = 0

function forgetAll() {
  kept.clear()
  asking.clear()
  generation += 1
}

function load<T>(path: string): Promise<T> {
  let request = asking.get(path) as Promise<T> | undefined
  if (!request) {
    const asked = generation
    request = api<T>(path).then((data) => {
      if (asked === generation) kept.set(path, { data, at: Date.now() })
      return data
    })
    const shared = request
    asking.set(path, shared)
    void shared.then(
      () => asking.get(path) === shared && asking.delete(path),
      () => asking.get(path) === shared && asking.delete(path),
    )
  }
  return request
}

// Starts loading a page's data before it is opened, for example when the
// pointer rests on its link.
export function prefetch(path: string) {
  if (!token) return
  const found = kept.get(path)
  if (!found || Date.now() - found.at > FRESH_MS) load(path).catch(() => {})
}

type Options = {
  // Ask again this often, in milliseconds, while the page is in view.
  every?: number
}

// `asking` is the path whose answer is on its way, if any.
type State<T> = { data?: T; error?: string; path?: string; at?: number; asking?: string }

export function useApi<T>(path: string, { every }: Options = {}) {
  const [state, setState] = useState<State<T>>({})
  const [attempt, setAttempt] = useState(0)
  const forced = useRef(false)

  useEffect(() => {
    let live = true
    const found = kept.get(path)
    const again = forced.current
    forced.current = false
    if (!again && found && Date.now() - found.at < FRESH_MS) {
      return () => {
        live = false
      }
    }
    // The kept answer, if any, stays on screen until the new one arrives.
    setState((before) => ({ ...before, asking: path }))
    // However it ends, this path is no longer being asked for.
    const settled = (before: State<T>): State<T> =>
      before.asking === path ? { ...before, asking: undefined } : before
    load<T>(path).then(
      (data) => setState((before) => (live ? { data, path, at: Date.now() } : settled(before))),
      (err: Error) =>
        setState((before) =>
          live
            ? {
                // An earlier path's answer is not this one's: drop it.
                data: before.path === path ? before.data : undefined,
                at: before.path === path ? before.at : undefined,
                error: err.message,
                path,
              }
            : settled(before),
        ),
    )
    return () => {
      live = false
    }
  }, [path, attempt])

  const reload = useCallback(() => {
    forced.current = true
    setAttempt((n) => n + 1)
  }, [])

  // Fresh numbers when the person comes back to the tab, and on a timer
  // while the page is in view if asked for.
  useEffect(() => {
    function onShow() {
      if (document.visibilityState !== 'visible') return
      const found = kept.get(path)
      if (!found || Date.now() - found.at > FRESH_MS) reload()
    }
    document.addEventListener('visibilitychange', onShow)
    const timer = every
      ? setInterval(() => document.visibilityState === 'visible' && reload(), every)
      : undefined
    return () => {
      document.removeEventListener('visibilitychange', onShow)
      if (timer) clearInterval(timer)
    }
  }, [path, every, reload])

  const mine = state.path === path
  const found = kept.get(path)
  // The newest answer for this path, kept or our own. While a new path is
  // being asked for, the last answer stays on screen.
  const useKept = found !== undefined && (!mine || (state.at ?? 0) < found.at)
  const data = useKept ? (found.data as T) : state.data

  return {
    data,
    error: mine && !useKept ? state.error : undefined,
    // False while the answer shown is still the one for an earlier path.
    fresh: mine || found !== undefined,
    // True while a newer answer for this path is on its way.
    loading: state.asking === path,
    // When the answer shown arrived, for "updated 10 seconds ago".
    updatedAt: useKept ? found.at : mine ? state.at : undefined,
    reload,
  }
}
