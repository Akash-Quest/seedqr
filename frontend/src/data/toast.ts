import { useSyncExternalStore } from 'react'

// Short messages that confirm something happened ("Seed lot saved"), shown
// in the corner for a few seconds. Errors stay a little longer.
export type Toast = { id: number; text: string; tone: 'ok' | 'info' | 'error' }

let toasts: Toast[] = []
let next = 1
const listeners = new Set<() => void>()

function changed() {
  listeners.forEach((listener) => listener())
}

export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = next++
  // Only the newest few, so a burst never covers the page.
  toasts = [...toasts, { id, text, tone }].slice(-4)
  changed()
  setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 3800)
}

export function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id)
  changed()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
  )
}
