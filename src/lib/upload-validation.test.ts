import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  describeUploadError,
  describeUploadSummary,
  validateSpreadsheet,
} from '@/lib/upload-validation'
import { GatewayError } from '@/lib/api'

function fileOfSize(name: string, bytes: number): File {
  // A File whose .size is `bytes` without allocating that much memory.
  const blob = { size: bytes, type: '' } as Blob
  const file = new File([blob], name)
  Object.defineProperty(file, 'size', { value: bytes, writable: true })
  return file
}

describe('validateSpreadsheet', () => {
  it('accepts .xlsx', () => {
    expect(validateSpreadsheet(new File(['x'], 'a.xlsx'))).toBeNull()
  })
  it('accepts .csv', () => {
    expect(validateSpreadsheet(new File(['x'], 'a.csv'))).toBeNull()
  })
  it('accepts uppercase extension', () => {
    expect(validateSpreadsheet(new File(['x'], 'A.XLSX'))).toBeNull()
  })
  it('rejects .xls', () => {
    expect(validateSpreadsheet(new File(['x'], 'a.xls'))).toBe(
      'Only .xlsx and .csv files are accepted',
    )
  })
  it('rejects .pdf', () => {
    expect(validateSpreadsheet(new File(['x'], 'a.pdf'))).toBe(
      'Only .xlsx and .csv files are accepted',
    )
  })
  it('accepts a file of exactly 10 MB', () => {
    expect(validateSpreadsheet(fileOfSize('a.xlsx', MAX_UPLOAD_BYTES))).toBeNull()
  })
  it('rejects a file over 10 MB', () => {
    expect(validateSpreadsheet(fileOfSize('a.xlsx', MAX_UPLOAD_BYTES + 1))).toBe(
      'File exceeds the 10 MB limit',
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
})

describe('describeUploadError', () => {
  it('maps 413 to the size-limit message', () => {
    expect(describeUploadError(new GatewayError(413, 'Payload Too Large'))).toBe(
      'File exceeds the 10 MB limit',
    )
  })
  it('passes a 400 detail through verbatim', () => {
    expect(describeUploadError(new GatewayError(400, 'could not read the spreadsheet'))).toBe(
      'could not read the spreadsheet',
    )
  })
  it('describes a network error', () => {
    expect(describeUploadError(new TypeError('Failed to fetch'))).toBe(
      'Cannot reach the gateway. Is it running on port 8000?',
    )
  })
})
