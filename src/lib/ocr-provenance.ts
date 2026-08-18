/**
 * Was this answer built on OCR'd image text? The `read_image` tool tells the
 * model that its result is machine-read and that figures must be verified, but
 * the model does not reliably relay that caveat — testing found it read
 * "Net Pay: 6,518.00" correctly and answered "NPR 6,518.00", inventing a
 * currency and passing on no warning.
 *
 * So the UI raises the caveat itself, driven off the tool signal rather than the
 * model's wording. These are financial documents; the provenance note is a
 * requirement, not a decoration.
 */
import type { ToolCall, TraceEntry } from '@/lib/api'

export const READ_IMAGE_TOOL = 'read_image'

/** OCR provenance for one assistant turn. Presence means "read_image ran". */
export interface OcrProvenance {
  /** Images to offer for comparison; empty when no id could be recovered. */
  imageIds: string[]
}

/**
 * The image id a `read_image` call targeted, or null. `arguments` is whatever
 * the model produced — an object or a JSON-ish string — so both are handled.
 */
export function readImageFileId(args: ToolCall['arguments']): string | null {
  let obj: unknown = args
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args)
    } catch {
      return null
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const id = (obj as Record<string, unknown>).file_id
  if (typeof id !== 'string') return null
  return id.trim() || null
}

/**
 * Read OCR provenance from a persisted or terminal trace. Failed calls are
 * skipped: they handed the model no text, so there is nothing to caveat.
 * Returns null when no image was read.
 */
export function ocrFromTrace(trace: TraceEntry[] | null | undefined): OcrProvenance | null {
  if (!trace || trace.length === 0) return null
  const imageIds: string[] = []
  let used = false
  for (const entry of trace) {
    for (const call of entry.tool_calls ?? []) {
      if (call.name !== READ_IMAGE_TOOL || call.status !== 'ok') continue
      used = true
      const id = readImageFileId(call.arguments)
      if (id && !imageIds.includes(id)) imageIds.push(id)
    }
  }
  return used ? { imageIds } : null
}

/** Merge live-stream provenance with the terminal trace's (either may be absent). */
export function mergeOcr(
  a: OcrProvenance | null | undefined,
  b: OcrProvenance | null | undefined,
): OcrProvenance | null {
  if (!a) return b ?? null
  if (!b) return a
  return { imageIds: [...a.imageIds, ...b.imageIds.filter((id) => !a.imageIds.includes(id))] }
}
