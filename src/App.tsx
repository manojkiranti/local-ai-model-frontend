import { Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/components/auth/LoginPage'
import { RegisterPage } from '@/components/auth/RegisterPage'
import { ProtectedRoute } from '@/components/routing/ProtectedRoute'
import { PublicOnly } from '@/components/routing/PublicOnly'
import { Workspace } from '@/components/workspace/Workspace'

function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Workspace />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
//main
export default App
