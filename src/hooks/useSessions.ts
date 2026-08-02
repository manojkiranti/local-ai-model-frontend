import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteSession as apiDeleteSession,
  describeError,
  getSession,
  listSessions,
  openChatStream,
  sendAgentTurn,
  GatewayError,
  type SessionSummary,
  type ThreadMessage,
  type TraceEntry,
} from '@/lib/api'
import { extractDownloads, type FileDownload } from '@/lib/agent-api'

export type TurnMode = 'chat' | 'agent'
export type MessageStatus = 'streaming' | 'done' | 'error'

/** One rendered chat bubble — from server history or an in-flight optimistic turn. */
export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: MessageStatus
  error?: string
  /** Non-null for agent replies → renders the "How it worked" trace panel. */
  trace?: TraceEntry[] | null
  downloads?: FileDownload[]
  model?: string | null
  /** Present on a failed assistant turn — the user text to re-send on Retry. */
  retryText?: string
}

/** Sentinel mode key for a not-yet-created ("New chat") conversation. */
const NEW = '__new__'

function uid(): string {
  return crypto.randomUUID()
}

function threadToUI(m: ThreadMessage): UIMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    status: 'done',
    trace: m.trace,
    downloads: m.trace ? extractDownloads(m.trace) : undefined,
    model: m.model,
  }
}

/**
 * Server-owned conversation state. The sidebar and thread come from
 * `/v1/sessions`; a turn sends only the new message and the server persists
 * history. New conversations get their id from the turn response (the
 * `X-Session-Id` header when streaming) and are then adopted as active.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [modes, setModes] = useState<Record<string, TurnMode>>({})

  const controllerRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  const modesRef = useRef(modes)
  modesRef.current = modes

  const mode: TurnMode = modes[activeId ?? NEW] ?? 'chat'

  const setMode = useCallback((m: TurnMode) => {
    const key = activeIdRef.current ?? NEW
    setModes((prev) => ({ ...prev, [key]: m }))
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      // 401 is handled globally by the client; ignore transient list failures.
    }
  }, [])

  useEffect(() => {
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
    async (assistantId: string, text: string, options?: Record<string, unknown>) => {
      const turnMode = modesRef.current[activeIdRef.current ?? NEW] ?? 'chat'
      const sessionForTurn = activeIdRef.current ?? undefined
      const controller = new AbortController()
      controllerRef.current = controller
      setSending(true)

      // New conversation: adopt the server's session id (carry the pending mode).
      const adopt = (sid: string | null | undefined) => {
        if (sid && !activeIdRef.current) {
          setModes((prev) => (prev[NEW] ? { ...prev, [sid]: prev[NEW] } : prev))
          activeIdRef.current = sid
          setActiveId(sid)
        }
      }

      try {
        if (turnMode === 'chat') {
          const { sessionId, chunks } = await openChatStream(
            { session_id: sessionForTurn, message: text, options },
            controller.signal,
          )
          adopt(sessionId)
          for await (const chunk of chunks) {
            const delta = chunk.message?.content
            if (delta) patch(assistantId, (m) => ({ content: m.content + delta }))
          }
          patch(assistantId, (m) => (m.status === 'streaming' ? { status: 'done' } : {}))
        } else {
          const res = await sendAgentTurn(
            { session_id: sessionForTurn, message: text },
            controller.signal,
          )
          adopt(res.session_id)
          if (res.stop_reason === 'error') {
            patch(assistantId, () => ({
              status: 'error',
              error: res.error_message ?? 'The agent reported an error.',
              retryText: text,
            }))
          } else {
            patch(assistantId, () => ({
              status: 'done',
              content: res.final_answer ?? '_The agent finished without a text answer._',
              trace: res.trace,
              downloads: extractDownloads(res.trace),
            }))
          }
        }
        await refreshSessions()
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          patch(assistantId, (m) => ({ status: 'done', content: m.content || '_Stopped._' }))
        } else {
          patch(assistantId, () => ({ status: 'error', error: describeError(e), retryText: text }))
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
    (text: string, options?: Record<string, unknown>) => {
      const assistantId = uid()
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'user', content: text, status: 'done' },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
      ])
      void runTurn(assistantId, text, options)
    },
    [runTurn],
  )

  const retry = useCallback(
    (assistantId: string, text: string, options?: Record<string, unknown>) => {
      patch(assistantId, () => ({
        status: 'streaming',
        content: '',
        error: undefined,
        retryText: undefined,
      }))
      void runTurn(assistantId, text, options)
    },
    [patch, runTurn],
  )

  const stop = useCallback(() => controllerRef.current?.abort(), [])

  return {
    sessions,
    activeId,
    messages,
    loadingThread,
    sending,
    mode,
    setMode,
    newChat,
    selectSession,
    removeSession,
    send,
    retry,
    stop,
  }
}
