import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayError, getNrbRun, getNrbStatus, triggerNrbRun } from '@/lib/api'
import { clearToken, registerUnauthorizedHandler, setToken } from '@/lib/auth-token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const RUN = {
  id: 7,
  trigger: 'api',
  requested_by: 'admin@odin.test',
  status: 'queued',
  stage: 'sync',
  department: 'research',
  scope: { limit: 25 },
  counters: {},
  error: null,
  jobs: {},
  created_at: '2026-08-17T10:00:00+00:00',
  started_at: null,
  finished_at: null,
}

describe('NRB gateway client', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('reads the status block with the bearer token attached', async () => {
    setToken('tok.abc')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        active_run: null,
        latest_run: RUN,
        catalog: { sources: 3 },
        files: { pending: 1 },
        rag: { ready: 2, documents: { ready: 2 } },
      }),
    )
    const status = await getNrbStatus()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/nrb/status')
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.abc')
    expect(status.latest_run?.id).toBe(7)
    expect(status.rag).toEqual({ ready: 2, documents: { ready: 2 } })
  })

  it('reads one run by id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(RUN))
    const run = await getNrbRun(7)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8000/v1/nrb/runs/7',
    )
    expect(run.status).toBe('queued')
  })

  it('posts the trigger body and returns the accepted run on 202', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ started: true, run: RUN, detail: null }, 202))
    const result = await triggerNrbRun({
      department: 'research',
      stages: ['sync', 'fetch', 'extract', 'rag'],
      retry_failed: false,
      limit: 25,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/nrb/runs')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({
      department: 'research',
      stages: ['sync', 'fetch', 'extract', 'rag'],
      retry_failed: false,
      limit: 25,
    })
    expect(result.started).toBe(true)
    expect(result.run?.id).toBe(7)
  })

  it('treats 409 as an answer, not an error, and keeps the in-progress run', async () => {
    // 202 and 409 share one envelope; a client branches on `started` only.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          started: false,
          run: { ...RUN, status: 'running' },
          detail: 'run 7 is running',
        },
        409,
      ),
    )
    const result = await triggerNrbRun({
      department: 'research',
      stages: ['rag'],
      retry_failed: true,
      limit: 5,
    })
    expect(result.started).toBe(false)
    expect(result.run?.status).toBe('running')
    expect(result.detail).toBe('run 7 is running')
  })

  it('returns the detail when a 409 names no run', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { started: false, run: null, detail: 'the pipeline lock is held' },
        409,
      ),
    )
    const result = await triggerNrbRun({
      department: 'research',
      stages: ['rag'],
      retry_failed: true,
      limit: 5,
    })
    expect(result.run).toBeNull()
    expect(result.detail).toBe('the pipeline lock is held')
  })

  it('throws the gateway detail for a rejected scope (422)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'a bounded scope is required' }, 422),
    )
    await expect(
      triggerNrbRun({ department: 'research', stages: ['rag'], retry_failed: false }),
    ).rejects.toThrow('a bounded scope is required')
  })

  it('throws a 403 for a signed-in non-admin without clearing the session', async () => {
    setToken('tok.member')
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Admin privileges required' }, 403),
    )
    await expect(getNrbStatus()).rejects.toMatchObject({
      status: 403,
      message: 'Admin privileges required',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('clears the session on a 401 from an NRB call', async () => {
    setToken('tok.expired')
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Could not validate credentials' }, 401),
    )
    await expect(getNrbStatus()).rejects.toBeInstanceOf(GatewayError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
