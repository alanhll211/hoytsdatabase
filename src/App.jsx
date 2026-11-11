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
import FfsLog from './pages/FfsLog'
import DailyLog from './pages/DailyLog'
import { canOpen, homeFor } from './permissions'
import './appCustom.css'

// Signed-in users only, and only pages in their own sites. Anything else
// goes to the user's home page, so hidden sections can't be opened by URL.
function RequireAuth({ children }) {
  const { profile } = useAuth()
  const location = useLocation()
  if (!profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!canOpen(profile, location.pathname)) {
    return <Navigate to={homeFor(profile)} replace />
  }
  return children
}

function HomeRedirect() {
  const { profile } = useAuth()
  return <Navigate to={homeFor(profile)} replace />
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
              <Route path="/daily" element={<DailyLog />} />
              <Route path="/batches" element={<Batches />} />
              <Route path="/recipes" element={<Recipes />} />
              <Route path="/ingredients" element={<Ingredients />} />
              <Route path="/ffs" element={<FfsLog />} />
              <Route path="*" element={<HomeRedirect />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FlashProvider>
    </AuthProvider>
  )
}

export default App
