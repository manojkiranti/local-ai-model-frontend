import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listUsers: vi.fn(),
    updateUser: vi.fn(),
  }
})

import { GatewayError, listUsers, updateUser, type UserOut } from '@/lib/api'
import { UsersPage } from '@/components/admin/UsersPage'

const mockList = vi.mocked(listUsers)
const mockUpdate = vi.mocked(updateUser)

function user(overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 1,
    email: 'alice@odin.test',
    auth_provider: 'local',
    role: 'member',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function page(items: UserOut[], total = items.length) {
  return { total, limit: 50, offset: 0, items }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UsersPage', () => {
  beforeEach(() => {
    mockList.mockResolvedValue(page([user({ id: 1, email: 'alice@odin.test', role: 'admin' })]))
    mockUpdate.mockImplementation(async (id, body) => user({ id, is_active: body.is_active }))
  })

  it('lists users with their role and status', async () => {
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    const row = screen.getByText('alice@odin.test').closest('li')!
    expect(within(row).getByText('admin')).not.toBeNull()
    expect(within(row).getByText('Active')).not.toBeNull()
  })

  it('searches by email, resetting to the first page', async () => {
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'nina' } })
    fireEvent.submit(screen.getByLabelText('Search users').closest('form')!)
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ q: 'nina', limit: 50, offset: 0 }),
    )
  })

  it('deactivates an active user by sending is_active: false', async () => {
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(1, { is_active: false }))
    // The row reflects the returned record without a full reload.
    await waitFor(() => expect(screen.getByRole('button', { name: /Activate/ })).not.toBeNull())
  })

  it('activates an inactive user by sending is_active: true', async () => {
    mockList.mockResolvedValue(page([user({ id: 5, email: 'gone@odin.test', is_active: false })]))
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(screen.getByText('gone@odin.test')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Activate/ }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(5, { is_active: true }))
  })

  // Self-deactivation is a certain refusal; the client disables it rather than
  // firing a doomed request.
  it('disables Deactivate on the signed-in admin’s own row', async () => {
    mockList.mockResolvedValue(page([user({ id: 7, email: 'me@odin.test', role: 'admin' })]))
    render(<UsersPage currentUserId={7} />)
    await waitFor(() => expect(screen.getByText('me@odin.test')).not.toBeNull())
    const button = screen.getByRole('button', { name: /Deactivate/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  // A 409 (last active admin) is a policy refusal, not an expired session: show
  // the message verbatim and leave the account active.
  it('renders a 409 refusal verbatim and keeps the account active', async () => {
    mockList.mockResolvedValue(page([user({ id: 3, email: 'boss@odin.test', role: 'admin' })]))
    mockUpdate.mockRejectedValue(
      new GatewayError(409, 'This is the last active admin; promote or activate another admin first'),
    )
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(screen.getByText('boss@odin.test')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ }))
    await waitFor(() =>
      expect(
        screen.getByText('This is the last active admin; promote or activate another admin first'),
      ).not.toBeNull(),
    )
    // Still active — the deactivate control is still the one shown.
    expect(screen.getByRole('button', { name: /Deactivate/ })).not.toBeNull()
  })

  it('advances the offset when paging forward', async () => {
    mockList.mockResolvedValue(page([user({ id: 1 })], 120))
    render(<UsersPage currentUserId={99} />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ q: '', limit: 50, offset: 50 }),
    )
  })
})
