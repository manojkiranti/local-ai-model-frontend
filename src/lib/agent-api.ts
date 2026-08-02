/**
 * Helpers for tool artifacts and the gateway's file/tool endpoints
 * (`/v1/tools`, `/v1/files/:id`). Tools run server-side inside `/v1/chat`; the
 * frontend only parses the trace they leave behind and fetches the files they
 * produce.
 *
 * Base URL comes from `config.ts` (never hardcoded here).
 */
import { API_BASE, apiUrl } from './config'
import { GatewayError, errorFromResponse } from './api'
import type { TraceEntry } from './api'
import { getToken } from './auth-token'

// --------------------------------------------------------------------------- //
// Types — the trace schema lives in the single client (`api.ts`); re-export it
// so existing consumers can keep importing from here.
// --------------------------------------------------------------------------- //
export type {
  StopReason,
  ToolCall,
  ToolCallStatus,
  TraceEntry,
} from './api'

export interface ToolInfo {
  name: string
  description: string
  backend: string
}

export interface FilteredTool {
  name: string
  reason: string
}

export interface ToolsResponse {
  mode: string
  server_url: string
  exposed: ToolInfo[]
  filtered_out: FilteredTool[]
}

export type DownloadKind = 'excel' | 'html' | 'file'

/** A downloadable artifact extracted from a file-producing tool result. */
export interface FileDownload {
  id: string
  url: string
  filename: string
  kind: DownloadKind
  bytes?: number
  rows?: number
}

// --------------------------------------------------------------------------- //
// Trace parsing — pull download links out of the tool trace.
// (The one non-trivial bit — unit tested. Never parse `final_answer`.)
// --------------------------------------------------------------------------- //
/**
 * Tools that write a file to the store and return a `GET /v1/files/{id}` link,
 * mapped to the artifact kind. All share the same result-string shape
 * (`Created X file '<name>' (<n> bytes[...]). Download it at: GET /v1/files/<id>`).
 */
const FILE_TOOLS: Record<string, DownloadKind> = {
  create_excel: 'excel',
  create_html: 'html',
}
const FILE_ID_RE = /\/v1\/files\/([0-9a-f]{32})/
const FILENAME_RE = /'([^']+\.[A-Za-z0-9]+)'/
const BYTES_RE = /\((\d+)\s*bytes/i
const ROWS_RE = /(\d+)\s*data row/i
const DEFAULT_EXT: Record<DownloadKind, string> = {
  excel: 'xlsx',
  html: 'html',
  file: 'bin',
}

/**
 * Scan every file-producing tool call that succeeded (see FILE_TOOLS) and return
 * the artifacts the user can download. Dedupes by file id (a retry can repeat
 * the same link).
 */
export function extractDownloads(trace: TraceEntry[]): FileDownload[] {
  const out: FileDownload[] = []
  const seen = new Set<string>()

  for (const entry of trace ?? []) {
    for (const call of entry.tool_calls ?? []) {
      const kind = FILE_TOOLS[call.name]
      if (!kind || call.status !== 'ok') continue
      const result = call.result
      if (!result) continue

      const idMatch = result.match(FILE_ID_RE)
      if (!idMatch) continue
      const id = idMatch[1]
      if (seen.has(id)) continue
      seen.add(id)

      const bytes = result.match(BYTES_RE)
      const rows = result.match(ROWS_RE)
      out.push({
        id,
        url: fileDownloadUrl(id),
        filename: result.match(FILENAME_RE)?.[1] ?? `${id}.${DEFAULT_EXT[kind]}`,
        kind,
        bytes: bytes ? Number(bytes[1]) : undefined,
        rows: rows ? Number(rows[1]) : undefined,
      })
    }
  }
  return out
}

/** Absolute URL to download a generated file by its id. */
export function fileDownloadUrl(id: string): string {
  return apiUrl(`/v1/files/${id}`)
}

// --------------------------------------------------------------------------- //
// Endpoints
// --------------------------------------------------------------------------- //
/** List the tools the gateway currently exposes (called once for the indicator). */
export async function listTools(signal?: AbortSignal): Promise<ToolsResponse> {
  const res = await fetch(apiUrl('/v1/tools'), { signal })
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<ToolsResponse>
}

/**
 * Trigger a file download. A plain GET to the file URL; the server responds
 * with the attachment. 404 = unknown id, 410 = file gone from disk.
 */
export async function downloadFile(download: FileDownload): Promise<void> {
  // /v1/files requires the bearer header, so a plain <a href> can't fetch it —
  // download here and hand the browser a blob URL instead.
  const token = getToken()
  const res = await fetch(download.url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    if (res.status === 404) {
      throw new GatewayError(404, 'This file id is unknown to the server.')
    }
    if (res.status === 410) {
      throw new GatewayError(410, 'This file is no longer on the server.')
    }
    throw await errorFromResponse(res)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = download.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/** True if a link points at a gateway-generated file (`/v1/files/{id}`). */
export function isGatewayFileHref(href: string): boolean {
  return FILE_ID_RE.test(href)
}

/**
 * Download a `/v1/files/{id}` link with the bearer header and hand the browser a
 * blob URL. Used for raw file links the model drops into its answer text — a
 * plain <a> would 401 (no header) or, for a relative path, just reopen the SPA.
 */
export async function downloadByUrl(href: string): Promise<void> {
  const id = href.match(FILE_ID_RE)?.[1]
  const url = id ? fileDownloadUrl(id) : href
  const token = getToken()
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    if (res.status === 404) {
      throw new GatewayError(404, 'This file id is unknown to the server.')
    }
    if (res.status === 410) {
      throw new GatewayError(410, 'This file is no longer on the server.')
    }
    throw await errorFromResponse(res)
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const named = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"']+)/i)?.[1]
  const filename = named ? decodeURIComponent(named) : id ? `${id}.xlsx` : 'download'
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/**
 * Fetch a generated file's raw text with the bearer header — used to preview an
 * HTML artifact inside a sandboxed <iframe srcdoc>. (Kept separate from
 * downloadFile, which triggers a save rather than returning content.)
 */
export async function fetchFileText(download: FileDownload): Promise<string> {
  const token = getToken()
  const res = await fetch(download.url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    if (res.status === 404) {
      throw new GatewayError(404, 'This file id is unknown to the server.')
    }
    if (res.status === 410) {
      throw new GatewayError(410, 'This file is no longer on the server.')
    }
    throw await errorFromResponse(res)
  }
  return res.text()
}

// Re-export so callers can build links without importing config directly.
export { API_BASE }
