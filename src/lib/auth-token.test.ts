import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearToken,
  getToken,
  notifyUnauthorized,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

afterEach(() => {
  clearToken()
  localStorage.clear()
  registerUnauthorizedHandler(() => {})
})

describe('auth-token', () => {
  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('persists a token to localStorage and reads it back', () => {
    setToken('abc.def.ghi')
    expect(getToken()).toBe('abc.def.ghi')
    expect(localStorage.getItem('ollama-workspace-token')).toBe('abc.def.ghi')
  })

  it('clears the token from memory and localStorage', () => {
    setToken('abc.def.ghi')
    clearToken()
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('ollama-workspace-token')).toBeNull()
  })

  it('invokes the registered handler on notifyUnauthorized', () => {
    const spy = vi.fn()
    registerUnauthorizedHandler(spy)
    notifyUnauthorized()
    expect(spy).toHaveBeenCalledOnce()
  })
})
