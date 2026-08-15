import { describe, expect, it } from 'vitest'
import {
  describeUploadError,
  describeUploadSummary,
  scannedPdfWarning,
  validateUpload,
} from '@/lib/upload-validation'
import { GatewayError } from '@/lib/api'

function fileOfSize(name: string, bytes: number): File {
  // A File whose .size is `bytes` without allocating that much memory.
  const blob = { size: bytes, type: '' } as Blob
  const file = new File([blob], name)
  Object.defineProperty(file, 'size', { value: bytes, writable: true })
  return file
}

describe('validateUpload', () => {
  it('accepts .xlsx', () => {
    expect(validateUpload(new File(['x'], 'a.xlsx'))).toBeNull()
  })
  it('accepts .csv', () => {
    expect(validateUpload(new File(['x'], 'a.csv'))).toBeNull()
  })
  it.each(['pdf', 'docx', 'txt', 'md', 'json'])('accepts .%s documents', (ext) => {
    expect(validateUpload(new File(['x'], `a.${ext}`))).toBeNull()
  })
  it('accepts uppercase extension', () => {
    expect(validateUpload(new File(['x'], 'A.PDF'))).toBeNull()
  })
  it('rejects .xls', () => {
    expect(validateUpload(new File(['x'], 'a.xls'))).toBe(
      'only .xlsx, .csv, .pdf, .docx, .txt, .md and .json files are accepted',
    )
  })
  it('rejects an empty upload', () => {
    expect(validateUpload(new File([], 'a.pdf'))).toBe('uploaded file is empty')
  })
  // The size cap is the gateway's (settings.upload_max_bytes, env-overridable).
  // The client must not mirror it, or a deployment that raises the limit is
  // still blocked here.
  it('accepts a file well over the gateway default of 10 MB', () => {
    expect(validateUpload(fileOfSize('a.xlsx', 50 * 1024 * 1024))).toBeNull()
  })
  it('accepts a file far beyond any plausible cap', () => {
    expect(validateUpload(fileOfSize('a.pdf', 2 * 1024 * 1024 * 1024))).toBeNull()
  })
  it('still rejects a huge file with a disallowed extension', () => {
    expect(validateUpload(fileOfSize('a.xls', 50 * 1024 * 1024))).toBe(
      'only .xlsx, .csv, .pdf, .docx, .txt, .md and .json files are accepted',
    )
  })
})

describe('describeUploadSummary', () => {
  it('formats a multi-sheet Excel with sheet count and grouped rows', () => {
    expect(
      describeUploadSummary({
        kind: 'Excel',
        total_rows: 1270,
        sheets: [
          { name: 'Q1', rows: 1240, cols: 6, headers: [] },
          { name: 'Q2', rows: 30, cols: 6, headers: [] },
        ],
      }),
    ).toBe('Excel · 2 sheets · 1,270 rows')
  })
  it('uses the singular for one sheet', () => {
    expect(
      describeUploadSummary({
        kind: 'Excel',
        total_rows: 5,
        sheets: [{ name: 'S', rows: 5, cols: 2, headers: [] }],
      }),
    ).toBe('Excel · 1 sheet · 5 rows')
  })
  it('omits the sheet count for CSV (no sheets)', () => {
    expect(describeUploadSummary({ kind: 'CSV', total_rows: 1270 })).toBe(
      'CSV · 1,270 rows',
    )
  })
  it('uses the singular for one row', () => {
    expect(describeUploadSummary({ kind: 'CSV', total_rows: 1 })).toBe('CSV · 1 row')
  })
  it('formats PDF pages, lines, and characters', () => {
    expect(
      describeUploadSummary({
        kind: 'PDF',
        pages: 3,
        text_pages: 3,
        lines: 125,
        chars: 9042,
      }),
    ).toBe('PDF · 3 pages · 125 lines · 9,042 chars')
  })
  it('formats non-paged documents without a zero-page label', () => {
    expect(
      describeUploadSummary({
        kind: 'Markdown',
        pages: 0,
        text_pages: 0,
        lines: 1,
        chars: 20,
      }),
    ).toBe('Markdown · 1 line · 20 chars')
  })
})

describe('scannedPdfWarning', () => {
  const warning = "No text layer — this looks like a scan and can't be read yet."

  it('warns only when a PDF has pages and zero text pages', () => {
    expect(
      scannedPdfWarning({ kind: 'PDF', pages: 2, text_pages: 0, lines: 0, chars: 0 }),
    ).toBe(warning)
  })

  it('does not warn for a partial scan', () => {
    expect(
      scannedPdfWarning({ kind: 'PDF', pages: 2, text_pages: 1, lines: 10, chars: 80 }),
    ).toBeNull()
  })

  it('does not warn for a zero-page text document', () => {
    expect(
      scannedPdfWarning({ kind: 'Text file', pages: 0, text_pages: 0, lines: 1, chars: 3 }),
    ).toBeNull()
  })
})

describe('describeUploadError', () => {
  it('passes a 413 detail through verbatim', () => {
    expect(describeUploadError(new GatewayError(413, 'Payload Too Large'))).toBe(
      'Payload Too Large',
    )
  })
  // The gateway builds this string from its own configured cap, so whatever
  // limit that deployment runs is the number the user sees.
  it("surfaces the gateway's own size-limit wording", () => {
    expect(
      describeUploadError(new GatewayError(413, 'file exceeds the 10 MB limit')),
    ).toBe('file exceeds the 10 MB limit')
  })
  it('passes a 400 detail through verbatim', () => {
    expect(describeUploadError(new GatewayError(400, 'could not read the spreadsheet'))).toBe(
      'could not read the spreadsheet',
    )
  })
  // A mid-stream 413 tears the connection down, so the browser reports a fetch
  // TypeError rather than a readable response. The copy must not claim the
  // gateway is down when an oversized file is the likelier cause.
  it('describes a failed request without asserting the gateway is down', () => {
    expect(describeUploadError(new TypeError('Failed to fetch'))).toBe(
      'Upload failed — the file may be too large, or the gateway is unreachable.',
    )
  })
})
