import { describe, expect, it } from 'vitest'
import { extractDownloads, type TraceEntry } from './agent-api'

const okResult =
  "Created Excel file 'budget.xlsx' (4951 bytes, 3 data row(s)). " +
  'Download it at: GET /v1/files/3f03416d911a4762885b8d895fa3ab7f'

const htmlResult =
  "Created HTML file 'report.html' (1820 bytes). " +
  'Download it at: GET /v1/files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function trace(...tool_calls: TraceEntry['tool_calls']): TraceEntry[] {
  return [{ iteration: 1, assistant_content: null, tool_calls }]
}

describe('extractDownloads', () => {
  it('pulls id, filename, bytes, rows, kind and url from a create_excel result', () => {
    const downloads = extractDownloads(
      trace({ name: 'create_excel', arguments: {}, result: okResult, status: 'ok' }),
    )
    expect(downloads).toHaveLength(1)
    expect(downloads[0]).toMatchObject({
      id: '3f03416d911a4762885b8d895fa3ab7f',
      filename: 'budget.xlsx',
      kind: 'excel',
      bytes: 4951,
      rows: 3,
    })
    expect(downloads[0].url).toContain('/v1/files/3f03416d911a4762885b8d895fa3ab7f')
  })

  it('pulls an html artifact from a create_html result (no rows)', () => {
    const downloads = extractDownloads(
      trace({ name: 'create_html', arguments: {}, result: htmlResult, status: 'ok' }),
    )
    expect(downloads).toHaveLength(1)
    expect(downloads[0]).toMatchObject({
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      filename: 'report.html',
      kind: 'html',
      bytes: 1820,
    })
    expect(downloads[0].rows).toBeUndefined()
  })

  it('ignores non-file tools and non-ok statuses', () => {
    const downloads = extractDownloads(
      trace(
        { name: 'search_web', arguments: {}, result: okResult, status: 'ok' },
        { name: 'create_excel', arguments: {}, result: okResult, status: 'tool_error' },
        { name: 'create_excel', arguments: {}, result: null, status: 'ok' },
      ),
    )
    expect(downloads).toHaveLength(0)
  })

  it('dedupes the same file id across iterations (e.g. a retry)', () => {
    const downloads = extractDownloads([
      { iteration: 1, assistant_content: null, tool_calls: [
        { name: 'create_excel', arguments: {}, result: okResult, status: 'ok' },
      ] },
      { iteration: 2, assistant_content: null, tool_calls: [
        { name: 'create_excel', arguments: {}, result: okResult, status: 'ok' },
      ] },
    ])
    expect(downloads).toHaveLength(1)
  })

  it('collects multiple distinct files across tools', () => {
    const downloads = extractDownloads(
      trace(
        { name: 'create_excel', arguments: {}, result: okResult, status: 'ok' },
        { name: 'create_html', arguments: {}, result: htmlResult, status: 'ok' },
      ),
    )
    expect(downloads.map((d) => d.filename)).toEqual(['budget.xlsx', 'report.html'])
    expect(downloads.map((d) => d.kind)).toEqual(['excel', 'html'])
  })

  it('returns [] for empty or malformed input', () => {
    expect(extractDownloads([])).toEqual([])
    expect(
      extractDownloads(
        trace({ name: 'create_excel', arguments: {}, result: 'no link here', status: 'ok' }),
      ),
    ).toEqual([])
  })
})
