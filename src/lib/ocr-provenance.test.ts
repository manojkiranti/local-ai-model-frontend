import { describe, expect, it } from 'vitest'
import { READ_IMAGE_TOOL, ocrFromTrace, readImageFileId } from '@/lib/ocr-provenance'
import type { TraceEntry } from '@/lib/api'

function trace(...tools: Array<{ name: string; arguments?: unknown; status?: string }>): TraceEntry[] {
  return [
    {
      iteration: 1,
      assistant_content: null,
      tool_calls: tools.map((t) => ({
        name: t.name,
        arguments: (t.arguments ?? {}) as Record<string, unknown>,
        result: 'text',
        status: (t.status ?? 'ok') as 'ok',
      })),
    },
  ]
}

describe('readImageFileId', () => {
  it('reads file_id from object arguments', () => {
    expect(readImageFileId({ file_id: 'abc' })).toBe('abc')
  })
  // The gateway types `arguments` as object OR a JSON-ish string, because that
  // is what the model produced.
  it('reads file_id from a JSON string', () => {
    expect(readImageFileId('{"file_id": "abc", "start": 1}')).toBe('abc')
  })
  it('trims surrounding whitespace', () => {
    expect(readImageFileId({ file_id: '  abc  ' })).toBe('abc')
  })
  it('is null for unparseable arguments', () => {
    expect(readImageFileId('not json at all')).toBeNull()
  })
  it('is null when file_id is missing, blank, or not a string', () => {
    expect(readImageFileId({})).toBeNull()
    expect(readImageFileId({ file_id: '   ' })).toBeNull()
    expect(readImageFileId({ file_id: 42 })).toBeNull()
  })
  it('is null for a JSON scalar or array', () => {
    expect(readImageFileId('"abc"')).toBeNull()
    expect(readImageFileId('[1,2]')).toBeNull()
  })
})

describe('ocrFromTrace', () => {
  it('is null when nothing read an image', () => {
    expect(ocrFromTrace(trace({ name: 'read_document', arguments: { file_id: 'd1' } }))).toBeNull()
  })
  it('is null for a null or empty trace', () => {
    expect(ocrFromTrace(null)).toBeNull()
    expect(ocrFromTrace(undefined)).toBeNull()
    expect(ocrFromTrace([])).toBeNull()
  })
  it('collects the image id read by OCR', () => {
    expect(ocrFromTrace(trace({ name: READ_IMAGE_TOOL, arguments: { file_id: 'img-1' } }))).toEqual({
      imageIds: ['img-1'],
    })
  })
  it('ignores other tools in the same turn', () => {
    expect(
      ocrFromTrace(
        trace(
          { name: 'web_fetch', arguments: { url: 'x' } },
          { name: READ_IMAGE_TOOL, arguments: { file_id: 'img-1' } },
        ),
      ),
    ).toEqual({ imageIds: ['img-1'] })
  })
  it('dedupes repeated paging calls on the same image, preserving order', () => {
    expect(
      ocrFromTrace([
        ...trace(
          { name: READ_IMAGE_TOOL, arguments: { file_id: 'img-1' } },
          { name: READ_IMAGE_TOOL, arguments: { file_id: 'img-2' } },
        ),
        ...trace({ name: READ_IMAGE_TOOL, arguments: { file_id: 'img-1', start: 200 } }),
      ]),
    ).toEqual({ imageIds: ['img-1', 'img-2'] })
  })
  // The badge is a provenance caveat about the ANSWER, so a call whose id we
  // cannot recover must still raise it — only the "view image" link is lost.
  it('reports OCR with no ids when the arguments are unreadable', () => {
    expect(ocrFromTrace(trace({ name: READ_IMAGE_TOOL, arguments: 'garbage' }))).toEqual({
      imageIds: [],
    })
  })
  // A failed read gave the model no OCR text, so there is nothing to caveat.
  it('ignores a read that failed', () => {
    expect(
      ocrFromTrace(
        trace({ name: READ_IMAGE_TOOL, arguments: { file_id: 'img-1' }, status: 'tool_error' }),
      ),
    ).toBeNull()
  })
})
