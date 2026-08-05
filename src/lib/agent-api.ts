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

/** A gateway-generated file referenced by an assistant turn. */
export interface FileRef {
  id: string
  /**
   * Best-effort filename hint parsed from the tool result string. The real name
   * comes from the download response's Content-Disposition when the card loads.
   */
  filename?: string
}

// --------------------------------------------------------------------------- //
// File-reference parsing — find every `/v1/files/<id>` a turn produced.
// (The one non-trivial bit — unit tested.)
// --------------------------------------------------------------------------- //
const FILE_ID_RE = /\/v1\/files\/([0-9a-f]{32})/
const FILE_ID_RE_G = /\/v1\/files\/([0-9a-f]{32})/g
const FILENAME_RE = /'([^']+\.[A-Za-z0-9]+)'/

/**
 * Collect every gateway file reference an assistant turn produced, scanning
 * BOTH the final message text and the tool-result trace, deduped by id. A
 * filename hint is lifted from the trace result string when present. Order:
 * trace first (richer metadata), then any ids that appear only in the text.
 * Works for any file-producing tool (excel, html, chart, …) — it keys off the
 * URL shape, not a per-tool allow-list.
 */
export function extractFileRefs(
  content: string | null | undefined,
  trace: TraceEntry[] | null | undefined,
): FileRef[] {
  const byId = new Map<string, FileRef>()

  for (const entry of trace ?? []) {
    for (const call of entry.tool_calls ?? []) {
      const result = call.result
      if (!result) continue
      const filename = result.match(FILENAME_RE)?.[1]
      for (const m of result.matchAll(FILE_ID_RE_G)) {
        const id = m[1]
        if (!byId.has(id)) byId.set(id, filename ? { id, filename } : { id })
      }
    }
  }

  for (const m of (content ?? '').matchAll(FILE_ID_RE_G)) {
    const id = m[1]
    if (!byId.has(id)) byId.set(id, { id })
  }

  return [...byId.values()]
}

/**
 * Strip raw gateway file references out of answer text so the rendered file card
 * stands in for them. Removes a markdown link to the file, a "Download … at:
 * [GET] URL" lead-in, and any bare URL, then tidies leftover whitespace.
 */
export function stripFileRefs(text: string): string {
  if (!text) return text
  return text
    // Leading \s* absorbs the separator so removal doesn't leave a double space.
    .replace(/\s*\[[^\]]*\]\(\s*(?:GET\s+)?\/v1\/files\/[0-9a-f]{32}\s*\)/gi, '')
    .replace(/\s*(?:you can\s+)?download[^.\n]*?(?:GET\s+)?\/v1\/files\/[0-9a-f]{32}\/?/gi, '')
    .replace(/\s*(?:GET\s+)?\/v1\/files\/[0-9a-f]{32}\/?/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

// Re-export so callers can build links without importing config directly.
export { API_BASE }
