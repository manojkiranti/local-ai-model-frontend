import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getToolAccess,
  resetToolGroupAccess,
  setToolGroupAccess,
  type ToolAccessList,
} from '@/lib/api'
import { clearToken, getToken, registerUnauthorizedHandler, setToken } from '@/lib/auth-token'

const list: ToolAccessList = {
  user_id: 42,
  groups: [
    {
      id: 'external',
      label: 'External sources',
      tools: ['fetch_url', 'get_nrb_forex'],
      allowed: true,
      default_allowed: false,
      state: 'granted',
      updated_at: '2026-10-02T10:00:00Z',
      updated_by: 1,
    },
  ],
  items: [],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('tool access client', () => {
  beforeEach(() => setToken('tok.tools'))
  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('GETs one user’s tool access', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(list))
    const got = await getToolAccess(42)
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8000/v1/users/42/tool-access')
    expect(got.groups[0].id).toBe('external')
  })

  // extra="forbid" on the gateway: anything but `allowed` is a 422.
  it('PUTs exactly { allowed } to the group’s own path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(list))
    await setToolGroupAccess(42, 'create', false)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/users/42/tool-access/groups/create')
    expect(init!.method).toBe('PUT')
    expect(JSON.parse(String(init!.body))).toEqual({ allowed: false })
  })

  it('DELETEs to reset a group and returns the list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(list))
    const got = await resetToolGroupAccess(42, 'external')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/users/42/tool-access/groups/external')
    expect(init!.method).toBe('DELETE')
    expect(got.groups).toHaveLength(1)
  })

  it('keeps the session on a 403 and surfaces the detail verbatim', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'Admin privileges required' }, 403))
    await expect(setToolGroupAccess(42, 'external', true)).rejects.toMatchObject({
      status: 403,
      message: 'Admin privileges required',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(getToken()).toBe('tok.tools')
  })

  // The crash this guards: an older gateway's `groups: ['Everyday', …]` reached
  // the panel, `group.tools.join` threw, and the whole user page went blank.
  it('names an out-of-date gateway instead of handing the panel bare group labels', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ user_id: 42, groups: ['Everyday', 'External'], items: [] }),
    )
    await expect(getToolAccess(42)).rejects.toMatchObject({
      name: 'ContractError',
      message: expect.stringContaining('predates group-level tool access'),
    })
  })
})
