import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import SwapPage from './pages/SwapPage'
import StakePage from './pages/StakePage'

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/swap" replace />} />
        <Route path="/swap" element={<SwapPage />} />
        <Route path="/stake" element={<StakePage />} />
      </Routes>
    </>
  )
}
