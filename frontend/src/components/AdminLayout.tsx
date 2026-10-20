import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { APP_NAME, DEPARTMENT } from '../config'
import {
  ROLE_NAMES,
  api,
  isAdmin,
  prefetch,
  setToken,
  signedInRole,
  signedInUsername,
  useBusy,
  useSignedIn,
} from '../data/api'
import { useOnline } from '../data/motion'
import SignIn from '../pages/SignIn'
import {
  ChannelIcon,
  DashboardIcon,
  Logo,
  QrIcon,
  SearchIcon,
  SignOutIcon,
  StaffIcon,
  UsersIcon,
  WifiOffIcon,
} from './Icons'
import { PageSkeleton } from './Skeleton'
import Toaster from './Toaster'

const CommandPalette = lazy(() => import('./CommandPalette'))

// What each page will ask for first, so it can be fetched (code and data)
// while the pointer is still on its link.
const WARM_UP: Record<string, () => void> = {
  '/': () => void import('../pages/Dashboard'),
  '/barcode': () => {
    void import('../pages/Barcode')
    prefetch('/lots')
    prefetch('/forms')
  },
  '/users': () => {
    void import('../pages/Users')
    prefetch('/entries?page=1&size=100')
    prefetch('/forms')
  },
  '/channels': () => {
    void import('../pages/Channels')
    prefetch('/channels')
  },
  '/staff': () => {
    void import('../pages/Staff')
    prefetch('/staff')
  },
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

function AdminLayout() {
  const signedIn = useSignedIn()
  const role = signedInRole()
  const busy = useBusy()
  const online = useOnline()
  const location = useLocation()
  const [palette, setPalette] = useState(false)

  // Ctrl+K (⌘K on a Mac) opens the search box from anywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function signOut() {
    api('/logout', {}).catch(() => {})
    setToken(null)
  }

  if (!signedIn) return <SignIn />

  const link = (to: string) => ({
    to,
    onPointerEnter: WARM_UP[to],
    onFocus: WARM_UP[to],
  })

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className={busy ? 'progress on' : 'progress'} aria-hidden="true" />

      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{DEPARTMENT}</small>
          </span>
        </div>

        <button type="button" className="search-button" onClick={() => setPalette(true)}>
          <SearchIcon />
          <span>Search</span>
          <kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
        </button>

        <nav className="sidenav" aria-label="Main">
          <NavLink {...link('/')} end>
            <DashboardIcon />
            Dashboard
          </NavLink>
          <NavLink {...link('/barcode')}>
            <QrIcon />
            Barcode
          </NavLink>
          <NavLink {...link('/users')}>
            <UsersIcon />
            Farmers
          </NavLink>
          <NavLink {...link('/channels')}>
            <ChannelIcon />
            Channels
          </NavLink>
          {isAdmin() && (
            <NavLink {...link('/staff')}>
              <StaffIcon />
              Users
            </NavLink>
          )}
        </nav>

        <div className="account">
          <span className="avatar" aria-hidden="true">
            {ROLE_NAMES[role][0]}
          </span>
          <span className="account-text">
            <strong>{ROLE_NAMES[role]}</strong>
            <span>{signedInUsername() || 'Office staff'}</span>
          </span>
          <button
            type="button"
            className="icon-button search-icon"
            onClick={() => setPalette(true)}
            aria-label="Search"
            title="Search"
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOutIcon />
          </button>
        </div>
      </aside>

      <main id="main" className="main">
        {!online && (
          <p className="offline" role="status">
            <WifiOffIcon />
            No internet connection. What is on screen may be out of date; it will
            refresh when the connection is back.
          </p>
        )}
        {/* Each page slides in as it opens. */}
        <div className="page-enter" key={location.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {palette && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPalette(false)} />
        </Suspense>
      )}
      <Toaster />
    </div>
  )
}

export default AdminLayout
