import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import {
  deleteSession as apiDeleteSession,
  describeError,
  getSession,
  listSessions,
  openChatStream,
  ContractError,
  GatewayError,
  type SessionSummary,
  type Source,
  type ThreadMessage,
  type ToolCallStatus,
  type TraceEntry,
} from '@/lib/api'
import { extractFileRefs, type FileRef } from '@/lib/agent-api'
import {
  READ_IMAGE_TOOL,
  mergeOcr,
  ocrFromTrace,
  readImageFileId,
  type OcrProvenance,
} from '@/lib/ocr-provenance'
import { uid } from '@/lib/uid'

export type MessageStatus = 'streaming' | 'done' | 'error'

/** A tool call surfaced live from the event stream, before the final trace lands. */
export interface LiveTool {
  name: string
  label?: string
  status: 'running' | ToolCallStatus
  iteration: number
}

export interface AttachmentDescriptor {
  id: string
  filename: string
  summaryLine: string
  warning?: string
  /** True for an OCR-able raster image — the bubble shows a thumbnail. */
  isImage?: boolean
}

/** An uploaded file stamped onto the user bubble that sent it. */
export interface MessageAttachment {
  fileId: string
  filename: string
  summaryLine: string
  warning?: string
  isImage?: boolean
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
  retryAttachmentName?: string
  /**
   * The scope a failed turn was sent with. A retry resends it, and `runTurn`
   * still only puts it on the wire while no session exists — i.e. when the
   * failed turn never learned its session id and the retry creates it.
   */
  retryDepartment?: string
  /** Present on a user bubble that carried an uploaded file. */
  attachment?: MessageAttachment
  /** Present when this turn read an image by OCR → renders the provenance note. */
  ocr?: OcrProvenance
  /**
   * Department documents this answer was grounded in. `null`/absent means no
   * corpus was searched — a general chat, or a turn that has not reached `done`
   * yet, since citations resolve against the final answer's [N] markers and so
   * arrive only on the terminal event. Never persisted: `download_url` inside is
   * server-derived and taken fresh from every response.
   */
  sources?: Source[] | null
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
    sources: m.sources ?? null,
    ...(m.role === 'assistant' ? { ocr: ocrFromTrace(m.trace) ?? undefined } : {}),
    ...(m.role === 'assistant' && index > 0 && thread[index - 1]?.role === 'user'
      ? { retryText: thread[index - 1].content }
      : {}),
  }
}

/** The thread key for a new chat that has not learned its session id yet. */
const NEW_CHAT = '\u0000new'
const NO_MESSAGES: UIMessage[] = []

/** One turn in flight. Its session is null until a new chat learns its id. */
interface Run {
  controller: AbortController
  sessionId: string | null
}

/**
 * Server-owned conversation state. The sidebar and thread come from
 * `/v1/sessions`; a turn sends only the new message to the single `/v1/chat`
 * endpoint (stateful, tool-capable, streaming). New conversations get their id
 * from the `X-Session-Id` header (or the terminal `done` event) and are then
 * adopted as active.
 *
 * A turn keeps running when the user switches to another chat: its thread is
 * held in memory, under its session id, only while that turn is in flight (and
 * after, if it failed, so Retry survives). `busySessionIds` drives the
 * sidebar's processing indicator. This is not local persistence — a finished
 * thread is dropped and reopened from the server. The one exception is a new
 * chat that has not learned its id yet: there is nothing to file it under, so
 * leaving it stops it, as before.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Threads by key: the open one, plus any whose turn is still running in the
  // background. Stream updates find their message by id wherever it lives.
  const [threads, setThreads] = useState<Record<string, UIMessage[]>>({})
  const [loadingThread, setLoadingThread] = useState(false)
  const [running, setRunning] = useState<{ key: string; sessionId: string | null }[]>([])
  // Cursor paging. Both cursors are OPAQUE server tokens, only ever echoed
  // back; `null` means "no further page", which is also how the UI knows to
  // stop offering to load one.
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null)
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const [threadCursor, setThreadCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Set only for a mismatch between this client and the gateway's contract, so
  // the sidebar can explain an empty list instead of just being empty.
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const runsRef = useRef(new Map<string, Run>())
  const activeIdRef = useRef<string | null>(null)
  const activeAttachmentNameRef = useRef<string | null>(null)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, intentionally synced during render
  activeIdRef.current = activeId

  const messages = threads[activeId ?? NEW_CHAT] ?? NO_MESSAGES
  const threadsRef = useRef(threads)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, intentionally synced during render
  threadsRef.current = threads

  /** Replace or update the OPEN thread (the one the user is looking at). */
  const setMessages = useCallback((next: SetStateAction<UIMessage[]>) => {
    const key = activeIdRef.current ?? NEW_CHAT
    setThreads((prev) => ({
      ...prev,
      [key]: typeof next === 'function' ? next(prev[key] ?? NO_MESSAGES) : next,
    }))
  }, [])

  const syncRuns = useCallback(() => {
    setRunning([...runsRef.current].map(([key, run]) => ({ key, sessionId: run.sessionId })))
  }, [])

  /** Runs that belong to what is on screen: the open session, or the new chat. */
  const viewRuns = useCallback(
    () =>
      [...runsRef.current.values()].filter((run) => run.sessionId === activeIdRef.current),
    [],
  )

  /**
   * Leave the open thread. A turn still running in it carries on in the
   * background with its thread kept; otherwise the thread is dropped, so
   * reopening it reads the server. A new chat with no id yet is stopped.
   */
  const leaveView = useCallback(() => {
    const key = activeIdRef.current ?? NEW_CHAT
    const live = viewRuns()
    if (activeIdRef.current === null) for (const run of live) run.controller.abort()
    if (activeIdRef.current === null || live.length === 0) {
      setThreads((prev) => {
        if (!(key in prev)) return prev
        const rest = { ...prev }
        delete rest[key]
        return rest
      })
    }
  }, [viewRuns])
  /**
   * Reload the FIRST page and discard everything paged in after it. Called on
   * mount and whenever the list is invalidated — a new session, a deletion, or
   * a completed turn, which bumps `updated_at` and so reorders the list on the
   * server. Keeping accumulated pages across that would mean either duplicated
   * rows or re-sorting a list the server owns, so the sidebar resets instead.
   */
  const refreshSessions = useCallback(async () => {
    try {
      const page = await listSessions()
      setSessions(page.items)
      setSessionsCursor(page.next_cursor)
      setSessionsError(null)
    } catch (e) {
      // A contract mismatch is a deploy problem the user cannot act on blind —
      // say it. 401 is handled globally; other transient list failures stay
      // quiet, as they always have.
      if (e instanceof ContractError) setSessionsError(e.message)
    }
  }, [])

  /**
   * Append the next page of sidebar rows. A 400 means OUR cursor is stale or
   * malformed — not a problem with the user's data — so recover silently by
   * resetting to page one rather than surfacing an error.
   */
  const loadMoreSessions = useCallback(async () => {
    if (!sessionsCursor || loadingMoreSessions) return
    setLoadingMoreSessions(true)
    try {
      const page = await listSessions({ cursor: sessionsCursor })
      setSessions((prev) => {
        const seen = new Set(prev.map((session) => session.id))
        return [...prev, ...page.items.filter((session) => !seen.has(session.id))]
      })
      setSessionsCursor(page.next_cursor)
    } catch (e) {
      if (e instanceof GatewayError && e.status === 400) {
        setSessionsCursor(null)
        await refreshSessions()
      } else if (e instanceof ContractError) {
        setSessionsCursor(null)
        setSessionsError(e.message)
      }
      // Any other failure leaves the cursor in place so the user can retry.
    } finally {
      setLoadingMoreSessions(false)
    }
  }, [sessionsCursor, loadingMoreSessions, refreshSessions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load session list on mount
    refreshSessions()
  }, [refreshSessions])

  /** Update one message wherever its thread lives — open or in the background. */
  const patch = useCallback(
    (id: string, patchFn: (m: UIMessage) => Partial<UIMessage>) => {
      setThreads((prev) => {
        let next = prev
        for (const [key, list] of Object.entries(prev)) {
          if (!list.some((m) => m.id === id)) continue
          next = { ...next, [key]: list.map((m) => (m.id === id ? { ...m, ...patchFn(m) } : m)) }
        }
        return next
      })
    },
    [],
  )

  const newChat = useCallback(() => {
    leaveView()
    activeAttachmentNameRef.current = null
    activeIdRef.current = null
    setActiveId(null)
    setMessages([])
    setThreadCursor(null)
  }, [leaveView, setMessages])

  const selectSession = useCallback(async (id: string) => {
    if (id === activeIdRef.current) return
    leaveView()
    activeAttachmentNameRef.current = null
    // Set the ref eagerly, exactly as runTurn's `adopt` does: it is otherwise
    // only synced during render, and a thread page that resolves before React
    // re-renders would fail its own "still the active session" guard below.
    activeIdRef.current = id
    setActiveId(id)
    setThreadCursor(null)
    // Its turn is still running (or failed) in the background: show that
    // thread as it stands, not the server's copy, which lacks the turn.
    if (threadsRef.current[id]) return
    setMessages([])
    setLoadingThread(true)
    try {
      // One page — the NEWEST messages. `next_cursor` walks backwards from here.
      const detail = await getSession(id)
      if (activeIdRef.current === id) {
        setMessages(detail.messages.map(threadToUI))
        setThreadCursor(detail.next_cursor)
      }
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
  }, [leaveView, setMessages])

  /**
   * Prepend the page of messages OLDER than the ones on screen. Each page is
   * already ascending by `seq`, so prepending a whole page keeps the thread in
   * order without the client sorting anything.
   *
   * A 400 means our own cursor went bad: reset to page one. A 404 keeps the
   * behaviour it has always had — the conversation is gone or was never yours.
   */
  const loadOlderMessages = useCallback(async () => {
    const id = activeIdRef.current
    if (!id || !threadCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const detail = await getSession(id, { cursor: threadCursor })
      // The user may have switched conversations while this was in flight.
      if (activeIdRef.current !== id) return
      const older = detail.messages.map(threadToUI)
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !seen.has(m.id)), ...prev]
      })
      setThreadCursor(detail.next_cursor)
    } catch (e) {
      if (activeIdRef.current !== id) return
      if (e instanceof GatewayError && e.status === 400) {
        // Our cursor is stale — start the thread over from its newest page.
        setThreadCursor(null)
        const detail = await getSession(id).catch(() => null)
        if (detail && activeIdRef.current === id) {
          setMessages(detail.messages.map(threadToUI))
          setThreadCursor(detail.next_cursor)
        }
      } else if (e instanceof GatewayError && e.status === 404) {
        setSessions((prev) => prev.filter((session) => session.id !== id))
        if (activeIdRef.current === id) {
          setActiveId(null)
          setMessages([])
          setThreadCursor(null)
        }
      }
      // Anything else leaves the cursor in place so the user can retry.
    } finally {
      setLoadingOlder(false)
    }
  }, [threadCursor, loadingOlder, setMessages])

  const removeSession = useCallback(async (id: string) => {
    try {
      await apiDeleteSession(id)
    } catch (e) {
      // 404 = already gone → still drop it; other failures leave it in place.
      if (!(e instanceof GatewayError && e.status === 404)) return
    }
    setSessions((prev) => prev.filter((s) => s.id !== id))
    for (const run of runsRef.current.values()) if (run.sessionId === id) run.controller.abort()
    setThreads((prev) => {
      if (!(id in prev)) return prev
      const rest = { ...prev }
      delete rest[id]
      return rest
    })
    if (activeIdRef.current === id) {
      activeIdRef.current = null
      setActiveId(null)
      setMessages([])
      setThreadCursor(null)
    }
    // A deletion invalidates every page boundary after it — reset to page one.
    void refreshSessions()
  }, [refreshSessions, setMessages])

  /** Execute one turn against `assistantId`, reused by send() and retry(). */
  const runTurn = useCallback(
    async (
      assistantId: string,
      text: string,
      fileIds?: string[],
      department?: string,
      attachmentName?: string,
    ) => {
      const sessionForTurn = activeIdRef.current ?? undefined
      // read_image ids arrive on `tool_call`, but only `tool_result` says whether
      // the read succeeded — so queue the id and commit it when the result lands.
      const pendingImageIds: Array<string | null> = []
      const controller = new AbortController()
      const run: Run = { controller, sessionId: sessionForTurn ?? null }
      runsRef.current.set(assistantId, run)
      syncRuns()

      // New conversation: adopt the server's session id once we learn it, and
      // file its thread under that id. Still on screen — leaving a new chat
      // before this point stops it — so it becomes the active session, and the
      // sidebar reloads so its row (and processing indicator) appears now.
      const adopt = (sid: string | null | undefined) => {
        if (!sid || run.sessionId) return
        run.sessionId = sid
        syncRuns()
        if (!activeIdRef.current) {
          activeIdRef.current = sid
          setActiveId(sid)
          setThreads((prev) => {
            const rest = { ...prev, [sid]: prev[NEW_CHAT] ?? NO_MESSAGES }
            delete rest[NEW_CHAT]
            return rest
          })
        }
        void refreshSessions()
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
            const readingFilename = attachmentName ?? activeAttachmentNameRef.current
            const isRead = ev.name === 'read_document' || ev.name === READ_IMAGE_TOOL
            if (ev.name === READ_IMAGE_TOOL) {
              pendingImageIds.push(readImageFileId(ev.arguments))
            }
            patch(assistantId, (m) => ({
              liveTools: [
                ...(m.liveTools ?? []),
                {
                  name: ev.name,
                  ...(isRead
                    ? {
                        label: readingFilename
                          ? `reading ${readingFilename}…`
                          : ev.name === READ_IMAGE_TOOL
                            ? 'reading image…'
                            : 'reading document…',
                      }
                    : {}),
                  status: 'running',
                  iteration: ev.iteration,
                },
              ],
            }))
          } else if (ev.type === 'tool_result') {
            const readImageId =
              ev.name === READ_IMAGE_TOOL ? (pendingImageIds.shift() ?? null) : null
            const succeededOcr = ev.name === READ_IMAGE_TOOL && ev.status === 'ok'
            patch(assistantId, (m) => ({
              liveTools: settleTool(m.liveTools, ev.name, ev.status),
              ...(succeededOcr
                ? {
                    ocr:
                      mergeOcr(m.ocr, { imageIds: readImageId ? [readImageId] : [] }) ??
                      undefined,
                  }
                : {}),
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
                retryAttachmentName: attachmentName,
                retryDepartment: department,
                liveTools: undefined,
                trace,
                sources: null,
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
                  ocr: mergeOcr(m.ocr, ocrFromTrace(trace)) ?? undefined,
                  // Citations land only here; `null` (or an older gateway's
                  // absent field) means no corpus was searched.
                  sources: ev.sources ?? null,
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
              : e instanceof GatewayError && e.status === 404 && fileIds?.length
                ? 'That file is no longer available.'
                : describeError(e)
          patch(assistantId, () => ({
            status: 'error',
            error: message,
            retryText: text,
            retryFileIds: fileIds,
            retryAttachmentName: attachmentName,
            retryDepartment: department,
            liveTools: undefined,
          }))
          // The user message may have been persisted (e.g. 502) — refresh the list.
          refreshSessions().catch(() => {})
        }
      } finally {
        runsRef.current.delete(assistantId)
        syncRuns()
        // Finished in the background: the server now holds this turn, so drop
        // the kept thread and let reopening read it — unless it failed, when
        // the kept copy is the only one with the Retry button.
        const sid = run.sessionId
        if (sid) {
          setThreads((prev) => {
            const list = prev[sid]
            if (!list || sid === activeIdRef.current) return prev
            if (list.some((m) => m.id === assistantId && m.status === 'error')) return prev
            const rest = { ...prev }
            delete rest[sid]
            return rest
          })
        }
      }
    },
    [patch, refreshSessions, syncRuns],
  )

  const send = useCallback(
    (
      text: string,
      attachment?: AttachmentDescriptor,
      department?: string,
    ) => {
      if (attachment) {
        activeAttachmentNameRef.current = attachment.filename
      } else if (!activeIdRef.current) {
        activeAttachmentNameRef.current = null
      }
      const assistantId = uid()
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'user',
          content: text,
          status: 'done',
          ...(attachment
            ? {
                attachment: {
                  fileId: attachment.id,
                  filename: attachment.filename,
                  summaryLine: attachment.summaryLine,
                  ...(attachment.isImage ? { isImage: true } : {}),
                  ...(attachment.warning ? { warning: attachment.warning } : {}),
                },
              }
            : {}),
        },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming', retryText: text },
      ])
      void runTurn(
        assistantId,
        text,
        attachment ? [attachment.id] : undefined,
        department,
        attachment?.filename,
      )
    },
    [runTurn, setMessages],
  )

  const retry = useCallback(
    (assistantId: string, text: string) => {
      // Read the failed turn's inputs from the current messages before updating state
      const failed = messages.find((m) => m.id === assistantId)
      const fileIds = failed?.retryFileIds
      const attachmentName = failed?.retryAttachmentName
      const department = failed?.retryDepartment

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
            ocr: undefined,
            sources: null,
            retryFileIds: undefined,
            retryAttachmentName: undefined,
            retryDepartment: undefined,
          }
        }),
      )
      void runTurn(assistantId, text, fileIds, department, attachmentName)
    },
    [runTurn, messages, setMessages],
  )

  const stop = useCallback(() => {
    for (const run of viewRuns()) run.controller.abort()
  }, [viewRuns])

  // A turn is running in what is on screen: the composer shows Stop.
  const sending = running.some((run) => run.sessionId === activeId)
  /** Sessions with a turn in flight, open or in the background. */
  const busySessionIds = useMemo(
    () => new Set(running.flatMap((run) => (run.sessionId ? [run.sessionId] : []))),
    [running],
  )

  return {
    sessions,
    /** Set only when the gateway's contract does not match this client. */
    sessionsError,
    activeId,
    messages,
    loadingThread,
    sending,
    busySessionIds,
    newChat,
    selectSession,
    removeSession,
    send,
    retry,
    stop,
    /** Non-null while another page of sidebar rows exists. */
    hasMoreSessions: sessionsCursor !== null,
    loadingMoreSessions,
    loadMoreSessions,
    /** True while older messages exist in the open conversation. */
    hasOlderMessages: threadCursor !== null,
    loadingOlder,
    loadOlderMessages,
  }
}
