import { NavLink, Outlet } from 'react-router-dom'
import { APP_NAME, DEPARTMENT } from '../config'
import { ROLE_NAMES, api, isAdmin, setToken, signedInRole, signedInUsername, useSignedIn } from '../data/api'
import SignIn from '../pages/SignIn'
import { DashboardIcon, Logo, QrIcon, SignOutIcon, StaffIcon, UsersIcon } from './Icons'

function AdminLayout() {
  const signedIn = useSignedIn()
  const role = signedInRole()

  function signOut() {
    api('/logout', {}).catch(() => {})
    setToken(null)
  }

  if (!signedIn) return <SignIn />

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span className="brand-text">
            <strong>{APP_NAME}</strong>
            <small>{DEPARTMENT}</small>
          </span>
        </div>

        <nav className="sidenav" aria-label="Main">
          <NavLink to="/" end>
            <DashboardIcon />
            Dashboard
          </NavLink>
          <NavLink to="/barcode">
            <QrIcon />
            Barcode
          </NavLink>
          <NavLink to="/users">
            <UsersIcon />
            Farmers
          </NavLink>
          {isAdmin() && (
            <NavLink to="/staff">
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
        <Outlet />
      </main>
    </div>
  )
}

export default AdminLayout
