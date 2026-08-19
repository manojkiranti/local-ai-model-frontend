/**
 * Presentation helpers for chat source citations (`sources` on a chat turn).
 *
 * The gateway resolves which department documents an answer was grounded in and
 * publishes them document-level, best first. Everything here is pure formatting
 * on top of that — nothing derives provenance, and nothing rebuilds a link:
 * `download_url` is computed server-side and is used verbatim or not at all.
 *
 * Three distinct states, and the difference is load-bearing:
 *   `null` — no corpus was searched (every turn of a general chat). Render nothing.
 *   `[]`   — a search ran and surfaced no document.
 *   list   — these documents, `cited` saying whether the answer's [N] named them.
 */
import type { Source } from '@/lib/api'
import { filenameFromContentDisposition } from '@/lib/file-format'

/** Extraction routes an NRB page can come from, in the gateway's vocabulary. */
const ROUTE_LABELS: Record<string, string> = {
  native: 'native text layer',
  legacy_conversion: 'legacy Nepali font conversion',
  ocr: 'OCR',
}

/**
 * "p. 4" / "pp. 4–6, 12", or null when the format has no pagination (csv, xlsx,
 * typed text) — an absent page list is normal, not an error. Consecutive pages
 * collapse into a range so a 40-page hit does not print 40 numbers.
 */
export function pagesLabel(pages: number[] | null | undefined): string | null {
  if (!Array.isArray(pages)) return null
  const unique = [...new Set(pages.filter((p) => Number.isFinite(p)))].sort((a, b) => a - b)
  if (unique.length === 0) return null

  const groups: string[] = []
  let start = unique[0]
  let end = unique[0]
  const flush = () => groups.push(start === end ? `${start}` : `${start}–${end}`)
  for (const page of unique.slice(1)) {
    if (page === end + 1) {
      end = page
    } else {
      flush()
      start = page
      end = page
    }
  }
  flush()
  return `${unique.length === 1 ? 'p.' : 'pp.'} ${groups.join(', ')}`
}

/** What to call the document on screen. */
export function sourceTitle(source: Source): string {
  return (
    source.title?.trim() ||
    source.file_name?.trim() ||
    `Document ${source.document_id.slice(0, 8)}`
  )
}

/** Is this document's text machine-recovered (OCR or legacy-font conversion)? */
export function isMachineRecovered(source: Source): boolean {
  return source.machine_recovered === true
}

/** `ocr` → "OCR". Unknown routes render as themselves rather than disappearing. */
export function routeLabel(route: string): string {
  return ROUTE_LABELS[route] ?? route
}

/** "OCR, native text layer", or null when the document reports no routes. */
export function routesLabel(routes: string[] | null | undefined): string | null {
  if (!Array.isArray(routes)) return null
  const labels = routes.filter((r) => typeof r === 'string' && r.trim()).map(routeLabel)
  return labels.length ? labels.join(', ') : null
}

/**
 * The publication date, day-precision. Kept as the gateway's own ISO date rather
 * than reformatted: this is the identity of an official circular, and a locale
 * shuffle of its date helps nobody find it on nrb.org.np.
 */
export function publishedLabel(publishedAt: string | null | undefined): string | null {
  const raw = publishedAt?.trim()
  if (!raw) return null
  const isoDay = raw.match(/^\d{4}-\d{2}-\d{2}/)
  return isoDay ? isoDay[0] : raw
}

/** True for a document from the Nepal Rastra Bank catalog. */
export function isNrbSource(source: Source): boolean {
  return source.origin === 'nrb'
}

/**
 * Split into documents the answer's [N] markers named and documents it was
 * merely grounded in. `cited: false` is not a lesser source — it means the model
 * did not mark which claim came from where (or two searches made [N] ambiguous),
 * so the UI must not imply a specific sentence came from a specific file.
 */
export function partitionSources(sources: Source[]): { cited: Source[]; related: Source[] } {
  return {
    cited: sources.filter((s) => s.cited === true),
    related: sources.filter((s) => s.cited !== true),
  }
}

/**
 * The host of an external verification link, or null when the value is not a
 * plain http(s) URL. The gateway only ever sends an `nrb.org.np` page, but this
 * string reaches an `href`, so anything that is not http(s) (a `javascript:`
 * URL) is not rendered as a link at all.
 */
export function externalLinkHost(url: string | null | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname || null
  } catch {
    return null
  }
}

/** Short label for the gateway's `file_type`, e.g. "pdf" → "PDF". */
export function fileTypeLabel(fileType: string | null | undefined): string | null {
  const raw = fileType?.trim()
  if (!raw) return null
  return raw.toLowerCase() === 'text' ? 'Text' : raw.toUpperCase()
}

/**
 * File types a browser renders natively, so a citation for one can offer a
 * "View" (new tab) alongside the always-present download. The Office formats
 * (docx, xlsx) are deliberately absent: a browser cannot render them, so a
 * "view" would just be a second download button wearing the wrong label.
 */
const VIEWABLE_FILE_TYPES = new Set(['pdf', 'text', 'csv'])

/** Should this document offer an in-browser "View"? Download is always offered. */
export function isBrowserViewable(source: Source): boolean {
  return VIEWABLE_FILE_TYPES.has((source.file_type ?? '').toLowerCase())
}

/** File extension for the gateway's `file_type`, used to name a download. */
const TYPE_EXTENSIONS: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  csv: 'csv',
  text: 'txt',
}

/**
 * A filename for the saved document: the server's `Content-Disposition` first
 * (it knows the stored name), then the document's own `file_name`, then its
 * title with an extension guessed from `file_type`.
 */
export function downloadFilename(source: Source, disposition?: string | null): string {
  const fromHeader = disposition ? filenameFromContentDisposition(disposition) : undefined
  if (fromHeader) return fromHeader
  const named = source.file_name?.trim()
  if (named) return named
  const base = sourceTitle(source).replace(/[\\/:*?"<>|]+/g, '_')
  const ext = TYPE_EXTENSIONS[(source.file_type ?? '').toLowerCase()]
  return ext ? `${base}.${ext}` : base
}
