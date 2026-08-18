/**
 * Pure helpers for the chat-upload path — client-side validation (fail
 * fast before the round trip), a one-line summary for the attachment chip, and
 * upload-specific error copy. Dependency-free and unit tested.
 */
import { GatewayError, type UploadSummary } from '@/lib/api'

/** Raster formats the gateway accepts and can OCR (see `app/files/images.py`). */
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']

const DOCUMENT_EXT = ['.pdf', '.docx', '.txt', '.md', '.json', '.xlsx', '.csv']

const ALLOWED_EXT = [...DOCUMENT_EXT, ...IMAGE_EXT]

export const UPLOAD_ACCEPT = ALLOWED_EXT.join(',')

const ACCEPTED_FILE_ERROR =
  'only .xlsx, .csv, .pdf, .docx, .txt, .md, .json and images ' +
  `(${IMAGE_EXT.join(', ')}) are accepted`

// iOS shares photos as HEIC/HEIF, which the gateway rejects outright. Naming the
// fix beats making the user guess which of seven image extensions to try — and
// we deliberately do NOT transcode or silently retry.
const HEIC_EXT = ['.heic', '.heif']
const HEIC_ERROR =
  "HEIC/HEIF photos aren't supported — export or save the photo as JPEG and attach that."

/** True when this filename is one of the OCR-able raster image formats. */
export function isImageFilename(filename: string): boolean {
  const name = filename.toLowerCase()
  return IMAGE_EXT.some((ext) => name.endsWith(ext))
}

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
  if (HEIC_EXT.some((ext) => name.endsWith(ext))) {
    return HEIC_ERROR
  }
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    return ACCEPTED_FILE_ERROR
  }
  if (file.size === 0) {
    return 'uploaded file is empty'
  }
  return null
}

const count = (n: number) => n.toLocaleString('en-US')

/** One-line chip summary for a document, spreadsheet, or image response. */
export function describeUploadSummary(s: UploadSummary): string {
  const parts = [s.kind]
  if ('width' in s) {
    // Frames are deliberately absent — a multi-frame image is a warning
    // (attachmentWarning), not a detail to bury in the muted summary line.
    parts.push(`${count(s.width)} × ${count(s.height)}`)
  } else if ('total_rows' in s) {
    const sheetCount = s.sheets?.length ?? 0
    if (sheetCount > 0) {
      parts.push(`${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`)
    }
    parts.push(`${count(s.total_rows)} ${s.total_rows === 1 ? 'row' : 'rows'}`)
  } else {
    if (s.pages > 0) {
      parts.push(`${count(s.pages)} ${s.pages === 1 ? 'page' : 'pages'}`)
    }
    parts.push(`${count(s.lines)} ${s.lines === 1 ? 'line' : 'lines'}`)
    parts.push(`${count(s.chars)} chars`)
  }
  return parts.join(' · ')
}

/**
 * A warning about content that will NOT reach the model, or null. Both cases are
 * silent data loss the user can only avoid if we say so: a PDF with no text
 * layer isn't read at all, and only the first frame of a multi-frame image
 * (a scanned multi-page .tif) is OCR'd.
 */
export function attachmentWarning(s: UploadSummary): string | null {
  if ('width' in s) {
    if (s.frames > 1) {
      return (
        `Only the first of ${s.frames} pages in this image will be read — ` +
        'send the pages as separate images, or as a PDF.'
      )
    }
    return null
  }
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
