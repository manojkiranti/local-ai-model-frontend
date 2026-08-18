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
  file_ids?: string[]
  /** Present only when creating a new department-bound conversation. */
  department?: string
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
  title: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface SessionDetail {
  id: string
  title: string | null
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
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
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

export interface UserListResponse {
  total: number
  limit: number
  offset: number
  items: UserOut[]
}

/** Admin-only user list, used when granting department membership. */
export async function listUsers(signal?: AbortSignal): Promise<UserListResponse> {
  return request<UserListResponse>('/users?limit=200', { method: 'GET' }, signal)
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

// --------------------------------------------------------------------------- //
// MCP connection status — a live probe of the configured MCP server. Always
// 200 (health is in the body, never an error status); 401 handled globally.
// --------------------------------------------------------------------------- //
export interface McpStatus {
  /** Is an MCP server configured at all? */
  configured: boolean
  /** Did the gateway just reach + authenticate to it? */
  reachable: boolean
  server_url: string | null
  tool_mode: string | null
  /** Exposed MCP tool names (for the tooltip). */
  tools: string[]
  /** Reason when unreachable, else null. */
  error: string | null
}

export async function getMcpStatus(signal?: AbortSignal): Promise<McpStatus> {
  return request<McpStatus>('/v1/mcp/status', { method: 'GET' }, signal)
}

/**
 * Fetch a generated file (`GET /v1/files/{id}`) WITH the bearer header — a plain
 * <a href> can't send it. Returns the raw Response so the caller can branch on
 * Content-Type and build a blob URL. 401 is handled globally (→ login); other
 * non-2xx (404 unknown id, 410 gone) throw a GatewayError.
 */
export async function fetchFile(id: string, signal?: AbortSignal): Promise<Response> {
  const res = await rawFetch(`/v1/files/${encodeURIComponent(id)}`, { method: 'GET' }, signal)
  if (!res.ok) throw await errorFromResponse(res)
  return res
}

export type FileSource = 'uploaded' | 'generated'

export interface SheetSummary {
  name: string
  rows: number
  cols: number
  headers: string[]
}

export interface SpreadsheetUploadSummary {
  kind: string
  total_rows: number
  sheets?: SheetSummary[]
}

export interface DocumentUploadSummary {
  kind:
    | 'PDF'
    | 'Word document'
    | 'Text file'
    | 'Markdown'
    | 'JSON'
    | 'JSON (unparsed)'
  lines: number
  chars: number
  pages: number
  text_pages: number
}

/**
 * An uploaded raster image (`.png .jpg .jpeg .webp .tif .tiff .bmp`). `frames`
 * comes from the container (a scanned `.tif` routinely holds several) and
 * matters to the user: the OCR tool reads the FIRST frame only.
 */
export interface ImageUploadSummary {
  /** Human label the gateway picks, e.g. "PNG image". */
  kind: string
  width: number
  height: number
  frames: number
}

export type UploadSummary =
  | SpreadsheetUploadSummary
  | DocumentUploadSummary
  | ImageUploadSummary

export interface UploadedFile {
  id: string
  filename: string
  media_type: string
  size: number
  source: FileSource
  summary: UploadSummary
}

/** A generated file the gateway tracks for the current user. */
export interface GatewayFile {
  id: string
  filename: string
  media_type: string
  size: number
  source: FileSource
  created_at: string
}

/**
 * Upload a document, spreadsheet, or image (`POST /v1/files`, multipart). The browser sets the
 * multipart Content-Type/boundary — do NOT set it manually. Bearer + global 401
 * come from `rawFetch`; non-2xx throws a GatewayError carrying the detail.
 */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await rawFetch('/v1/files', { method: 'POST', body: form }, signal)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<UploadedFile>
}

/**
 * List the current user's files (`GET /v1/files`), newest-first and
 * already owner-scoped server-side — no client filtering. Bearer + global 401
 * handling come from `request`.
 */
export async function listFiles(
  source?: FileSource,
  signal?: AbortSignal,
): Promise<GatewayFile[]> {
  const path = source ? `/v1/files?source=${source}` : '/v1/files'
  const data = await request<{ files: GatewayFile[] }>(path, { method: 'GET' }, signal)
  return data.files
}

/**
 * Delete a generated file (`DELETE /v1/files/{id}`). 204 = deleted, 404 =
 * already gone — both mean "it's not there anymore", so neither throws (the
 * caller just drops the row). 401 is handled globally; other statuses throw.
 */
export async function deleteFile(id: string, signal?: AbortSignal): Promise<void> {
  const res = await rawFetch(`/v1/files/${encodeURIComponent(id)}`, { method: 'DELETE' }, signal)
  if (res.ok || res.status === 404) return
  throw await errorFromResponse(res)
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
// Department-scoped RAG
// --------------------------------------------------------------------------- //
export interface Department {
  id: number
  code: string
  name: string
  is_active: boolean
  created_at: string
}

export interface DepartmentMember {
  user_id: number
  department_id: number
  granted_by: number | null
  granted_at: string
}

export interface DepartmentDocument {
  id: string
  department_id: number
  title: string
  source: string
  file_type: string
  file_name: string | null
  status: string
  chunk_count: number
  created_at: string
  embed_model?: string | null
  embed_dim?: number | null
  updated_at?: string
}

export interface IngestAccepted {
  document_id: string
  job_id: string
  status: string
}

export interface IngestJob {
  id: string
  document_id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  chunks_total: number | null
  chunks_done: number
  attempts: number
  error: string | null
  created_at: string
  finished_at: string | null
}

export async function listDepartments(signal?: AbortSignal): Promise<Department[]> {
  return request<Department[]>('/v1/departments', { method: 'GET' }, signal)
}

export async function createDepartment(
  body: { code: string; name: string },
  signal?: AbortSignal,
): Promise<Department> {
  return request<Department>(
    '/v1/departments',
    { method: 'POST', body: JSON.stringify(body) },
    signal,
  )
}

export async function updateDepartment(
  code: string,
  body: { name?: string; is_active?: boolean },
  signal?: AbortSignal,
): Promise<Department> {
  return request<Department>(
    `/v1/departments/${encodeURIComponent(code)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    signal,
  )
}

export async function listDepartmentMembers(
  code: string,
  signal?: AbortSignal,
): Promise<DepartmentMember[]> {
  return request<DepartmentMember[]>(
    `/v1/departments/${encodeURIComponent(code)}/members`,
    { method: 'GET' },
    signal,
  )
}

export async function grantDepartmentMember(
  code: string,
  userId: number,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawFetch(
    `/v1/departments/${encodeURIComponent(code)}/members`,
    { method: 'POST', body: JSON.stringify({ user_id: userId }) },
    signal,
  )
  if (!res.ok) throw await errorFromResponse(res)
}

export async function revokeDepartmentMember(
  code: string,
  userId: number,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawFetch(
    `/v1/departments/${encodeURIComponent(code)}/members/${userId}`,
    { method: 'DELETE' },
    signal,
  )
  if (!res.ok) throw await errorFromResponse(res)
}

export async function listDepartmentDocuments(
  code: string,
  includeArchived = false,
  signal?: AbortSignal,
): Promise<DepartmentDocument[]> {
  const query = includeArchived ? '?include_archived=true' : ''
  return request<DepartmentDocument[]>(
    `/v1/departments/${encodeURIComponent(code)}/documents${query}`,
    { method: 'GET' },
    signal,
  )
}

export async function uploadDepartmentDocument(
  code: string,
  title: string,
  file: File,
  signal?: AbortSignal,
): Promise<IngestAccepted> {
  const form = new FormData()
  form.append('title', title)
  form.append('file', file)
  const res = await rawFetch(
    `/v1/departments/${encodeURIComponent(code)}/documents`,
    { method: 'POST', body: form },
    signal,
  )
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<IngestAccepted>
}

export async function createDepartmentTextDocument(
  code: string,
  body: { title: string; content: string },
  signal?: AbortSignal,
): Promise<IngestAccepted> {
  return request<IngestAccepted>(
    `/v1/departments/${encodeURIComponent(code)}/documents/text`,
    { method: 'POST', body: JSON.stringify(body) },
    signal,
  )
}

export async function getIngestJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<IngestJob> {
  return request<IngestJob>(
    `/v1/ingest-jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
    signal,
  )
}

export async function archiveDepartmentDocument(
  code: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawFetch(
    `/v1/departments/${encodeURIComponent(code)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' },
    signal,
  )
  if (!res.ok) throw await errorFromResponse(res)
}

// --------------------------------------------------------------------------- //
// NRB operations (admin only) — three endpoints, all enforced by the gateway's
// `require_admin`. The client hides the UI; the backend is authoritative.
// --------------------------------------------------------------------------- //
/**
 * `queued` accepted but not yet claimed · `running` the pipeline runner is
 * staging · `awaiting_jobs` staging finished, the RAG worker has not ·
 * `succeeded` / `partial` / `failed` terminal.
 */
export type NrbRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_jobs'
  | 'succeeded'
  | 'partial'
  | 'failed'

/**
 * One pipeline run — exactly the gateway's `RunOut`. `counters` and `jobs` are
 * open maps on purpose: a stage may add a counter key without a schema change,
 * so consumers must iterate rather than read fixed fields.
 */
export interface NrbRun {
  id: number
  trigger: string
  requested_by: string | null
  /** Widened to `string` so an unknown backend status still renders as itself. */
  status: NrbRunStatus | string
  stage: string
  department: string | null
  scope: Record<string, unknown>
  counters: Record<string, unknown>
  error: string | null
  jobs: Record<string, number>
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}

/**
 * Operational state (`GET /v1/nrb/status`).
 *
 * NOT a pure read: the handler settles finished runs and commits, which is what
 * advances an `awaiting_jobs` run whose jobs have all completed. Do not dedupe
 * or cache the poll away.
 *
 * `active_run` non-null is the one signal that a trigger would be refused — read
 * it directly rather than deriving "is something running" from a status string.
 */
export interface NrbStatus {
  active_run: NrbRun | null
  latest_run: NrbRun | null
  catalog: Record<string, number>
  files: Record<string, number>
  /** Mixed: scalars plus nested `documents` / `jobs` status maps. */
  rag: Record<string, number | Record<string, number>>
}

/**
 * The trigger body — a deliberate SUBSET of the gateway's `RunTriggerIn`.
 *
 * There is no `all_files` field and there must never be one: a full-corpus run
 * is deliberately not available over HTTP, so it is unexpressible here rather
 * than merely unsent. The gateway also rejects an unbounded request (422), so at
 * least one of `limit` / `years` / `sections` / `owners` / `extensions` must be
 * present.
 */
export interface NrbRunTrigger {
  /** Required whenever `rag` is among the stages. */
  department?: string
  stages: string[]
  sections?: string[]
  owners?: string[]
  years?: number[]
  extensions?: string[]
  limit?: number
  retry_failed: boolean
}

/** One envelope for both outcomes of `POST /v1/nrb/runs` (202 and 409). */
export interface NrbTriggerResult {
  /** true = accepted (202). false = an update was already in progress (409). */
  started: boolean
  /**
   * On 202 the queued run; on 409 the update ALREADY in progress — render it,
   * never discard it. Null only when a lock is held before its row is visible.
   */
  run: NrbRun | null
  detail: string | null
}

export async function getNrbStatus(signal?: AbortSignal): Promise<NrbStatus> {
  return request<NrbStatus>('/v1/nrb/status', { method: 'GET' }, signal)
}

export async function getNrbRun(id: number, signal?: AbortSignal): Promise<NrbRun> {
  return request<NrbRun>(`/v1/nrb/runs/${id}`, { method: 'GET' }, signal)
}

/**
 * Request an NRB update.
 *
 * 409 is NOT an error: it shares `RunTriggerOut` with 202 and carries the run
 * already in progress, so both statuses resolve to a `NrbTriggerResult` and the
 * caller branches on `started`. Everything else (403 non-admin, 422 unbounded
 * scope) throws a `GatewayError` carrying the gateway's `detail`; 401 is handled
 * globally by `rawFetch`.
 */
export async function triggerNrbRun(
  body: NrbRunTrigger,
  signal?: AbortSignal,
): Promise<NrbTriggerResult> {
  const res = await rawFetch(
    '/v1/nrb/runs',
    { method: 'POST', body: JSON.stringify(body) },
    signal,
  )
  if (!res.ok && res.status !== 409) throw await errorFromResponse(res)
  return res.json() as Promise<NrbTriggerResult>
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
