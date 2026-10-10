import { useEffect, useState, useSyncExternalStore } from 'react'

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

// GET when there is no body, POST when there is, unless a method is given.
export async function api<T>(
  path: string,
  body?: unknown,
  method: string = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

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
  return data as T
}

export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string; path?: string }>({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    api<T>(path).then(
      (data) => live && setState({ data, path }),
      (err: Error) => live && setState({ error: err.message, path }),
    )
    return () => {
      live = false
    }
  }, [path, attempt])

  return {
    data: state.data,
    error: state.error,
    // False while the answer shown is still the one for an earlier path.
    fresh: state.path === path,
    reload: () => setAttempt((n) => n + 1),
  }
}
