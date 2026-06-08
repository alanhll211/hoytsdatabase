import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { FlashProvider } from './FlashContext'
import Layout from './Layout'
import Traceability from './pages/Traceability'
import Batches from './pages/Batches'
import Recipes from './pages/Recipes'
import './appCustom.css'

function App() {
  return (
    <FlashProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/traceability" replace />} />
            <Route path="/traceability" element={<Traceability />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/recipes" element={<Recipes />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </FlashProvider>
  )
}

export default App
