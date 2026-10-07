import { Link, Route, Routes } from 'react-router-dom'
import AdminLayout from './components/AdminLayout'
import PageHeader from './components/PageHeader'
import Barcode from './pages/Barcode'
import Dashboard from './pages/Dashboard'
import FarmerForm from './pages/FarmerForm'
import Users from './pages/Users'

function App() {
  return (
    <Routes>
      {/* Opened by scanning a QR code. No sign-in. */}
      <Route path="f/:lotId" element={<FarmerForm />} />

      <Route element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="barcode" element={<Barcode />} />
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
  )
}

export default App
