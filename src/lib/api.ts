/**
 * The single typed client for the Local LLM Gateway — the ONLY backend this
 * app talks to. Every call is prefixed with API_BASE, carries a Bearer token
 * when logged in, and on any 401 clears the token and notifies the auth layer
 * to redirect to /login. Plain fetch, no cookies (JWT bearer auth).
 */
import { API_BASE } from '@/lib/config'
import { clearToken, getToken, notifyUnauthorized } from '@/lib/auth-token'

// --------------------------------------------------------------------------- //
// Types — mirror the backend Pydantic schemas.
// --------------------------------------------------------------------------- //
export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
}

export interface ModelInfo {
  name: string
  model?: string
  size?: number
  modified_at?: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  ollama: { base_url: string; reachable: boolean }
  default_chat_model?: string
  default_embed_model?: string
}

export interface UserOut {
  id: number
  email: string
  auth_provider: string
  role: 'admin' | 'member'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface EmbeddingsResponse {
  model: string
  embeddings: number[][]
}

// --------------------------------------------------------------------------- //
// Stateful chat — the SERVER owns conversation history (identified by
// session_id). A turn sends ONLY the new user message; omit session_id to start
// a new conversation (the server mints and returns one).
// --------------------------------------------------------------------------- //
export interface ChatTurnRequest {
  session_id?: string
  message: string
  model?: string
  options?: Record<string, unknown>
}

/** One row in a persisted conversation thread (GET /v1/sessions/{id}). */
export interface ThreadMessage {
  id: string
  seq: number
  role: 'user' | 'assistant'
  content: string
  /** Non-null on assistant rows whose turn called tools → renders the trace. */
  trace: TraceEntry[] | null
  model: string | null
  created_at: string
}

/** Sidebar row (GET /v1/sessions), sorted newest-updated first by the server. */
export interface SessionSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface SessionDetail {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: ThreadMessage[]
}

// Tool-calling metadata. The gateway runs the tool loop server-side; these types
// describe both the streamed `done` trace and the persisted thread trace.
export type ToolCallStatus =
  | 'ok'
  | 'unknown_tool'
  | 'bad_arguments'
  | 'repeat'
  | 'tool_error'

export type StopReason = 'completed' | 'max_iterations' | 'error'

export interface ToolCall {
  name: string
  /** Raw args the model produced (object or a JSON-ish string). */
  arguments: Record<string, unknown> | string
  result: string | null
  status: ToolCallStatus
}

export interface TraceEntry {
  iteration: number
  assistant_content: string | null
  tool_calls: ToolCall[]
}

// --------------------------------------------------------------------------- //
// Streamed chat events (`POST /v1/chat`, stream:true) — NDJSON, one typed
// object per line. `token` deltas build the answer; `tool_call`/`tool_result`
// drive a live "working…" timeline; `done` terminates the turn.
// --------------------------------------------------------------------------- //
/** A delta of the assistant's answer text — append to the bubble. */
export interface TokenEvent {
  type: 'token'
  content: string
}

/** The model started a tool call. */
export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  arguments: Record<string, unknown> | string
  iteration: number
}

/** A tool finished; `status` says how it went. */
export interface ToolResultEvent {
  type: 'tool_result'
  name: string
  status: ToolCallStatus
  result: string
  iteration: number
}

/** Terminal event — the turn is complete; carries the authoritative trace. */
export interface DoneEvent {
  type: 'done'
  session_id: string
  stop_reason: StopReason
  iteration_count: number
  final_answer: string
  error_message: string | null
  trace: TraceEntry[]
}

export type ChatEvent = TokenEvent | ToolCallEvent | ToolResultEvent | DoneEvent

// --------------------------------------------------------------------------- //
// Errors
// --------------------------------------------------------------------------- //
/** Raised for any non-2xx gateway response, carrying the gateway's `detail`. */
export class GatewayError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
  }
}

export async function errorFromResponse(res: Response): Promise<GatewayError> {
  let detail = `Request failed (HTTP ${res.status})`
  try {
    const data = await res.json()
    if (data && typeof data.detail === 'string') detail = data.detail
  } catch {
    // Body wasn't JSON; keep the generic message.
  }
  return new GatewayError(res.status, detail)
}

/** Normalize a thrown value (network error, abort, GatewayError) to a message. */
export function describeError(err: unknown): string {
  if (err instanceof GatewayError) {
    if (err.status === 404) return 'model not available on the server'
    if (err.status === 502) return 'inference service is unavailable'
    return err.message
  }
  if (err instanceof DOMException && err.name === 'AbortError') return 'Stopped.'
  if (err instanceof TypeError) {
    return 'Cannot reach the gateway. Is it running on port 8000?'
  }
  return err instanceof Error ? err.message : String(err)
}

// --------------------------------------------------------------------------- //
// NDJSON stream parsing (the one non-trivial bit — unit tested)
// --------------------------------------------------------------------------- //
/**
 * Yield parsed JSON objects from a newline-delimited-JSON byte stream.
 * Handles chunk boundaries that split lines and a trailing line without a
 * final newline.
 */
export async function* readNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) yield JSON.parse(line)
      }
    }
    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail) yield JSON.parse(tail)
  } finally {
    reader.releaseLock()
  }
}

// --------------------------------------------------------------------------- //
// Request core — base URL prefix, bearer injection, global 401 handling
// --------------------------------------------------------------------------- //
async function rawFetch(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal })

  if (res.status === 401) {
    clearToken()
    notifyUnauthorized()
    throw await errorFromResponse(res)
  }
  return res
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await rawFetch(path, init, signal)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<T>
}

// --------------------------------------------------------------------------- //
// Auth endpoints
// --------------------------------------------------------------------------- //
/** Register a new user. Returns the created user (NOT a token). 409 if taken. */
export async function register(email: string, password: string): Promise<UserOut> {
  return request<UserOut>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/** Exchange credentials for a JWT. 401 on bad credentials. */
export async function login(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/** Fetch the current user (bearer required). 401 restores to logged-out. */
export async function getMe(signal?: AbortSignal): Promise<UserOut> {
  return request<UserOut>('/users/me', { method: 'GET' }, signal)
}

// --------------------------------------------------------------------------- //
// Endpoints
// --------------------------------------------------------------------------- //
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // 200 (ok) or 503 (degraded); both carry the JSON body. No auth required.
  const res = await fetch(`${API_BASE}/health`, { signal })
  const data = await res.json().catch(() => null)
  if (!data) throw new GatewayError(res.status, 'Gateway returned no health JSON')
  return data as HealthResponse
}

export async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const res = await fetch('/v1/models', { signal })
  if (!res.ok) throw await errorFromResponse(res)
  const data = await res.json()
  return (data?.models ?? []) as ModelInfo[]
}

export async function getEmbeddings(
  input: string | string[],
  model?: string,
  signal?: AbortSignal,
): Promise<EmbeddingsResponse> {
  const res = await fetch('/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model }),
    signal,
  })
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<EmbeddingsResponse>
}

// --------------------------------------------------------------------------- //
// The one turn endpoint (stateful, tool-capable, streaming) + sessions
// --------------------------------------------------------------------------- //
/**
 * Start or continue a turn (`POST /v1/chat`, stream:true) — the single endpoint
 * for everything. Tools are always available; the model calls one only when
 * useful, so there is no separate agent endpoint. The new/continuing session id
 * is in the `X-Session-Id` response header (read immediately — the NDJSON body's
 * id only arrives on the terminal `done` event). Returns that id plus a
 * generator over the typed event stream (`token` / `tool_call` / `tool_result` /
 * `done`).
 */
export async function openChatStream(
  req: ChatTurnRequest,
  signal?: AbortSignal,
): Promise<{ sessionId: string | null; events: AsyncGenerator<ChatEvent> }> {
  const res = await rawFetch(
    '/v1/chat',
    { method: 'POST', body: JSON.stringify({ ...req, stream: true }) },
    signal,
  )
  if (!res.ok || !res.body) throw await errorFromResponse(res)
  const sessionId = res.headers.get('X-Session-Id')
  const body = res.body
  async function* events(): AsyncGenerator<ChatEvent> {
    for await (const obj of readNdjson(body)) yield obj as ChatEvent
  }
  return { sessionId, events: events() }
}

/** Conversation sidebar list (newest-updated first). */
export async function listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/v1/sessions', { method: 'GET' }, signal)
}

/** Full ordered thread for one conversation. 404 = not yours / gone. */
export async function getSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
  return request<SessionDetail>(
    `/v1/sessions/${encodeURIComponent(id)}`,
    { method: 'GET' },
    signal,
  )
}

/** Delete a conversation (204). 404 = already gone. */
export async function deleteSession(id: string, signal?: AbortSignal): Promise<void> {
  const res = await rawFetch(
    `/v1/sessions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    signal,
  )
  if (!res.ok && res.status !== 204) throw await errorFromResponse(res)
}

// --------------------------------------------------------------------------- //
// Vector math (unit tested)
// --------------------------------------------------------------------------- //
/** Cosine similarity of two equal-length vectors; NaN for empty/mismatched. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return NaN
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? NaN : dot / denom
}
