import { describe, expect, it } from 'vitest'
import { extractFileRefs, stripFileRefs, type TraceEntry } from './agent-api'

const excelResult =
  "Created Excel file 'budget.xlsx' (4951 bytes, 3 data row(s)). " +
  'Download it at: GET /v1/files/3f03416d911a4762885b8d895fa3ab7f'

const htmlResult =
  "Created HTML file 'report.html' (1820 bytes). " +
  'Download it at: GET /v1/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const chartResult =
  "Created SVG chart 'chart.svg' (2048 bytes). " +
  'Download it at: GET /v1/files/cccccccccccccccccccccccccccccccc'

// Live gateway shape (2026-08-05): create_pdf returns application/pdf and lands
// in FileCard's generic download branch — no per-media-type parsing.
const pdfResult =
  "Created PDF 'document.pdf' (1362 bytes, 2 section(s)). " +
  'Download it at: GET /v1/files/dddddddddddddddddddddddddddddddd'

// create_docx: same link shape; served as wordprocessingml.document (download-only).
const docxResult =
  "Created Word document 'document.docx' (36710 bytes, 2 section(s)). " +
  'Download it at: GET /v1/files/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

function trace(...tool_calls: TraceEntry['tool_calls']): TraceEntry[] {
  return [{ iteration: 1, assistant_content: null, tool_calls }]
}

describe('extractFileRefs', () => {
  it('pulls id and filename hint from a tool result', () => {
    const refs = extractFileRefs('', trace(
      { name: 'create_excel', arguments: {}, result: excelResult, status: 'ok' },
    ))
    expect(refs).toEqual([
      { id: '3f03416d911a4762885b8d895fa3ab7f', filename: 'budget.xlsx' },
    ])
  })

  it('detects a chart (SVG) file the same way — no per-tool allow-list', () => {
    const refs = extractFileRefs('', trace(
      { name: 'create_chart', arguments: {}, result: chartResult, status: 'ok' },
    ))
    expect(refs).toEqual([
      { id: 'cccccccccccccccccccccccccccccccc', filename: 'chart.svg' },
    ])
  })

  it('detects a PDF (create_pdf) the same way — generic download path, no branch', () => {
    const refs = extractFileRefs('', trace(
      { name: 'create_pdf', arguments: {}, result: pdfResult, status: 'ok' },
    ))
    expect(refs).toEqual([
      { id: 'dddddddddddddddddddddddddddddddd', filename: 'document.pdf' },
    ])
  })

  it('detects a Word doc (create_docx) the same way — download-only via the file pipeline', () => {
    const refs = extractFileRefs('', trace(
      { name: 'create_docx', arguments: {}, result: docxResult, status: 'ok' },
    ))
    expect(refs).toEqual([
      { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', filename: 'document.docx' },
    ])
  })

  it('scans the final message text too (id only in the answer)', () => {
    const refs = extractFileRefs(
      'Here is your file: GET /v1/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      null,
    )
    expect(refs).toEqual([{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }])
  })

  it('dedupes an id that appears in both the trace and the text (trace wins its hint)', () => {
    const refs = extractFileRefs(
      'Grab it at GET /v1/files/3f03416d911a4762885b8d895fa3ab7f',
      trace({ name: 'create_excel', arguments: {}, result: excelResult, status: 'ok' }),
    )
    expect(refs).toEqual([
      { id: '3f03416d911a4762885b8d895fa3ab7f', filename: 'budget.xlsx' },
    ])
  })

  it('collects multiple distinct files across tools, trace order first', () => {
    const refs = extractFileRefs('', trace(
      { name: 'create_excel', arguments: {}, result: excelResult, status: 'ok' },
      { name: 'create_html', arguments: {}, result: htmlResult, status: 'ok' },
    ))
    expect(refs.map((r) => r.filename)).toEqual(['budget.xlsx', 'report.html'])
  })

  it('returns [] for empty content and no trace, and ignores resultless calls', () => {
    expect(extractFileRefs('', null)).toEqual([])
    expect(extractFileRefs('no link here', trace(
      { name: 'create_excel', arguments: {}, result: null, status: 'ok' },
    ))).toEqual([])
  })
})

describe('stripFileRefs', () => {
  it('removes a "Download it at: GET /v1/files/…" lead-in but keeps the prose', () => {
    expect(
      stripFileRefs(
        "The chart is ready. Created SVG chart 'chart.svg' (2048 bytes). " +
          'Download it at: GET /v1/files/cccccccccccccccccccccccccccccccc',
      ),
    ).toBe("The chart is ready. Created SVG chart 'chart.svg' (2048 bytes).")
  })

  it('strips a bare URL', () => {
    expect(stripFileRefs('See /v1/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa for the file.'))
      .toBe('See for the file.')
  })

  it('strips a markdown link to the file', () => {
    expect(
      stripFileRefs('Your report: [download](/v1/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)'),
    ).toBe('Your report:')
  })

  it('leaves text with no file reference untouched', () => {
    expect(stripFileRefs('Just a normal answer.')).toBe('Just a normal answer.')
  })
})
