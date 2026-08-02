import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullScreenSpinner } from './FullScreenSpinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  return <>{children}</>
}
