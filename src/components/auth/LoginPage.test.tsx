import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/context/AuthContext'
import { LoginPage } from '@/components/auth/LoginPage'

afterEach(() => {
  cleanup()
})

function renderLogin(login = vi.fn(() => Promise.resolve())) {
  render(
    <AuthContext.Provider value={{ login } as unknown as AuthContextValue}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return login
}

function submit(name: string, password = 'supersecret123') {
  fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginPage', () => {
  it('signs in with a bare username — no @ needed', async () => {
    const login = renderLogin()
    const field = screen.getByLabelText('Username or email') as HTMLInputElement
    expect(field.type).toBe('text')
    expect(field.autocomplete).toBe('username')

    submit('  shristi.b ')
    await waitFor(() => expect(login).toHaveBeenCalledWith('shristi.b', 'supersecret123'))
  })

  it('still signs in with a full email', async () => {
    const login = renderLogin()
    submit('workspace-admin@example.com')
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('workspace-admin@example.com', 'supersecret123'),
    )
  })

  it('refuses a malformed name before calling the gateway', () => {
    const login = renderLogin()
    submit('shristi b')
    expect(screen.getByText('Enter a valid username or email address.')).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
  })
})
