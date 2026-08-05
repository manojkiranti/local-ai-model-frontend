/**
 * Pure presentation helpers for the My Files view — byte sizes, relative times,
 * and a short type label derived from a media type. Kept dependency-free and
 * unit tested (the branching is the easy thing to get subtly wrong).
 */

/** Short, human label for a media type: PDF / Excel / HTML / SVG / … */
export function fileKind(mediaType: string | null | undefined): string {
  const ct = (mediaType ?? '').toLowerCase()
  if (ct.includes('pdf')) return 'PDF'
  if (ct.includes('spreadsheetml.sheet') || ct.includes('ms-excel')) return 'Excel'
  if (ct.includes('wordprocessingml.document') || ct.includes('msword')) return 'Word'
  if (ct.includes('svg')) return 'SVG'
  if (ct.includes('html')) return 'HTML'
  if (ct.startsWith('image/')) return 'Image'
  if (ct.includes('csv')) return 'CSV'
  if (ct.includes('json')) return 'JSON'
  if (ct.startsWith('text/')) return 'Text'
  return 'File'
}

/** Human-readable byte size, e.g. 1362 → "1.3 KB", 900 → "900 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  // One decimal, but drop a trailing ".0" (e.g. 2 MB, not 2.0 MB).
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${units[unit]}`
}

/** Compact relative time from an ISO timestamp, e.g. "2h ago", "just now". */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.round((nowMs - then) / 1000)
  if (secs < 0) return 'just now'
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (days < 30) return `${weeks}w ago`
  const months = Math.round(days / 30)
  if (days < 365) return `${months}mo ago`
  return `${Math.round(days / 365)}y ago`
}
