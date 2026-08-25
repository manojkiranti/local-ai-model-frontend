import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listMcpGrants: vi.fn(),
    grantMcpGrant: vi.fn(),
    revokeMcpGrant: vi.fn(),
  }
})

import {
  GatewayError,
  grantMcpGrant,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
} from '@/lib/api'
import { useMcpGrants } from '@/hooks/useMcpGrants'

const mockList = vi.mocked(listMcpGrants)
const mockGrant = vi.mocked(grantMcpGrant)
const mockRevoke = vi.mocked(revokeMcpGrant)

const ORIGINAL = '2026-08-01T09:00:00Z'

function grant(key: string, granted_at = ORIGINAL): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function list(items: McpGrant[]) {
  return { user_id: 42, items }
}

describe('useMcpGrants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue(list([]))
    mockGrant.mockResolvedValue(list([grant('mcp-hrms')]))
    mockRevoke.mockResolvedValue(undefined)
  })

  it('loads the grants for the given user', async () => {
    mockList.mockResolvedValue(list([grant('mcp-izone')]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith(42, expect.any(AbortSignal))
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-izone'])
  })

  it('replaces the list with whatever the POST returns', async () => {
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.grant('mcp-hrms')
    })
    expect(mockGrant).toHaveBeenCalledWith(42, 'mcp-hrms')
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-hrms'])
  })

  // POST is idempotent and does NOT rewrite granted_at. The hook must keep what
  // the server sent rather than stamping "now".
  it('keeps the original granted_at when a grant is re-granted', async () => {
    mockList.mockResolvedValue(list([grant('mcp-hrms', ORIGINAL)]))
    mockGrant.mockResolvedValue(list([grant('mcp-hrms', ORIGINAL)]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.grant('mcp-hrms')
    })
    expect(result.current.items[0].granted_at).toBe(ORIGINAL)
  })

  it('drops a key locally once the DELETE has resolved', async () => {
    mockList.mockResolvedValue(list([grant('mcp-ems'), grant('mcp.ems.query')]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.revoke('mcp.ems.query')
    })
    expect(mockRevoke).toHaveBeenCalledWith(42, 'mcp.ems.query')
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-ems'])
  })

  it('leaves the row in place when a revoke fails', async () => {
    mockList.mockResolvedValue(list([grant('mcp-ems')]))
    mockRevoke.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.revoke('mcp-ems')
    })
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-ems'])
    expect(result.current.error).toBe('Admin privileges required')
  })

  it('surfaces a 403 on load as an error string, not a thrown value', async () => {
    mockList.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Admin privileges required')
    expect(result.current.items).toEqual([])
  })

  // Every POST returns the WHOLE list, so two writes in flight can resolve out
  // of order and the loser's list overwrites the winner's. One at a time.
  it('refuses a second write while one is in flight', async () => {
    let release: (() => void) | null = null
    mockGrant.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(list([grant('mcp-hrms')]))
        }),
    )
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.grant('mcp-hrms')
    })
    await waitFor(() => expect(result.current.busy).toBe('mcp-hrms'))
    await act(async () => {
      await result.current.grant('mcp-ems')
    })
    expect(mockGrant).toHaveBeenCalledTimes(1)

    await act(async () => {
      release!()
      await first
    })
    expect(result.current.busy).toBeNull()
  })
})
