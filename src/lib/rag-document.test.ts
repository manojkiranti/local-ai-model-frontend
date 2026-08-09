import { describe, expect, it } from 'vitest'
import { documentTitleFromFilename } from '@/lib/rag-document'

describe('documentTitleFromFilename', () => {
  it('removes the extension and normalizes separators', () => {
    expect(documentTitleFromFilename('employee_handbook-v2.pdf')).toBe(
      'Employee handbook v2',
    )
  })

  it('preserves useful capitalization', () => {
    expect(documentTitleFromFilename('Q4_Report.xlsx')).toBe('Q4 Report')
  })

  it('handles a filename without an extension', () => {
    expect(documentTitleFromFilename('policy notes')).toBe('Policy notes')
  })
})
