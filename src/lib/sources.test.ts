import { describe, expect, it } from 'vitest'
import type { Source } from '@/lib/api'
import {
  downloadFilename,
  externalLinkHost,
  fileTypeLabel,
  isBrowserViewable,
  isMachineRecovered,
  isNrbSource,
  pagesLabel,
  partitionSources,
  publishedLabel,
  routeLabel,
  routesLabel,
  sourceTitle,
} from '@/lib/sources'

function source(overrides: Partial<Source> = {}): Source {
  return {
    document_id: 'doc-abcdef123456',
    title: 'Leave policy',
    department_code: 'hr',
    file_name: 'leave-policy.pdf',
    file_type: 'pdf',
    pages: [2],
    cited: true,
    download_url: '/v1/departments/hr/documents/doc-abcdef123456/download',
    ...overrides,
  }
}

describe('pagesLabel', () => {
  it('is null for an unpaginated format', () => {
    // CSV/XLSX/typed text have no pages; that is normal, not an error.
    expect(pagesLabel([])).toBeNull()
    expect(pagesLabel(null)).toBeNull()
    expect(pagesLabel(undefined)).toBeNull()
  })

  it('uses the singular for one page', () => {
    expect(pagesLabel([4])).toBe('p. 4')
  })

  it('collapses consecutive pages into ranges', () => {
    expect(pagesLabel([4, 5, 6, 12])).toBe('pp. 4–6, 12')
  })

  it('sorts and de-duplicates defensively', () => {
    expect(pagesLabel([12, 4, 5, 4, 6])).toBe('pp. 4–6, 12')
  })
})

describe('sourceTitle', () => {
  it('prefers the title', () => {
    expect(sourceTitle(source())).toBe('Leave policy')
  })

  it('falls back to the file name, then to the id', () => {
    expect(sourceTitle(source({ title: '   ' }))).toBe('leave-policy.pdf')
    expect(sourceTitle(source({ title: '', file_name: null }))).toBe('Document doc-abcd')
  })
})

describe('machine-recovered provenance', () => {
  // NRB keys are ABSENT (not null) on an ordinary upload, so "not an NRB
  // document" must never read as "recovered".
  it('is false when the flag is absent or null', () => {
    expect(isMachineRecovered(source())).toBe(false)
    expect(isMachineRecovered(source({ machine_recovered: null }))).toBe(false)
    expect(isMachineRecovered(source({ machine_recovered: false }))).toBe(false)
  })

  it('is true only for an explicit true', () => {
    expect(isMachineRecovered(source({ machine_recovered: true }))).toBe(true)
  })

  it('labels every route the gateway can report, and unknown ones as themselves', () => {
    expect(routeLabel('ocr')).toBe('OCR')
    expect(routeLabel('native')).toBe('native text layer')
    expect(routeLabel('legacy_conversion')).toBe('legacy Nepali font conversion')
    expect(routeLabel('future_route')).toBe('future_route')
  })

  it('joins the per-page routes and is null when there are none', () => {
    expect(routesLabel(['ocr', 'native'])).toBe('OCR, native text layer')
    expect(routesLabel([])).toBeNull()
    expect(routesLabel(null)).toBeNull()
  })
})

describe('publishedLabel', () => {
  it('keeps the gateway ISO day and drops any time part', () => {
    expect(publishedLabel('2024-07-12T00:00:00Z')).toBe('2024-07-12')
    expect(publishedLabel('2024-07-12')).toBe('2024-07-12')
  })

  it('passes a non-ISO value through rather than dropping it', () => {
    expect(publishedLabel('2081 Ashadh')).toBe('2081 Ashadh')
  })

  it('is null when absent', () => {
    expect(publishedLabel(null)).toBeNull()
    expect(publishedLabel('  ')).toBeNull()
  })
})

describe('isNrbSource', () => {
  it('is true only for the nrb catalog origin', () => {
    expect(isNrbSource(source({ origin: 'nrb' }))).toBe(true)
    expect(isNrbSource(source({ origin: 'upload' }))).toBe(false)
    expect(isNrbSource(source())).toBe(false)
  })
})

describe('partitionSources', () => {
  it('separates cited documents from grounded-but-unmarked ones', () => {
    const a = source({ document_id: 'a', cited: true })
    const b = source({ document_id: 'b', cited: false })
    const { cited, related } = partitionSources([a, b])
    expect(cited.map((s) => s.document_id)).toEqual(['a'])
    expect(related.map((s) => s.document_id)).toEqual(['b'])
  })

  it('preserves the server order within each group (best first)', () => {
    const list = [
      source({ document_id: 'first', cited: false }),
      source({ document_id: 'second', cited: false }),
    ]
    expect(partitionSources(list).related.map((s) => s.document_id)).toEqual([
      'first',
      'second',
    ])
  })
})

describe('externalLinkHost', () => {
  it('returns the host of an http(s) url', () => {
    expect(externalLinkHost('https://www.nrb.org.np/circulars/1')).toBe('www.nrb.org.np')
  })

  it('rejects anything that is not http(s), so it is never rendered as a link', () => {
    expect(externalLinkHost('javascript:alert(1)')).toBeNull()
    expect(externalLinkHost('not a url')).toBeNull()
    expect(externalLinkHost(null)).toBeNull()
  })
})

describe('fileTypeLabel', () => {
  it('upper-cases a format and title-cases plain text', () => {
    expect(fileTypeLabel('pdf')).toBe('PDF')
    expect(fileTypeLabel('xlsx')).toBe('XLSX')
    expect(fileTypeLabel('text')).toBe('Text')
  })

  it('is null when unknown', () => {
    expect(fileTypeLabel(null)).toBeNull()
  })
})

describe('isBrowserViewable', () => {
  // A browser renders these in a tab; the Office formats it cannot, so they get
  // download only rather than a "view" that is really a second download.
  it('is true for the browser-renderable formats', () => {
    expect(isBrowserViewable(source({ file_type: 'pdf' }))).toBe(true)
    expect(isBrowserViewable(source({ file_type: 'text' }))).toBe(true)
    expect(isBrowserViewable(source({ file_type: 'csv' }))).toBe(true)
  })

  it('is false for docx, xlsx, and unknown types', () => {
    expect(isBrowserViewable(source({ file_type: 'docx' }))).toBe(false)
    expect(isBrowserViewable(source({ file_type: 'xlsx' }))).toBe(false)
    expect(isBrowserViewable(source({ file_type: null }))).toBe(false)
  })
})

describe('downloadFilename', () => {
  it('prefers the name the server announced', () => {
    expect(
      downloadFilename(source(), 'attachment; filename="Monetary Policy 2081.pdf"'),
    ).toBe('Monetary Policy 2081.pdf')
  })

  it('falls back to the document file name', () => {
    expect(downloadFilename(source(), null)).toBe('leave-policy.pdf')
  })

  it('builds a safe name from the title when the document has no file name', () => {
    expect(downloadFilename(source({ file_name: null, title: 'Q1/Q2 report' }))).toBe(
      'Q1_Q2 report.pdf',
    )
  })
})
