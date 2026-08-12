/**
 * Pure helpers for the chat-upload path — client-side validation (fail
 * fast before the round trip), a one-line summary for the attachment chip, and
 * upload-specific error copy. Dependency-free and unit tested.
 */
import { GatewayError, type UploadSummary } from '@/lib/api'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md,.json,.xlsx,.csv'

const ALLOWED_EXT = ['.pdf', '.docx', '.txt', '.md', '.json', '.xlsx', '.csv']
const ACCEPTED_FILE_ERROR =
  'only .xlsx, .csv, .pdf, .docx, .txt, .md and .json files are accepted'

/** Return a user-facing rejection message, or null if the file is acceptable. */
export function validateUpload(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    return ACCEPTED_FILE_ERROR
  }
  if (file.size === 0) {
    return 'uploaded file is empty'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'file exceeds the 10 MB limit'
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
    return 'Cannot reach the gateway. Is it running on port 8000?'
  }
  return err instanceof Error ? err.message : String(err)
}
