import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { FlashProvider } from './FlashContext'
import { AuthProvider, useAuth } from './AuthContext'
import Layout from './Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import Traceability from './pages/Traceability'
import Batches from './pages/Batches'
import Recipes from './pages/Recipes'
import Ingredients from './pages/Ingredients'
import './appCustom.css'

function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

function App() {
  return (
    <AuthProvider>
      <FlashProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Home />} />
              <Route path="/traceability" element={<Traceability />} />
              <Route path="/batches" element={<Batches />} />
              <Route path="/recipes" element={<Recipes />} />
              <Route path="/ingredients" element={<Ingredients />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FlashProvider>
    </AuthProvider>
  )
}

export default App
