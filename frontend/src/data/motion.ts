import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

// People who asked their system for less motion get none.
export function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// A number that runs up to its value, and on to each new value, instead of
// jumping. Starts from zero the first time.
export function useCountUp(value: number, ms = 750): number {
  const still = reducedMotion()
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    if (still) {
      from.current = value
      return
    }
    const begin = from.current
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / ms)
      // Quick at first, settling gently on the value.
      const current = begin + (value - begin) * (1 - Math.pow(1 - t, 3))
      from.current = current
      setShown(Math.round(current))
      if (t < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [value, ms, still])

  return still ? value : shown
}

// The time now, moving on every `every` milliseconds, for "10 seconds ago".
export function useNow(every = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

export function ago(time: number | undefined, now: number): string {
  if (!time) return ''
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`
}

// Whether this computer has a network connection, as the browser sees it.
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)
      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
    () => navigator.onLine,
  )
}
