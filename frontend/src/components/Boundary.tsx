import { Component } from 'react'
import type { ReactNode } from 'react'

const RELOADED = 'seedcode.reloaded'

// A part of the app that could not be loaded (a new version was put out
// while the page was open, or the signal dropped on the way) would otherwise
// leave a blank page. The page is loaded again once; if that does not help,
// it says so.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidMount() {
    // Loaded fine: a later failure may reload again.
    setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOADED)
      } catch {
        // Nothing to clear.
      }
    }, 10_000)
  }

  componentDidCatch(error: Error) {
    const missingPart =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        error.message,
      )
    let already = false
    try {
      already = sessionStorage.getItem(RELOADED) === '1'
      if (missingPart && !already && navigator.onLine) sessionStorage.setItem(RELOADED, '1')
    } catch {
      already = true // cannot remember a reload, so never risk a loop
    }
    if (missingPart && !already && navigator.onLine) window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="public-main">
        <div className="problem" role="alert">
          <h1>This page could not be loaded</h1>
          <p>Check the internet connection, then try again.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    )
  }
}

export default Boundary
