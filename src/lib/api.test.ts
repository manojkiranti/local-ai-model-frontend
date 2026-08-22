import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cosineSimilarity,
  createDepartmentTextDocument,
  describeError,
  fetchDepartmentDocument,
  getMe,
  getIngestJob,
  grantDepartmentMember,
  listDepartmentDocuments,
  listDepartments,
  listFiles,
  listUsers,
  login,
  readNdjson,
  register,
  updateUser,
  uploadFile,
  uploadDepartmentDocument,
  GatewayError,
} from '@/lib/api'
import {
  clearToken,
  getToken,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Build a byte stream that emits the given string chunks, in order. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const obj of readNdjson(stream)) out.push(obj)
  return out
}

describe('readNdjson', () => {
  it('parses one JSON object per line', async () => {
    const objs = await collect(
      streamFromChunks(['{"a":1}\n', '{"a":2}\n', '{"a":3}\n']),
    )
    expect(objs).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })

  it('parses a final line with no trailing newline', async () => {
    const objs = await collect(streamFromChunks(['{"done":false}\n{"done":true}']))
    expect(objs).toEqual([{ done: false }, { done: true }])
  })

  it('reassembles a line split across chunk boundaries', async () => {
    const objs = await collect(
      streamFromChunks(['{"mess', 'age":{"content":"hi', ' there"}}\n']),
    )
    expect(objs).toEqual([{ message: { content: 'hi there' } }])
  })

  it('ignores blank lines', async () => {
    const objs = await collect(streamFromChunks(['\n{"a":1}\n\n{"a":2}\n\n']))
    expect(objs).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('handles multiple objects arriving in a single chunk', async () => {
    const objs = await collect(streamFromChunks(['{"a":1}\n{"a":2}\n{"a":3}']))
    expect(objs).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10)
  })

  it('computes a known intermediate value', () => {
    // angle between (1,1) and (1,0) is 45°, cos = 1/sqrt(2)
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2, 10)
  })

  it('returns NaN for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBeNaN()
  })

  it('returns NaN for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBeNaN()
  })

  it('returns NaN when a vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNaN()
  })
})

describe('api client requests', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('injects the bearer token when one is stored', async () => {
    setToken('tok.123')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 1, email: 'a@b.co' }))
    await getMe()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/users/me')
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.123')
  })

  it('does not send Authorization when logged out', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ access_token: 'x', token_type: 'bearer', expires_in: 60 }),
      )
    await login('a@b.co', 'supersecret123')
    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init!.headers).has('Authorization')).toBe(false)
  })

  it('posts JSON body to /auth/register with a content-type header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 1, email: 'a@b.co' }, 201))
    await register('a@b.co', 'supersecret123')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/auth/register')
    expect(init!.method).toBe('POST')
    expect(new Headers(init!.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init!.body as string)).toEqual({
      email: 'a@b.co',
      password: 'supersecret123',
    })
  })

  it('on 401 clears the token and fires the unauthorized handler', async () => {
    setToken('tok.123')
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Could not validate credentials' }, 401),
    )
    await expect(getMe()).rejects.toBeInstanceOf(GatewayError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    // token cleared:
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 1, email: 'a@b.co' }))
    await getMe()
    const [, init] = fetchMock.mock.calls.at(-1)!
    expect(new Headers(init!.headers).has('Authorization')).toBe(false)
  })
})

describe('describeError mapping', () => {
  it('maps 404 to a model-not-available message', () => {
    expect(describeError(new GatewayError(404, 'nope'))).toBe(
      'model not available on the server',
    )
  })
  it('maps 502 to an inference-unavailable message', () => {
    expect(describeError(new GatewayError(502, 'nope'))).toBe(
      'inference service is unavailable',
    )
  })
  it('falls back to the detail message for other statuses', () => {
    expect(describeError(new GatewayError(409, 'Email already registered'))).toBe(
      'Email already registered',
    )
  })
})

describe('file endpoints', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.abc')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('uploadFile posts FormData with the file and NO manual Content-Type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { id: 'abc', filename: 'sales.xlsx', media_type: 'x', size: 10, source: 'uploaded', summary: { kind: 'Excel', total_rows: 1 } },
        201,
      ),
    )
    const file = new File(['a,b\n1,2\n'], 'sales.csv', { type: 'text/csv' })
    const out = await uploadFile(file)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/files')
    expect(init!.method).toBe('POST')
    expect(init!.body).toBeInstanceOf(FormData)
    expect((init!.body as FormData).get('file')).toBeInstanceOf(File)
    // The multipart boundary must be browser-set — no manual JSON content-type.
    expect(new Headers(init!.headers).get('Content-Type')).toBeNull()
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.abc')
    expect(out.id).toBe('abc')
  })

  it('uploadFile throws GatewayError with the detail on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'could not read the spreadsheet' }, 400),
    )
    const file = new File(['x'], 'bad.xlsx')
    await expect(uploadFile(file)).rejects.toMatchObject({
      status: 400,
      message: 'could not read the spreadsheet',
    })
  })

  it('listFiles(source) sends the ?source= query param', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ files: [] }),
    )
    await listFiles('uploaded')
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8000/v1/files?source=uploaded')
  })

  it('listFiles() with no source hits the bare endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ files: [] }),
    )
    await listFiles()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8000/v1/files')
  })
})

describe('department RAG endpoints', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.rag')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('lists the authenticated user departments', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse([]))
    await listDepartments()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/departments')
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.rag')
  })

  it('uploads a department document as multipart with title and file', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ document_id: 'doc-1', job_id: 'job-1', status: 'queued' }, 202),
    )
    const file = new File(['data'], 'policy.pdf', { type: 'application/pdf' })
    await uploadDepartmentDocument('human-resources', 'Leave policy', file)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://localhost:8000/v1/departments/human-resources/documents',
    )
    expect(init!.body).toBeInstanceOf(FormData)
    expect((init!.body as FormData).get('title')).toBe('Leave policy')
    expect((init!.body as FormData).get('file')).toBeInstanceOf(File)
    expect(new Headers(init!.headers).get('Content-Type')).toBeNull()
  })

  it('posts typed knowledge and polls the returned ingestion job', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ document_id: 'doc-1', job_id: 'job-1', status: 'queued' }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'job-1',
          document_id: 'doc-1',
          status: 'running',
          chunks_total: 3,
          chunks_done: 1,
          attempts: 1,
          error: null,
          created_at: '2026-08-09T00:00:00Z',
          finished_at: null,
        }),
      )
    await createDepartmentTextDocument('hr', { title: 'Policy', content: 'Text' })
    await getIngestJob('job-1')
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8000/v1/departments/hr/documents/text',
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      title: 'Policy',
      content: 'Text',
    })
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'http://localhost:8000/v1/ingest-jobs/job-1',
    )
  })

  it('adds include_archived only when requested', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse([]))
    await listDepartmentDocuments('finance', true)
    await listDepartmentDocuments('finance')
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8000/v1/departments/finance/documents?include_archived=true',
    )
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'http://localhost:8000/v1/departments/finance/documents',
    )
  })
})

// A citation's link is behind JWT, so it can only be fetched with the bearer
// header — never followed by an <a href>, which sends none and 401s.
describe('cited document download', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.cite')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('fetches the server-derived path verbatim, with the bearer header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('bytes', { status: 200 }))
    // Exactly the `download_url` a Source carried — not rebuilt from its parts.
    await fetchDepartmentDocument('/v1/departments/hr/documents/doc-1/download')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://localhost:8000/v1/departments/hr/documents/doc-1/download',
    )
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.cite')
  })

  it('refuses a link that is not a relative gateway path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(fetchDepartmentDocument('https://evil.example/steal')).rejects.toThrow(
      /no usable download link/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // A leading slash is not proof of same-origin: these are protocol-relative,
  // and with an empty VITE_API_BASE_URL they would be fetched as-is — sending
  // the bearer token to that host.
  it.each(['//evil.example/steal', '/\\evil.example/steal', '/\t//evil.example/steal'])(
    'refuses the protocol-relative link %j',
    async (link) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch')
      await expect(fetchDepartmentDocument(link)).rejects.toThrow(/no usable download link/)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('still accepts a path with a query string and encoded segments', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('bytes', { status: 200 }))
    await fetchDepartmentDocument('/v1/departments/hr%20ops/documents/doc-1/download?v=2')
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8000/v1/departments/hr%20ops/documents/doc-1/download?v=2',
    )
  })

  it('surfaces the gateway detail for 403 and 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Unknown document' }, 404),
    )
    await expect(
      fetchDepartmentDocument('/v1/departments/hr/documents/doc-1/download'),
    ).rejects.toMatchObject({ status: 404, message: 'Unknown document' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'No access to department hr' }, 403),
    )
    await expect(
      fetchDepartmentDocument('/v1/departments/hr/documents/doc-1/download'),
    ).rejects.toMatchObject({ status: 403, message: 'No access to department hr' })
  })
})

// Granting is also promote/demote, and the gateway takes `user_id` XOR `email`
// with `extra="forbid"` — so exactly one identifier goes on the wire.
describe('department member grants', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.grant')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  // The endpoint UPSERTS, so an absent `role` means "do not change the level"
  // (viewer for a new grant, unchanged for an existing one). A client-side
  // default of 'viewer' is therefore a silent demotion on any re-grant: the
  // server cannot tell it from a deliberate one, and must not try.
  it('omits role entirely when the caller chose no level', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await grantDepartmentMember('human-resources', { email: 'nina@odin.test' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://localhost:8000/v1/departments/human-resources/members',
    )
    expect(init!.method).toBe('POST')
    const body = JSON.parse(String(init!.body))
    expect(body).toEqual({ email: 'nina@odin.test' })
    expect('role' in body).toBe(false)
  })

  it('sends the level when the caller chose one', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await grantDepartmentMember('human-resources', { email: 'nina@odin.test' }, 'owner')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({
      email: 'nina@odin.test',
      role: 'owner',
    })
  })

  it('changes an existing member level by user id, sending no email', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await grantDepartmentMember('finance', { user_id: 42 }, 'editor')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body))
    expect(body).toEqual({ user_id: 42, role: 'editor' })
    expect('email' in body).toBe(false)
  })

  // Trap: a 403 here is an escalation refusal, not an expired session. Firing
  // the unauthorized handler would log an owner out for overreaching.
  it('keeps the session on a 403 escalation refusal', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { detail: 'Only a global admin can grant owner access to a department' },
        403,
      ),
    )
    await expect(
      grantDepartmentMember('finance', { email: 'nina@odin.test' }, 'owner'),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Only a global admin can grant owner access to a department',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(getToken()).toBe('tok.grant')
  })

  it('keeps the session on a 403 from a level-gated read', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Editor access to this department is required' }, 403),
    )
    await expect(listDepartmentDocuments('finance', true)).rejects.toMatchObject({
      status: 403,
      message: 'Editor access to this department is required',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(getToken()).toBe('tok.grant')
  })
})

describe('admin user administration', () => {
  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.users')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  const page = { total: 0, limit: 50, offset: 0, items: [] }

  it('defaults to a single wide page so the grant picker still sees everyone', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(page))
    await listUsers()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:8000/users?limit=200')
  })

  it('passes the search query and pagination through', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(page))
    await listUsers({ q: 'nina', limit: 50, offset: 100 })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/users')
    expect(url.searchParams.get('q')).toBe('nina')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('offset')).toBe('100')
  })

  it('omits a blank query and a zero offset', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(page))
    await listUsers({ q: '   ', limit: 50, offset: 0 })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.has('q')).toBe(false)
    expect(url.searchParams.has('offset')).toBe(false)
  })

  it('PATCHes only is_active to the user, returning the updated row', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 7, email: 'nina@odin.test', is_active: false }))
    const updated = await updateUser(7, { is_active: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/users/7')
    expect(init!.method).toBe('PATCH')
    expect(JSON.parse(String(init!.body))).toEqual({ is_active: false })
    expect(updated.is_active).toBe(false)
  })

  // A 409 (last active admin, or your own account) is a policy refusal, not an
  // expired session — surface it and keep the token.
  it('keeps the session on a 409 deactivation refusal', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { detail: 'This is the last active admin; promote or activate another admin first' },
        409,
      ),
    )
    await expect(updateUser(3, { is_active: false })).rejects.toMatchObject({
      status: 409,
      message: 'This is the last active admin; promote or activate another admin first',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(getToken()).toBe('tok.users')
  })
})
