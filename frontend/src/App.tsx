import { Suspense, lazy } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Boundary from './components/Boundary'
import PageHeader from './components/PageHeader'
// The farmer's form is part of the first download, so a phone that opened
// it once can open it again with no signal at all.
import FarmerForm from './pages/FarmerForm'

// The office pages are loaded only when opened. A farmer's phone on a weak
// signal then never downloads them.
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const Barcode = lazy(() => import('./pages/Barcode'))
const Channels = lazy(() => import('./pages/Channels'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Staff = lazy(() => import('./pages/Staff'))
const Users = lazy(() => import('./pages/Users'))

function App() {
  return (
    <Boundary>
      <Suspense fallback={<div className="boot" role="status" aria-label="Loading" />}>
        <Routes>
          {/* Opened by scanning a QR code. No sign-in. */}
          <Route path="f/:lotId" element={<FarmerForm />} />

          <Route element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="barcode" element={<Barcode />} />
            <Route path="channels" element={<Channels />} />
            <Route path="staff" element={<Staff />} />
            <Route
              path="*"
              element={
                <>
                  <PageHeader title="Page not found" />
                  <div className="page">
                    <p>
                      Check the address, or go back to the{' '}
                      <Link to="/">dashboard</Link>.
                    </p>
                  </div>
                </>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </Boundary>
  )
}

export default App
