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

import { GatewayError, getSession, openChatStream } from '@/lib/api'
import { useSessions } from '@/hooks/useSessions'

const mockOpen = vi.mocked(openChatStream)
const mockGetSession = vi.mocked(getSession)

type OpenResult = Awaited<ReturnType<typeof openChatStream>>

function doneStream(opts: { error?: boolean; sources?: unknown } = {}): OpenResult {
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
        // null = this turn searched no corpus (every general-chat turn).
        sources: opts.sources ?? null,
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
    expect(userMsg?.attachment).toEqual({
      fileId: 'f1',
      filename: 'a.xlsx',
      summaryLine: 'Excel · 1 row',
    })
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

  it('labels a read_document tool call with the active filename', async () => {
    let finish!: () => void
    const continueStream = new Promise<void>((resolve) => {
      finish = resolve
    })
    mockOpen.mockResolvedValue({
      sessionId: 'sess-1',
      events: (async function* () {
        yield {
          type: 'tool_call',
          name: 'read_document',
          arguments: { file_id: 'f1' },
          iteration: 1,
        }
        await continueStream
        yield {
          type: 'done',
          session_id: 'sess-1',
          stop_reason: 'completed',
          iteration_count: 1,
          final_answer: 'done',
          error_message: null,
          trace: [],
        }
      })(),
    } as OpenResult)

    const { result } = renderHook(() => useSessions())
    act(() => {
      result.current.send('read it', {
        id: 'f1',
        filename: 'policy.pdf',
        summaryLine: 'PDF · 2 pages',
      })
    })
    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant')
      expect(assistant?.liveTools?.[0]?.label).toBe('reading policy.pdf…')
    })
    finish()
    await waitFor(() => expect(result.current.sending).toBe(false))
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

  it('turns an owner-scoped attached-file 404 into an attachment error', async () => {
    mockOpen.mockRejectedValue(new GatewayError(404, 'unknown file'))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('question', { id: 'foreign', filename: 'x.pdf', summaryLine: 'PDF' })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((message) => message.role === 'assistant')
    expect(assistant?.error).toBe('That file is no longer available.')
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
  it('labels a read_image tool call with the active filename', async () => {
    let finish!: () => void
    const continueStream = new Promise<void>((resolve) => {
      finish = resolve
    })
    mockOpen.mockResolvedValue({
      sessionId: 'sess-1',
      events: (async function* () {
        yield {
          type: 'tool_call',
          name: 'read_image',
          arguments: { file_id: 'img-1' },
          iteration: 1,
        }
        await continueStream
        yield {
          type: 'done',
          session_id: 'sess-1',
          stop_reason: 'completed',
          iteration_count: 1,
          final_answer: 'done',
          error_message: null,
          trace: [],
        }
      })(),
    } as OpenResult)

    const { result } = renderHook(() => useSessions())
    act(() => {
      result.current.send('what does this say?', {
        id: 'img-1',
        filename: 'payslip.png',
        summaryLine: 'PNG image · 900 × 420',
        isImage: true,
      })
    })
    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant')
      expect(assistant?.liveTools?.[0]?.label).toBe('reading payslip.png…')
    })
    finish()
    await waitFor(() => expect(result.current.sending).toBe(false))
  })

  it('stamps an image user bubble with its file id and image flag', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('read it', {
        id: 'img-1',
        filename: 'payslip.png',
        summaryLine: 'PNG image · 900 × 420',
        isImage: true,
        warning: 'Only the first of 3 pages in this image will be read.',
      })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'user')?.attachment).toEqual({
      fileId: 'img-1',
      filename: 'payslip.png',
      summaryLine: 'PNG image · 900 × 420',
      isImage: true,
      warning: 'Only the first of 3 pages in this image will be read.',
    })
  })
})

// The OCR caveat must be driven off the tool signal, never the model's wording:
// read_image warns the model that figures need verifying and the model does not
// reliably relay it.
describe('useSessions OCR provenance', () => {
  beforeEach(() => {
    mockOpen.mockReset()
  })

  function ocrStream(opts: { status?: string; trace?: unknown } = {}): OpenResult {
    return {
      sessionId: 'sess-1',
      events: (async function* () {
        yield {
          type: 'tool_call',
          name: 'read_image',
          arguments: { file_id: 'img-1' },
          iteration: 1,
        }
        yield {
          type: 'tool_result',
          name: 'read_image',
          status: opts.status ?? 'ok',
          result: 'Net Pay: 6,518.00',
          iteration: 1,
        }
        yield { type: 'token', content: 'It says 6,518.00' }
        yield {
          type: 'done',
          session_id: 'sess-1',
          stop_reason: 'completed',
          iteration_count: 1,
          final_answer: 'It says 6,518.00',
          error_message: null,
          trace: opts.trace ?? [],
        }
      })(),
    } as OpenResult
  }

  it('marks the answer as OCR-derived from the live stream, with the image id', async () => {
    mockOpen.mockResolvedValue(ocrStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('what does this say?', {
        id: 'img-1',
        filename: 'payslip.png',
        summaryLine: 'PNG image · 900 × 420',
        isImage: true,
      })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')
    expect(assistant?.ocr).toEqual({ imageIds: ['img-1'] })
  })

  // Trace exposure can be disabled server-side, so the badge must not depend
  // on the trace being present.
  it('marks it OCR-derived even when the terminal trace is empty', async () => {
    mockOpen.mockResolvedValue(ocrStream({ trace: [] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', { id: 'img-1', filename: 'p.png', summaryLine: 's', isImage: true })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.ocr).toEqual({
      imageIds: ['img-1'],
    })
  })

  it('does not mark it OCR-derived when the read failed', async () => {
    mockOpen.mockResolvedValue(ocrStream({ status: 'tool_error' }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', { id: 'img-1', filename: 'p.png', summaryLine: 's', isImage: true })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.ocr).toBeUndefined()
  })

  it('leaves a plain text turn unmarked', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('hello')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.ocr).toBeUndefined()
  })

  it('recovers provenance from the terminal trace when the id was only there', async () => {
    mockOpen.mockResolvedValue({
      sessionId: 'sess-1',
      events: (async function* () {
        yield {
          type: 'done',
          session_id: 'sess-1',
          stop_reason: 'completed',
          iteration_count: 1,
          final_answer: 'reads 6,518.00',
          error_message: null,
          trace: [
            {
              iteration: 1,
              assistant_content: null,
              tool_calls: [
                {
                  name: 'read_image',
                  arguments: { file_id: 'img-9' },
                  result: 'text',
                  status: 'ok',
                },
              ],
            },
          ],
        }
      })(),
    } as OpenResult)
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.ocr).toEqual({
      imageIds: ['img-9'],
    })
  })

  it('clears provenance when the turn is retried', async () => {
    mockOpen.mockResolvedValue(ocrStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', { id: 'img-1', filename: 'p.png', summaryLine: 's', isImage: true })
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    mockOpen.mockResolvedValue(doneStream())
    await act(async () => {
      result.current.retry(assistant.id, 'q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.id === assistant.id)?.ocr).toBeUndefined()
  })
})


// Citations are resolved against the FINAL answer's [N] markers, so they exist
// only on the terminal `done` event — and `null` (no corpus searched) must stay
// distinguishable from `[]` (searched, nothing surfaced).
describe('useSessions source citations', () => {
  const NRB_SOURCE = {
    document_id: 'doc-1',
    title: 'Monetary Policy 2081/82',
    department_code: 'finance',
    file_name: 'monetary-policy.pdf',
    file_type: 'pdf',
    pages: [4, 5],
    cited: true,
    download_url: '/v1/departments/finance/documents/doc-1/download',
    origin: 'nrb',
    source_url: 'https://www.nrb.org.np/monetary-policy',
    published_at: '2024-07-12',
    routes: ['ocr'],
    machine_recovered: true,
    verify_note: 'machine-recovered — VERIFY figures, dates and names against the source',
  }

  beforeEach(() => {
    mockOpen.mockReset()
    mockGetSession.mockReset()
  })

  it('carries the citations from the terminal done event', async () => {
    mockOpen.mockResolvedValue(doneStream({ sources: [NRB_SOURCE] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('what is the CRR?', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.sources).toEqual([
      NRB_SOURCE,
    ])
  })

  it('records null for a turn that searched no corpus', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('hello')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.sources).toBeNull()
  })

  // A search that surfaced nothing is NOT the same as no search: the UI says so.
  it('keeps an empty citation list distinct from null', async () => {
    mockOpen.mockResolvedValue(doneStream({ sources: [] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('anything on leave?', undefined, 'hr')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.sources).toEqual([])
  })

  it('has no citations while the answer is still streaming', async () => {
    let finish!: () => void
    const continueStream = new Promise<void>((resolve) => {
      finish = resolve
    })
    mockOpen.mockResolvedValue({
      sessionId: 'sess-1',
      events: (async function* () {
        yield { type: 'token', content: 'The CRR is' }
        await continueStream
        yield {
          type: 'done',
          session_id: 'sess-1',
          stop_reason: 'completed',
          iteration_count: 1,
          final_answer: 'The CRR is 4% [1]',
          error_message: null,
          trace: [],
          sources: [NRB_SOURCE],
        }
      })(),
    } as OpenResult)

    const { result } = renderHook(() => useSessions())
    act(() => {
      result.current.send('what is the CRR?', undefined, 'finance')
    })
    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant')
      expect(assistant?.content).toBe('The CRR is')
    })
    expect(
      result.current.messages.find((m) => m.role === 'assistant')?.sources ?? null,
    ).toBeNull()
    finish()
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.role === 'assistant')?.sources).toEqual([
      NRB_SOURCE,
    ])
  })

  it('shows no citations on a failed turn', async () => {
    mockOpen.mockResolvedValue(doneStream({ error: true, sources: [NRB_SOURCE] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')
    expect(assistant?.status).toBe('error')
    expect(assistant?.sources).toBeNull()
  })

  // A reloaded thread must render identically to the live turn.
  it('replays citations from persisted history', async () => {
    // Resolved deliberately after the selection has rendered, as a real request
    // is: the thread is only adopted while it is still the active session.
    let deliver!: (detail: Awaited<ReturnType<typeof getSession>>) => void
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve
      }),
    )
    const thread = {
      id: 'sess-9',
      title: 'CRR',
      created_at: '2026-08-19T00:00:00Z',
      updated_at: '2026-08-19T00:00:00Z',
      messages: [
        {
          id: 'm1',
          seq: 1,
          role: 'user',
          content: 'what is the CRR?',
          trace: null,
          sources: null,
          model: null,
          created_at: '2026-08-19T00:00:00Z',
        },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          content: 'The CRR is 4% [1]',
          trace: null,
          sources: [NRB_SOURCE],
          model: 'qwen3',
          created_at: '2026-08-19T00:00:01Z',
        },
      ],
    }
    const { result } = renderHook(() => useSessions())
    act(() => {
      void result.current.selectSession('sess-9')
    })
    await act(async () => {
      deliver(thread as Awaited<ReturnType<typeof getSession>>)
    })
    await waitFor(() => expect(result.current.messages.length).toBe(2))
    expect(result.current.messages[1].sources).toEqual([NRB_SOURCE])
    expect(result.current.messages[0].sources).toBeNull()
  })

  it('drops the citations when the turn is retried', async () => {
    mockOpen.mockResolvedValue(doneStream({ sources: [NRB_SOURCE] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q', undefined, 'finance')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    mockOpen.mockResolvedValue(doneStream())
    await act(async () => {
      result.current.retry(assistant.id, 'q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.messages.find((m) => m.id === assistant.id)?.sources).toBeNull()
  })
})
