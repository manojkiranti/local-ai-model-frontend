import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMe,
  login as apiLogin,
  register as apiRegister,
  type UserOut,
} from '@/lib/api'
import {
  clearToken,
  getToken,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  user: UserOut | null
  status: AuthStatus
  /** Role flag for later admin-only UI (no admin screens yet). */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserOut | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  // Any 401 anywhere clears the session and returns to /login.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setUser(null)
      setStatus('unauthenticated')
      navigate('/login', { replace: true })
    })
  }, [navigate])

  // Restore the session on app load.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!getToken()) {
        setStatus('unauthenticated')
        return
      }
      try {
        const me = await getMe()
        if (!cancelled) {
          setUser(me)
          setStatus('authenticated')
        }
      } catch {
        // 401 handled by the unauthorized handler; any other failure also
        // means we can't trust the token → logged out.
        if (!cancelled) {
          clearToken()
          setUser(null)
          setStatus('unauthenticated')
        }
      }
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password)
    setToken(res.access_token)
    const me = await getMe()
    setUser(me)
    setStatus('authenticated')
  }, [])

  const register = useCallback(
    async (email: string, password: string) => {
      // Register returns the user (not a token), so log in afterwards.
      await apiRegister(email, password)
      await login(email, password)
    },
    [login],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setStatus('unauthenticated')
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <AuthContext.Provider
      value={{ user, status, isAdmin: user?.role === 'admin', login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
