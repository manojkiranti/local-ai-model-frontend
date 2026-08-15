/**
 * Pure helpers for the chat-upload path — client-side validation (fail
 * fast before the round trip), a one-line summary for the attachment chip, and
 * upload-specific error copy. Dependency-free and unit tested.
 */
import { GatewayError, type UploadSummary } from '@/lib/api'

export const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md,.json,.xlsx,.csv'

const ALLOWED_EXT = ['.pdf', '.docx', '.txt', '.md', '.json', '.xlsx', '.csv']
const ACCEPTED_FILE_ERROR =
  'only .xlsx, .csv, .pdf, .docx, .txt, .md and .json files are accepted'

/**
 * Return a user-facing rejection message, or null if the file is acceptable.
 *
 * Deliberately does NOT cap the size. The gateway owns that limit
 * (`settings.upload_max_bytes`, env-overridable) and 413s with its own wording,
 * so mirroring a hardcoded number here would silently disagree with a
 * deployment that raised it. The extension and empty-file rules are hardcoded
 * on both sides, so they cannot drift and stay client-side for instant feedback.
 */
export function validateUpload(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    return ACCEPTED_FILE_ERROR
  }
  if (file.size === 0) {
    return 'uploaded file is empty'
  }
  return null
}

/** One-line chip summary for either a document or spreadsheet response. */
export function describeUploadSummary(s: UploadSummary): string {
  const parts = [s.kind]
  if ('total_rows' in s) {
    const sheetCount = s.sheets?.length ?? 0
    if (sheetCount > 0) {
      parts.push(`${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`)
    }
    parts.push(
      `${s.total_rows.toLocaleString('en-US')} ${s.total_rows === 1 ? 'row' : 'rows'}`,
    )
  } else {
    if (s.pages > 0) {
      parts.push(`${s.pages.toLocaleString('en-US')} ${s.pages === 1 ? 'page' : 'pages'}`)
    }
    parts.push(`${s.lines.toLocaleString('en-US')} ${s.lines === 1 ? 'line' : 'lines'}`)
    parts.push(`${s.chars.toLocaleString('en-US')} chars`)
  }
  return parts.join(' · ')
}

export function scannedPdfWarning(s: UploadSummary): string | null {
  if ('pages' in s && s.kind === 'PDF' && s.pages > 0 && s.text_pages === 0) {
    return "No text layer — this looks like a scan and can't be read yet."
  }
  return null
}

/** Upload-specific error copy. NOT describeError (which mislabels 404). */
export function describeUploadError(err: unknown): string {
  if (err instanceof GatewayError) {
    return err.message
  }
  if (err instanceof TypeError) {
    // The gateway enforces its size cap mid-stream and closes the connection,
    // which browsers often surface as a fetch TypeError rather than a readable
    // 413. Do not assert the gateway is down — name both causes.
    return 'Upload failed — the file may be too large, or the gateway is unreachable.'
  }
  return err instanceof Error ? err.message : String(err)
}
