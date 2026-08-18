import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import { LoginPage } from '@/components/auth/LoginPage'
import { getNrbStatus } from '@/lib/api'
import { clearToken, getToken, setToken } from '@/lib/auth-token'

const SESSION_EXPIRED = 'Your session expired. Please sign in again.'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A stand-in workspace page that makes one admin-only call on mount. */
function Probe() {
  return (
    <button type="button" onClick={() => void getNrbStatus().catch(() => {})}>
      Load NRB
    </button>
  )
}

function renderApp(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Probe />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearToken()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearToken()
})

describe('expired session (401)', () => {
  it('returns to login with a notice and drops the stored token', async () => {
    setToken('tok.expired')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Could not validate credentials' }, 401),
    )
    renderApp()
    // The provider's own /users/me restore hits the same 401.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull(),
    )
    expect(screen.getByText(SESSION_EXPIRED)).not.toBeNull()
    expect(getToken()).toBeNull()
  })

  it('does not claim a session expired on an ordinary visit to login', async () => {
    renderApp('/login')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull(),
    )
    expect(screen.queryByText(SESSION_EXPIRED)).toBeNull()
  })
})

describe('non-admin (403)', () => {
  it('keeps the session and never loops back to login', async () => {
    setToken('tok.member')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/users/me')) {
        return jsonResponse(
          {
            id: 2,
            email: 'member@odin.test',
            auth_provider: 'local',
            role: 'member',
            is_active: true,
            created_at: '2026-08-01T00:00:00Z',
            updated_at: '2026-08-01T00:00:00Z',
          },
          200,
        )
      }
      return jsonResponse({ detail: 'Admin privileges required' }, 403)
    })
    renderApp()
    const button = await screen.findByRole('button', { name: 'Load NRB' })
    button.click()

    await waitFor(() => expect(getToken()).toBe('tok.member'))
    // Still on the workspace route: a 403 is not an expiry.
    expect(screen.getByRole('button', { name: 'Load NRB' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByText(SESSION_EXPIRED)).toBeNull()
  })
})
