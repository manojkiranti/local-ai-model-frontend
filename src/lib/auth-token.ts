/**
 * JWT token store: in-memory value mirrored to localStorage, plus a single
 * "unauthorized" callback the API client fires on any 401 so the React layer
 * can clear the session and redirect to /login. Kept React-free on purpose.
 */
const STORAGE_KEY = 'ollama-workspace-token'

let token: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function getToken(): string | null {
  if (token !== null) return token
  try {
    token = localStorage.getItem(STORAGE_KEY)
  } catch {
    token = null
  }
  return token
}

export function setToken(next: string): void {
  token = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Non-fatal: keep the in-memory copy.
  }
}

export function clearToken(): void {
  token = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Non-fatal.
  }
}

export function registerUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.()
}
