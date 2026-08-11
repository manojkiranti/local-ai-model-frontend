import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    openChatStream: vi.fn(),
  }
})

import { GatewayError, openChatStream } from '@/lib/api'
import { useSessions } from '@/hooks/useSessions'

const mockOpen = vi.mocked(openChatStream)

type OpenResult = Awaited<ReturnType<typeof openChatStream>>

function doneStream(opts: { error?: boolean } = {}): OpenResult {
  return {
    sessionId: 'sess-1',
    events: (async function* () {
      yield { type: 'token', content: 'hi' }
      yield {
        type: 'done',
        session_id: 'sess-1',
        stop_reason: opts.error ? 'error' : 'completed',
        iteration_count: 1,
        final_answer: 'hi',
        error_message: opts.error ? 'boom' : null,
        trace: [],
      }
    })(),
  } as OpenResult
}

describe('useSessions attachment file_ids semantics', () => {
  beforeEach(() => {
    mockOpen.mockReset()
  })

  it('sends file_ids exactly once when an attachment is provided, and stamps the user bubble', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('analyze', {
        id: 'f1',
        filename: 'a.xlsx',
        summaryLine: 'Excel · 1 row',
      })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(mockOpen).toHaveBeenCalledTimes(1)
    expect(mockOpen.mock.calls[0][0]).toMatchObject({ message: 'analyze', file_ids: ['f1'] })
    const userMsg = result.current.messages.find((m) => m.role === 'user')
    expect(userMsg?.attachment).toEqual({ filename: 'a.xlsx', summaryLine: 'Excel · 1 row' })
  })

  it('does not resend file_ids on a follow-up turn in the same session', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('first', { id: 'f1', filename: 'a.xlsx', summaryLine: 'x' })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    await act(async () => {
      result.current.send('second')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(mockOpen).toHaveBeenCalledTimes(2)
    expect(mockOpen.mock.calls[1][0]).not.toHaveProperty('file_ids')
  })

  it('re-sends file_ids on retry of an errored attachment turn', async () => {
    mockOpen.mockResolvedValue(doneStream({ error: true }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', { id: 'f1', filename: 'a.xlsx', summaryLine: 'x' })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    expect(assistant.status).toBe('error')
    expect(assistant.retryFileIds).toEqual(['f1'])
    mockOpen.mockResolvedValue(doneStream())
    await act(async () => {
      result.current.retry(assistant.id, 'q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(mockOpen.mock.calls[1][0]).toMatchObject({ file_ids: ['f1'] })
  })

  it('sends department only when creating a session', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('first', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    await act(async () => {
      result.current.send('follow-up', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(mockOpen.mock.calls[0][0]).toMatchObject({
      message: 'first',
      department: 'finance',
    })
    expect(mockOpen.mock.calls[1][0]).not.toHaveProperty('department')
  })

  it('turns a department conflict into start-a-new-chat guidance', async () => {
    mockOpen.mockRejectedValue(new GatewayError(409, 'Department mismatch'))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('question', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((message) => message.role === 'assistant')
    expect(assistant?.error).toBe(
      'This conversation belongs to a different department. Start a new chat in this department.',
    )
  })

  it('does not send unsupported generation options', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('question')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(mockOpen.mock.calls[0][0]).not.toHaveProperty('options')
  })
})
