import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listUsers: vi.fn(),
    updateUser: vi.fn(),
    listMcpGrants: vi.fn(),
    grantMcpGrant: vi.fn(),
    revokeMcpGrant: vi.fn(),
  }
})

import {
  GatewayError,
  grantMcpGrant,
  listMcpGrants,
  listUsers,
  revokeMcpGrant,
  updateUser,
  type McpGrant,
  type UserOut,
} from '@/lib/api'
import { UserDetailPage } from '@/components/admin/UserDetailPage'

const mockListUsers = vi.mocked(listUsers)
const mockUpdateUser = vi.mocked(updateUser)
const mockListGrants = vi.mocked(listMcpGrants)
const mockGrant = vi.mocked(grantMcpGrant)
const mockRevoke = vi.mocked(revokeMcpGrant)

function user(overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 42,
    email: 'alice@odin.test',
    auth_provider: 'local',
    role: 'member',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function grant(key: string, granted_at = '2026-08-01T12:00:00Z'): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function renderDetail(id = 42, currentUserId = 661) {
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${id}`]}>
      <Routes>
        <Route
          path="/admin/users/:id"
          element={<UserDetailPage currentUserId={currentUserId} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserDetailPage', () => {
  beforeEach(() => {
    mockListUsers.mockResolvedValue({
      total: 2,
      limit: 200,
      offset: 0,
      items: [user(), user({ id: 661, email: 'ops@odin.test', role: 'admin' })],
    })
    mockListGrants.mockResolvedValue({ user_id: 42, items: [] })
    mockGrant.mockResolvedValue({ user_id: 42, items: [grant('mcp-hrms')] })
    mockRevoke.mockResolvedValue(undefined)
    mockUpdateUser.mockImplementation(async (id, body) => user({ id, is_active: body.is_active }))
  })

  it('resolves the user’s email from the directory on a cold link', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    expect(mockListGrants).toHaveBeenCalledWith(42, expect.any(AbortSignal))
  })

  it('falls back to the id when the directory cannot resolve it', async () => {
    mockListUsers.mockResolvedValue({ total: 0, limit: 200, offset: 0, items: [] })
    renderDetail(4242)
    await waitFor(() => expect(screen.getByText(/User #4242/)).not.toBeNull())
  })

  it('grants a key through the panel', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByLabelText('Staff directory')).not.toBeNull())
    fireEvent.click(screen.getByLabelText('Staff directory'))
    await waitFor(() => expect(mockGrant).toHaveBeenCalledWith(42, 'mcp-hrms'))
  })

  // Every write returns the WHOLE list, and an untouched grant keeps the
  // granted_at the gateway already had. Neither may re-render as “just now”.
  it('renders the timestamps the server returned after a write', async () => {
    const original = grant('mcp-hrms', '2026-08-01T12:00:00Z')
    mockListGrants.mockResolvedValue({ user_id: 42, items: [original] })
    mockGrant.mockResolvedValue({
      user_id: 42,
      items: [original, grant('mcp-izone', '2026-08-20T12:00:00Z')],
    })
    renderDetail()
    await waitFor(() => expect(screen.getByText(/1 Aug 2026/)).not.toBeNull())
    fireEvent.click(screen.getByLabelText('iZone access'))
    await waitFor(() => expect(screen.getByText(/20 Aug 2026/)).not.toBeNull())
    // The untouched grant still shows its ORIGINAL date.
    expect(screen.getByText(/1 Aug 2026/)).not.toBeNull()
    expect(screen.queryByText(/just now/i)).toBeNull()
  })

  it('revokes a key through the panel', async () => {
    mockListGrants.mockResolvedValue({ user_id: 42, items: [grant('mcp-izone')] })
    renderDetail()
    await waitFor(() => expect(screen.getByLabelText('iZone access')).not.toBeNull())
    fireEvent.click(screen.getByLabelText('iZone access'))
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(42, 'mcp-izone'))
  })

  // 403 is a policy refusal from a signed-in caller. Rendered in place, no
  // redirect — the route deliberately has no client-side guard.
  it('renders a 403 in place with the gateway’s wording', async () => {
    mockListGrants.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Admin privileges required')).not.toBeNull())
  })

  it('renders a 404 for an unknown user without losing the way back', async () => {
    mockListGrants.mockRejectedValue(new GatewayError(404, 'Unknown user'))
    renderDetail(999)
    await waitFor(() => expect(screen.getByText('Unknown user')).not.toBeNull())
    expect(screen.getByRole('link', { name: /Users/ })).not.toBeNull()
  })

  // Rule 1 again, at the page level: an admin's own row is not special-cased.
  it('lets an admin manage their own grants', async () => {
    mockListGrants.mockResolvedValue({ user_id: 661, items: [] })
    renderDetail(661, 661)
    await waitFor(() => expect(screen.getByLabelText('SQL console')).not.toBeNull())
    const box = screen.getByLabelText('SQL console') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(screen.getByText(/does not confer tool access/i)).not.toBeNull()
  })

  it('disables deactivating your own account', async () => {
    renderDetail(661, 661)
    await waitFor(() => expect(screen.getByText('ops@odin.test')).not.toBeNull())
    const button = screen.getByRole('button', { name: /Deactivate/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('renders a 409 deactivation refusal verbatim', async () => {
    mockUpdateUser.mockRejectedValue(
      new GatewayError(409, 'This is the last active admin; promote or activate another admin first'),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ }))
    await waitFor(() =>
      expect(
        screen.getByText('This is the last active admin; promote or activate another admin first'),
      ).not.toBeNull(),
    )
  })
})
