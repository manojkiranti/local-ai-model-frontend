/**
 * Pure helpers for the spreadsheet-upload path — client-side validation (fail
 * fast before the round trip), a one-line summary for the attachment chip, and
 * upload-specific error copy. Dependency-free and unit tested.
 */
import { GatewayError, type UploadSummary } from '@/lib/api'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UPLOAD_ACCEPT = '.xlsx,.csv'

const ALLOWED_EXT = ['.xlsx', '.csv']

/** Return a user-facing rejection message, or null if the file is acceptable. */
export function validateSpreadsheet(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    return 'Only .xlsx and .csv files are accepted'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File exceeds the 10 MB limit'
  }
  return null
}

/** One-line chip summary, e.g. "Excel · 2 sheets · 1,270 rows" / "CSV · 5 rows". */
export function describeUploadSummary(s: UploadSummary): string {
  const parts = [s.kind]
  const sheetCount = s.sheets?.length ?? 0
  if (sheetCount > 0) {
    parts.push(`${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`)
  }
  const rows = s.total_rows
  parts.push(`${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'}`)
  return parts.join(' · ')
}

/** Upload-specific error copy. NOT describeError (which mislabels 404). */
export function describeUploadError(err: unknown): string {
  if (err instanceof GatewayError) {
    if (err.status === 413) return 'File exceeds the 10 MB limit'
    return err.message
  }
  if (err instanceof TypeError) {
    return 'Cannot reach the gateway. Is it running on port 8000?'
  }
  return err instanceof Error ? err.message : String(err)
}
