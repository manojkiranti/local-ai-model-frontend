import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteSession as apiDeleteSession,
  describeError,
  getSession,
  listSessions,
  openChatStream,
  GatewayError,
  type SessionSummary,
  type ThreadMessage,
  type ToolCallStatus,
  type TraceEntry,
} from '@/lib/api'
import { extractFileRefs, type FileRef } from '@/lib/agent-api'
import { uid } from '@/lib/uid'

export type MessageStatus = 'streaming' | 'done' | 'error'

/** A tool call surfaced live from the event stream, before the final trace lands. */
export interface LiveTool {
  name: string
  status: 'running' | ToolCallStatus
  iteration: number
}

export interface AttachmentDescriptor {
  id: string
  filename: string
  summaryLine: string
}

/** One rendered chat bubble — from server history or an in-flight optimistic turn. */
export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  error?: string
  /** Non-null when the turn called tools → renders the "How it worked" panel. */
  trace?: TraceEntry[] | null
  /** Live tool timeline while streaming; cleared once the turn is done. */
  liveTools?: LiveTool[]
  files?: FileRef[]
  model?: string | null
  /** Present on a failed assistant turn — the user text to re-send on Retry. */
  retryText?: string
  /** file_ids to re-send on Retry (mirrors the original turn's attachment). */
  retryFileIds?: string[]
  /** Present on a user bubble that carried an uploaded spreadsheet. */
  attachment?: { filename: string; summaryLine: string }
}

/** Mark the most recent still-running call with this name as finished. */
function settleTool(
  tools: LiveTool[] | undefined,
  name: string,
  status: ToolCallStatus,
): LiveTool[] {
  const list = tools ? [...tools] : []
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].name === name && list[i].status === 'running') {
      list[i] = { ...list[i], status }
      break
    }
  }
  return list
}

function threadToUI(m: ThreadMessage, index: number, thread: ThreadMessage[]): UIMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    status: 'done',
    trace: m.trace,
    files: extractFileRefs(m.content, m.trace),
    model: m.model,
    ...(m.role === 'assistant' && index > 0 && thread[index - 1]?.role === 'user'
      ? { retryText: thread[index - 1].content }
      : {}),
  }
}

/**
 * Server-owned conversation state. The sidebar and thread come from
 * `/v1/sessions`; a turn sends only the new message to the single `/v1/chat`
 * endpoint (stateful, tool-capable, streaming). New conversations get their id
 * from the `X-Session-Id` header (or the terminal `done` event) and are then
 * adopted as active.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(null)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, intentionally synced during render
  activeIdRef.current = activeId

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      // 401 is handled globally by the client; ignore transient list failures.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load session list on mount
    refreshSessions()
  }, [refreshSessions])

  const patch = useCallback(
    (id: string, patchFn: (m: UIMessage) => Partial<UIMessage>) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patchFn(m) } : m)))
    },
    [],
  )

  const newChat = useCallback(() => {
    controllerRef.current?.abort()
    setActiveId(null)
    setMessages([])
  }, [])

  const selectSession = useCallback(async (id: string) => {
    if (id === activeIdRef.current) return
    controllerRef.current?.abort()
    setActiveId(id)
    setMessages([])
    setLoadingThread(true)
    try {
      const detail = await getSession(id)
      if (activeIdRef.current === id) setMessages(detail.messages.map(threadToUI))
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) {
        setSessions((prev) => prev.filter((s) => s.id !== id))
        if (activeIdRef.current === id) {
          setActiveId(null)
          setMessages([])
        }
      }
    } finally {
      setLoadingThread(false)
    }
  }, [])

  const removeSession = useCallback(async (id: string) => {
    try {
      await apiDeleteSession(id)
    } catch (e) {
      // 404 = already gone → still drop it; other failures leave it in place.
      if (!(e instanceof GatewayError && e.status === 404)) return
    }
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeIdRef.current === id) {
      controllerRef.current?.abort()
      setActiveId(null)
      setMessages([])
    }
  }, [])

  /** Execute one turn against `assistantId`, reused by send() and retry(). */
  const runTurn = useCallback(
    async (
      assistantId: string,
      text: string,
      fileIds?: string[],
      department?: string,
    ) => {
      const sessionForTurn = activeIdRef.current ?? undefined
      const controller = new AbortController()
      controllerRef.current = controller
      setSending(true)

      // New conversation: adopt the server's session id once we learn it.
      const adopt = (sid: string | null | undefined) => {
        if (sid && !activeIdRef.current) {
          activeIdRef.current = sid
          setActiveId(sid)
        }
      }

      try {
        const { sessionId, events } = await openChatStream(
          {
            session_id: sessionForTurn,
            message: text,
            ...(fileIds && fileIds.length ? { file_ids: fileIds } : {}),
            ...(!sessionForTurn && department ? { department } : {}),
          },
          controller.signal,
        )
        adopt(sessionId)

        for await (const ev of events) {
          if (ev.type === 'token') {
            const delta = ev.content
            if (delta) patch(assistantId, (m) => ({ content: m.content + delta }))
          } else if (ev.type === 'tool_call') {
            patch(assistantId, (m) => ({
              liveTools: [
                ...(m.liveTools ?? []),
                { name: ev.name, status: 'running', iteration: ev.iteration },
              ],
            }))
          } else if (ev.type === 'tool_result') {
            patch(assistantId, (m) => ({
              liveTools: settleTool(m.liveTools, ev.name, ev.status),
            }))
          } else if (ev.type === 'done') {
            adopt(ev.session_id)
            const trace = ev.trace && ev.trace.length ? ev.trace : null
            if (ev.stop_reason === 'error') {
              patch(assistantId, () => ({
                status: 'error',
                error: ev.error_message ?? 'The model reported an error.',
                retryText: text,
                retryFileIds: fileIds,
                liveTools: undefined,
                trace,
              }))
            } else {
              patch(assistantId, (m) => {
                const finalContent =
                  m.content ||
                  ev.final_answer ||
                  '_The model finished without a text answer._'
                return {
                  status: 'done',
                  content: finalContent,
                  retryText: text,
                  trace,
                  files: extractFileRefs(finalContent, trace),
                  liveTools: undefined,
                }
              })
            }
          }
        }

        // Stream ended without an explicit `done` (defensive) — settle the bubble.
        patch(assistantId, (m) =>
          m.status === 'streaming' ? { status: 'done', liveTools: undefined } : {},
        )
        await refreshSessions()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          patch(assistantId, (m) => ({
            status: 'done',
            content: m.content || '_Stopped._',
            liveTools: undefined,
          }))
        } else {
          const message =
            e instanceof GatewayError && e.status === 409
              ? 'This conversation belongs to a different department. Start a new chat in this department.'
              : e instanceof GatewayError &&
                  e.status === 404 &&
                  e.message.toLowerCase().includes('attached file not found')
                ? 'That file is no longer available.'
                : describeError(e)
          patch(assistantId, () => ({
            status: 'error',
            error: message,
            retryText: text,
            retryFileIds: fileIds,
            liveTools: undefined,
          }))
          // The user message may have been persisted (e.g. 502) — refresh the list.
          refreshSessions().catch(() => {})
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
        setSending(false)
      }
    },
    [patch, refreshSessions],
  )

  const send = useCallback(
    (
      text: string,
      attachment?: AttachmentDescriptor,
      department?: string,
    ) => {
      const assistantId = uid()
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'user',
          content: text,
          status: 'done',
          ...(attachment
            ? { attachment: { filename: attachment.filename, summaryLine: attachment.summaryLine } }
            : {}),
        },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming', retryText: text },
      ])
      void runTurn(
        assistantId,
        text,
        attachment ? [attachment.id] : undefined,
        department,
      )
    },
    [runTurn],
  )

  const retry = useCallback(
    (assistantId: string, text: string) => {
      // Read fileIds from the current messages before updating state
      const fileIds = messages.find((m) => m.id === assistantId)?.retryFileIds

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m
          return {
            ...m,
            status: 'streaming',
            content: '',
            error: undefined,
            retryText: undefined,
            trace: undefined,
            files: undefined,
            liveTools: undefined,
            retryFileIds: undefined,
          }
        }),
      )
      void runTurn(assistantId, text, fileIds)
    },
    [runTurn, messages],
  )

  const stop = useCallback(() => controllerRef.current?.abort(), [])

  return {
    sessions,
    activeId,
    messages,
    loadingThread,
    sending,
    newChat,
    selectSession,
    removeSession,
    send,
    retry,
    stop,
  }
}
