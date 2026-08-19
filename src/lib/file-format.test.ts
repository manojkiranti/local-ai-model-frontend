import { describe, expect, it } from 'vitest'
import {
  fileKind,
  filenameFromContentDisposition,
  formatBytes,
  relativeTime,
} from './file-format'

describe('fileKind', () => {
  it('maps the gateway media types to short labels', () => {
    expect(fileKind('application/pdf')).toBe('PDF')
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Excel')
    expect(fileKind('application/vnd.ms-excel')).toBe('Excel')
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Word')
    expect(fileKind('image/svg+xml')).toBe('SVG')
    expect(fileKind('text/html; charset=utf-8')).toBe('HTML')
    expect(fileKind('image/png')).toBe('Image')
    expect(fileKind('text/plain')).toBe('Text')
  })

  it('falls back to "File" for unknown or missing types', () => {
    expect(fileKind('application/octet-stream')).toBe('File')
    expect(fileKind(null)).toBe('File')
    expect(fileKind(undefined)).toBe('File')
  })
})

describe('formatBytes', () => {
  it('formats bytes / KB / MB with one decimal, dropping trailing .0', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1362)).toBe('1.3 KB')
    expect(formatBytes(1527)).toBe('1.5 KB')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatBytes(1500000)).toBe('1.4 MB')
  })

  it('handles zero and invalid input', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-08-05T12:00:00Z')

  it('produces compact relative labels', () => {
    expect(relativeTime('2026-08-05T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-08-05T11:58:00Z', now)).toBe('2m ago')
    expect(relativeTime('2026-08-05T10:00:00Z', now)).toBe('2h ago')
    expect(relativeTime('2026-08-03T12:00:00Z', now)).toBe('2d ago')
    expect(relativeTime('2026-07-22T12:00:00Z', now)).toBe('2w ago')
    expect(relativeTime('2026-06-05T12:00:00Z', now)).toBe('2mo ago')
  })

  it('treats future/clock-skew timestamps as "just now" and bad input as empty', () => {
    expect(relativeTime('2026-08-05T12:00:30Z', now)).toBe('just now')
    expect(relativeTime('not-a-date', now)).toBe('')
  })
})

describe('filenameFromContentDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="Monetary Policy.pdf"')).toBe(
      'Monetary Policy.pdf',
    )
  })

  it('decodes the RFC 5987 form the gateway uses for non-ASCII names', () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A8%E0%A5%87.pdf"),
    ).toBe('\u0928\u0947.pdf')
  })

  it('keeps the raw match when the escapes are malformed', () => {
    expect(filenameFromContentDisposition('attachment; filename="100%.pdf"')).toBe(
      '100%.pdf',
    )
  })

  it('is undefined when the header is absent or names nothing', () => {
    expect(filenameFromContentDisposition(null)).toBeUndefined()
    expect(filenameFromContentDisposition('attachment')).toBeUndefined()
  })
})
