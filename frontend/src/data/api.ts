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

// Who is signed in, for showing in the sidebar.
const NAME_KEY = 'seedcode.username'

export function rememberUsername(name: string) {
  try {
    sessionStorage.setItem(NAME_KEY, name)
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
  const [state, setState] = useState<{ data?: T; error?: string }>({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    api<T>(path).then(
      (data) => live && setState({ data }),
      (err: Error) => live && setState({ error: err.message }),
    )
    return () => {
      live = false
    }
  }, [path, attempt])

  return { ...state, reload: () => setAttempt((n) => n + 1) }
}
