# RAG Source Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which department documents an assistant answer drew on, as a collapsed "Sources (N)" panel whose rows open the document in a new browser tab.

**Architecture:** The gateway already returns a `sources` array on department (RAG) chat responses; the frontend currently drops it. Four layers, built bottom-up: transport and types in the single API client, pure formatting helpers, the message-state hook, then the presentational component wired into `MessageBubble`. Downloads go through a bearer-authenticated fetch into a blob URL — a plain anchor cannot send the `Authorization` header.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + jsdom, `@testing-library/react`, Tailwind v4, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-09-rag-source-citations-design.md`

## Global Constraints

- Vitest `include` is `src/**/*.test.ts` (see `vite.config.ts`). **Test files must be `.ts`, never `.tsx`.** Do not change the vitest config; no `.tsx` test file is required by this plan.
- Path alias: `@` resolves to `src/` (`vite.config.ts`). Import with `@/lib/...`, never relative paths that climb directories.
- **Every gateway call goes through `src/lib/api.ts`.** Never hardcode a base URL in a component — `rawFetch` supplies the `API_BASE` prefix, the `Authorization` header, and the global 401 → clear-token → redirect behaviour.
- `sources: null` and `sources: []` both render **nothing**. There is no empty-state UI. `sources: []` is not reachable from the current backend; treat it as a defensive guard only.
- `download_url` is derived per response. **Never cache or persist it.** Read it from the live message object at click time.
- No new npm dependencies.
- Tailwind: reuse existing theme tokens already used in this codebase — `bg-card`, `bg-muted`, `text-muted-foreground`, `text-primary`, `bg-primary/10`, `text-destructive`, `border`.
- Run `npm test` from the repo root: `/home/manoj/newlaptop/projects/react/local-ai-model-frontend`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/api.ts` | Modify | `SourceRef` type, `sources` on `ThreadMessage`/`DoneEvent`, `SourceUnavailableError`, `fetchSourceDocument` |
| `src/lib/api.test.ts` | Modify | Transport tests for `fetchSourceDocument` |
| `src/lib/source-format.ts` | Create | Pure display helpers: `formatPages`, `sourceSecondaryLine` |
| `src/lib/source-format.test.ts` | Create | Helper tests + the 8-fixture eval set |
| `src/hooks/useSessions.ts` | Modify | Carry `sources` onto `UIMessage` from both the `done` event and hydrated threads; clear on retry |
| `src/hooks/useSessions.test.ts` | Modify | State tests for the above |
| `src/components/chat/SourcesPanel.tsx` | Create | Collapsed disclosure + row rendering + bearer-fetch download flow |
| `src/components/chat/MessageBubble.tsx` | Modify | Render `<SourcesPanel>` on assistant turns |

---

### Task 1: API types and transport

**Files:**
- Modify: `src/lib/api.ts`
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: existing `rawFetch`, `errorFromResponse`, `GatewayError` from `src/lib/api.ts`.
- Produces:
  - `export type SourceFileType = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text'`
  - `export interface SourceRef { document_id: string; title: string; department_code: string; file_name: string | null; file_type: SourceFileType; pages: number[]; cited: boolean; download_url: string }`
  - `export class SourceUnavailableError extends GatewayError`
  - `export async function fetchSourceDocument(downloadUrl: string, signal?: AbortSignal): Promise<Response>`
  - `sources?: SourceRef[] | null` on `ThreadMessage` and on `DoneEvent`

- [ ] **Step 1: Write the failing tests**

Add these imports to the existing import block at the top of `src/lib/api.test.ts` (keep the list alphabetical, matching the file's current style):

```ts
import {
  cosineSimilarity,
  createDepartmentTextDocument,
  describeError,
  fetchSourceDocument,
  getMe,
  getIngestJob,
  listDepartmentDocuments,
  listDepartments,
  listFiles,
  login,
  readNdjson,
  register,
  uploadFile,
  uploadDepartmentDocument,
  GatewayError,
  SourceUnavailableError,
} from '@/lib/api'
```

Append this block to the end of `src/lib/api.test.ts`:

```ts
describe('RAG source documents', () => {
  const DOWNLOAD_URL = '/v1/departments/hr/documents/doc-1/download'

  beforeEach(() => {
    clearToken()
    registerUnauthorizedHandler(() => {})
    setToken('tok.src')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('fetches the download_url at the API base with the bearer header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('pdf-bytes', { status: 200 }))
    const res = await fetchSourceDocument(DOWNLOAD_URL)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://localhost:8000/v1/departments/hr/documents/doc-1/download',
    )
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok.src')
    expect(res.ok).toBe(true)
  })

  it('maps 403 (no department access) to SourceUnavailableError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'no access to this department' }, 403),
    )
    await expect(fetchSourceDocument(DOWNLOAD_URL)).rejects.toBeInstanceOf(
      SourceUnavailableError,
    )
  })

  it('maps 404 (unknown, archived, or still ingesting) to SourceUnavailableError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'document not found' }, 404),
    )
    await expect(fetchSourceDocument(DOWNLOAD_URL)).rejects.toBeInstanceOf(
      SourceUnavailableError,
    )
  })

  it('throws a plain GatewayError carrying the detail on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'storage offline' }, 502),
    )
    const err = await fetchSourceDocument(DOWNLOAD_URL).catch((e) => e)
    expect(err).toBeInstanceOf(GatewayError)
    expect(err).not.toBeInstanceOf(SourceUnavailableError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('storage offline')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/api.test.ts`
Expected: FAIL — the module has no export named `fetchSourceDocument` / `SourceUnavailableError`.

- [ ] **Step 3: Add the types**

In `src/lib/api.ts`, add this block immediately **before** the `ThreadMessage` interface (which currently starts at line 71 with its `/** One row in a persisted conversation thread… */` doc comment):

```ts
/** File kinds the RAG ingester recognises for a department document. */
export type SourceFileType = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text'

/**
 * One department document an assistant turn drew on. Already deduplicated per
 * document and page-aggregated server-side — render the array as-is.
 *
 * `cited: true` means the model explicitly pointed at the document; `false`
 * means the answer used it without an explicit marker. `file_name` is null for
 * typed-in documents (fall back to `title`). `pages` is ascending and empty for
 * unpaginated types. `download_url` is derived per response — never persist it.
 */
export interface SourceRef {
  document_id: string
  title: string
  department_code: string
  file_name: string | null
  file_type: SourceFileType
  pages: number[]
  cited: boolean
  download_url: string
}
```

Then add the `sources` field to `ThreadMessage`, immediately after its existing `trace` field:

```ts
  /**
   * Department documents this turn drew on. Null when the turn searched no
   * documents (all general chats, and all user rows). Optional so a gateway
   * build that omits the key stays type-correct rather than asserting null.
   */
  sources?: SourceRef[] | null
```

And add the identical field to `DoneEvent`, immediately after its existing `trace: TraceEntry[]` field:

```ts
  /** Sources for the turn — present on `done` only, never on token/tool events. */
  sources?: SourceRef[] | null
```

- [ ] **Step 4: Add the error type and the transport function**

In `src/lib/api.ts`, add `SourceUnavailableError` immediately after the existing `GatewayError` class definition (before `errorFromResponse`):

```ts
/**
 * A source document the user cannot read: 403 (no department access) or 404
 * (unknown, archived, still ingesting, or otherwise not readable by them).
 * Both collapse to one case so the UI shows a single neutral message rather
 * than a raw status.
 */
export class SourceUnavailableError extends GatewayError {
  constructor(status: number) {
    super(status, 'Source unavailable')
    this.name = 'SourceUnavailableError'
  }
}
```

Then add the fetch function immediately after the existing `fetchFile` function:

```ts
/**
 * Fetch a RAG source document by the `download_url` from a chat response, WITH
 * the bearer header — a plain <a href> can't send it and would 401. Returns the
 * raw Response so the caller can build a blob URL. 401 is handled globally
 * (→ login); 403/404 become SourceUnavailableError; other non-2xx throw a
 * GatewayError carrying the gateway's detail.
 */
export async function fetchSourceDocument(
  downloadUrl: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await rawFetch(downloadUrl, { method: 'GET' }, signal)
  if (res.status === 403 || res.status === 404) {
    throw new SourceUnavailableError(res.status)
  }
  if (!res.ok) throw await errorFromResponse(res)
  return res
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/api.test.ts`
Expected: PASS — all four new tests, plus every pre-existing test in the file.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(api): add SourceRef type and authenticated source download"
```

---

### Task 2: Pure display helpers

**Files:**
- Create: `src/lib/source-format.ts`
- Test: `src/lib/source-format.test.ts`

**Interfaces:**
- Consumes: `SourceRef` from Task 1 (`import type { SourceRef } from '@/lib/api'`).
- Produces:
  - `export function formatPages(pages: number[] | null | undefined): string`
  - `export function sourceSecondaryLine(source: SourceRef): string`

Both are pure and dependency-free apart from the type import, matching how `src/lib/file-format.ts` is structured.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/source-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatPages, sourceSecondaryLine } from '@/lib/source-format'
import type { SourceRef } from '@/lib/api'

/** Build a SourceRef with sensible defaults; override only what a case needs. */
function source(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    document_id: 'doc-1',
    title: 'Leave Policy 2026',
    department_code: 'hr',
    file_name: 'leave-policy.pdf',
    file_type: 'pdf',
    pages: [],
    cited: true,
    download_url: '/v1/departments/hr/documents/doc-1/download',
    ...overrides,
  }
}

describe('formatPages', () => {
  it('returns an empty string for no pages', () => {
    expect(formatPages([])).toBe('')
  })

  it('uses the singular form for one page', () => {
    expect(formatPages([2])).toBe('p. 2')
  })

  it('uses the plural form for several pages', () => {
    expect(formatPages([2, 5])).toBe('pp. 2, 5')
  })

  it('keeps the server ordering for a long run of pages', () => {
    expect(formatPages([1, 2, 3, 4])).toBe('pp. 1, 2, 3, 4')
  })

  it('treats null and undefined as no pages', () => {
    expect(formatPages(null)).toBe('')
    expect(formatPages(undefined)).toBe('')
  })
})

describe('sourceSecondaryLine', () => {
  it('joins the file name and the page label', () => {
    expect(sourceSecondaryLine(source({ file_name: 'leave-policy.pdf', pages: [2, 5] }))).toBe(
      'leave-policy.pdf · pp. 2, 5',
    )
  })

  it('omits the page label when there are no pages', () => {
    expect(sourceSecondaryLine(source({ file_name: 'onboarding.docx', pages: [] }))).toBe(
      'onboarding.docx',
    )
  })

  it('omits the file name for a typed-in document', () => {
    expect(sourceSecondaryLine(source({ file_name: null, pages: [3] }))).toBe('p. 3')
  })

  it('is empty when there is neither a file name nor pages', () => {
    expect(sourceSecondaryLine(source({ file_name: null, pages: [] }))).toBe('')
  })
})

// The labelled eval set from the design doc. Scoring is exact string match on
// the secondary line; see the spec's "Evaluation & Improvement" section.
describe('eval: secondary line across the fixture set', () => {
  const CASES: Array<{ name: string; input: SourceRef; expected: string }> = [
    {
      name: 'cited pdf, multiple pages, named file',
      input: source({ cited: true, file_type: 'pdf', pages: [2, 5], file_name: 'leave-policy.pdf' }),
      expected: 'leave-policy.pdf · pp. 2, 5',
    },
    {
      name: 'uncited pdf, single page, named file',
      input: source({ cited: false, file_type: 'pdf', pages: [2], file_name: 'handbook.pdf' }),
      expected: 'handbook.pdf · p. 2',
    },
    {
      name: 'cited docx, no pages, named file',
      input: source({ cited: true, file_type: 'docx', pages: [], file_name: 'onboarding.docx' }),
      expected: 'onboarding.docx',
    },
    {
      name: 'cited text, no pages, typed-in document',
      input: source({ cited: true, file_type: 'text', pages: [], file_name: null }),
      expected: '',
    },
    {
      name: 'uncited xlsx, no pages, named file',
      input: source({ cited: false, file_type: 'xlsx', pages: [], file_name: 'rates.xlsx' }),
      expected: 'rates.xlsx',
    },
    {
      name: 'cited csv, no pages, named file',
      input: source({ cited: true, file_type: 'csv', pages: [], file_name: 'contacts.csv' }),
      expected: 'contacts.csv',
    },
    {
      name: 'cited pdf, long page run, named file',
      input: source({ cited: true, file_type: 'pdf', pages: [1, 2, 3, 4], file_name: 'manual.pdf' }),
      expected: 'manual.pdf · pp. 1, 2, 3, 4',
    },
    {
      name: 'uncited docx, no pages, typed-in document',
      input: source({ cited: false, file_type: 'docx', pages: [], file_name: null }),
      expected: '',
    },
  ]

  it.each(CASES)('$name', ({ input, expected }) => {
    expect(sourceSecondaryLine(input)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/source-format.test.ts`
Expected: FAIL — cannot resolve `@/lib/source-format`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/source-format.ts`:

```ts
/**
 * Pure presentation helpers for RAG source citations — the page label and the
 * secondary line under a source row. Kept dependency-free and unit tested (the
 * branching is the easy thing to get subtly wrong).
 */
import type { SourceRef } from '@/lib/api'

/** Page label for a source: [] → '', [2] → 'p. 2', [2, 5] → 'pp. 2, 5'. */
export function formatPages(pages: number[] | null | undefined): string {
  if (!pages || pages.length === 0) return ''
  return `${pages.length === 1 ? 'p.' : 'pp.'} ${pages.join(', ')}`
}

/**
 * Secondary line under a source title: the file name and the page label joined
 * by a middle dot, with either side dropped when absent. Returns '' for a
 * typed-in document with no pages — the caller then renders the title alone.
 */
export function sourceSecondaryLine(source: SourceRef): string {
  return [source.file_name ?? '', formatPages(source.pages)].filter(Boolean).join(' · ')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/source-format.test.ts`
Expected: PASS — 9 helper tests plus 8 eval cases.

- [ ] **Step 5: Record the eval pass rate in the spec**

In `docs/superpowers/specs/2026-08-09-rag-source-citations-design.md`, find the line in the "Evaluation & Improvement" section that reads:

```
Scoring is exact string match on the secondary line and page label. Pass rate
is recorded here on first run.
```

Replace the second sentence with the observed result, e.g.:

```
Scoring is exact string match on the secondary line and page label. First run:
8/8 passing (2026-08-09).
```

Use the actual count and today's date from the test output. If any case fails, fix the implementation rather than the expectation — the fixtures encode the spec.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-format.ts src/lib/source-format.test.ts docs/superpowers/specs/2026-08-09-rag-source-citations-design.md
git commit -m "feat(sources): add page and secondary-line formatting helpers"
```

---

### Task 3: Carry `sources` through message state

**Files:**
- Modify: `src/hooks/useSessions.ts`
- Test: `src/hooks/useSessions.test.ts`

**Interfaces:**
- Consumes: `SourceRef` from Task 1.
- Produces: `sources?: SourceRef[] | null` on the exported `UIMessage` interface — this is what Task 4 reads.

- [ ] **Step 1: Write the failing tests**

In `src/hooks/useSessions.test.ts`, first extend the existing `doneStream` helper so a test can attach sources. Replace the current helper (lines 22-38) with:

```ts
function doneStream(opts: { error?: boolean; sources?: unknown } = {}): OpenResult {
  return {
    sessionId: 'sess-1',
    events: (async function* () {
      yield { type: 'token', content: 'hi' }
      yield {
        type: 'done',
        session_id: 'sess-1',
        stop_reason: opts.error ? 'error' : 'completed',
        iteration_count: 1,
        final_answer: 'hi',
        error_message: opts.error ? 'boom' : null,
        trace: [],
        ...(opts.sources === undefined ? {} : { sources: opts.sources }),
      }
    })(),
  } as OpenResult
}
```

Then add `getSession` to the mocked imports on line 15 so the thread-hydration test can drive it:

```ts
import { GatewayError, getSession, openChatStream } from '@/lib/api'
```

And add a mock handle next to the existing `mockOpen` (line 18):

```ts
const mockGetSession = vi.mocked(getSession)
```

Append this new describe block to the end of the file:

```ts
describe('useSessions source citations', () => {
  const SOURCE = {
    document_id: 'doc-1',
    title: 'Leave Policy 2026',
    department_code: 'hr',
    file_name: 'leave-policy.pdf',
    file_type: 'pdf' as const,
    pages: [2, 5],
    cited: true,
    download_url: '/v1/departments/hr/documents/doc-1/download',
  }

  beforeEach(() => {
    mockOpen.mockReset()
    mockGetSession.mockReset()
  })

  it('lands sources from the done event on the assistant message', async () => {
    mockOpen.mockResolvedValue(doneStream({ sources: [SOURCE] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('what is the leave policy?')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')
    expect(assistant?.sources).toEqual([SOURCE])
  })

  it('leaves sources null when the done event omits them', async () => {
    mockOpen.mockResolvedValue(doneStream())
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('general question')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')
    expect(assistant?.sources).toBeNull()
  })

  it('hydrates sources from a persisted thread', async () => {
    mockGetSession.mockResolvedValue({
      id: 'sess-9',
      title: 'Leave',
      created_at: '2026-08-09T00:00:00Z',
      updated_at: '2026-08-09T00:00:00Z',
      messages: [
        {
          id: 'm1',
          seq: 1,
          role: 'user',
          content: 'q',
          trace: null,
          sources: null,
          model: null,
          created_at: '2026-08-09T00:00:00Z',
        },
        {
          id: 'm2',
          seq: 2,
          role: 'assistant',
          content: 'a',
          trace: null,
          sources: [SOURCE],
          model: 'llama',
          created_at: '2026-08-09T00:00:01Z',
        },
      ],
    })
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      await result.current.selectSession('sess-9')
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages[0].sources).toBeNull()
    expect(result.current.messages[1].sources).toEqual([SOURCE])
  })

  it('clears sources when an errored turn is retried', async () => {
    mockOpen.mockResolvedValue(doneStream({ sources: [SOURCE] }))
    const { result } = renderHook(() => useSessions())
    await act(async () => {
      result.current.send('q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    expect(assistant.sources).toEqual([SOURCE])

    // A retry that yields no sources must not leave the previous turn's behind.
    mockOpen.mockResolvedValue(doneStream())
    await act(async () => {
      result.current.retry(assistant.id, 'q')
    })
    await waitFor(() => expect(result.current.sending).toBe(false))
    const retried = result.current.messages.find((m) => m.id === assistant.id)
    expect(retried?.sources).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/hooks/useSessions.test.ts`
Expected: FAIL — `assistant?.sources` is `undefined`, not the expected array/null.

- [ ] **Step 3: Add the field to `UIMessage`**

In `src/hooks/useSessions.ts`, extend the type import from `@/lib/api` (currently lines 2-13) to include `SourceRef`:

```ts
import {
  deleteSession as apiDeleteSession,
  describeError,
  getSession,
  listSessions,
  openChatStream,
  GatewayError,
  type SessionSummary,
  type SourceRef,
  type ThreadMessage,
  type ToolCallStatus,
  type TraceEntry,
} from '@/lib/api'
```

Then add the field to `UIMessage`, immediately after the existing `trace` field:

```ts
  /** Department documents the turn drew on; null when it searched none. */
  sources?: SourceRef[] | null
```

- [ ] **Step 4: Carry it through the three touchpoints**

**4a.** In `threadToUI`, add `sources` to the returned object, after `trace`:

```ts
function threadToUI(m: ThreadMessage): UIMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    status: 'done',
    trace: m.trace,
    sources: m.sources ?? null,
    files: extractFileRefs(m.content, m.trace),
    model: m.model,
  }
}
```

**4b.** In `runTurn`, in the **success** branch of the `done` event (the `else` arm of `if (ev.stop_reason === 'error')`), add `sources` to the returned patch:

```ts
              patch(assistantId, (m) => {
                const finalContent =
                  m.content ||
                  ev.final_answer ||
                  '_The model finished without a text answer._'
                return {
                  status: 'done',
                  content: finalContent,
                  trace,
                  sources: ev.sources ?? null,
                  files: extractFileRefs(finalContent, trace),
                  liveTools: undefined,
                }
              })
```

Leave the error branch alone — a failed turn has no sources to show.

**4c.** In `retry`, add `sources: undefined` to the reset object, next to the existing `trace: undefined`:

```ts
          return {
            ...m,
            status: 'streaming',
            content: '',
            error: undefined,
            retryText: undefined,
            trace: undefined,
            sources: undefined,
            files: undefined,
            liveTools: undefined,
            retryFileIds: undefined,
          }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/hooks/useSessions.test.ts`
Expected: PASS — 4 new tests plus the 5 pre-existing ones.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSessions.ts src/hooks/useSessions.test.ts
git commit -m "feat(sessions): carry source citations onto assistant messages"
```

---

### Task 4: `SourcesPanel` component and wiring

**Files:**
- Create: `src/components/chat/SourcesPanel.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`

**Interfaces:**
- Consumes: `SourceRef`, `fetchSourceDocument`, `SourceUnavailableError`, `describeError` from Task 1; `sourceSecondaryLine` from Task 2; `message.sources` from Task 3.
- Produces: `export function SourcesPanel({ sources }: { sources?: SourceRef[] | null })`.

There is no unit test for this task — the vitest config only collects `src/**/*.test.ts`, and adding `.tsx` collection is out of scope for this plan. Verification is typecheck + lint + build + the manual check in Step 5.

- [ ] **Step 1: Create the component**

Create `src/components/chat/SourcesPanel.tsx`:

```tsx
import { useState } from 'react'
import { ChevronRight, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { describeError, fetchSourceDocument, SourceUnavailableError } from '@/lib/api'
import type { SourceRef } from '@/lib/api'
import { sourceSecondaryLine } from '@/lib/source-format'

type RowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }

/** Keep the blob alive long enough for the new tab's viewer to read it. */
const REVOKE_AFTER_MS = 60_000

/**
 * Fetch a source document with the bearer header and hand the browser a blob
 * URL. The tab is reserved synchronously — a window.open issued after an await
 * is rejected by popup blockers — and pointed at the blob once it resolves.
 * `#page=N` uses the first page only; it affects PDFs in a browser viewer and
 * is harmless for everything else.
 */
async function openSource(source: SourceRef): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const res = await fetchSourceDocument(source.download_url)
    const blobUrl = URL.createObjectURL(await res.blob())
    const page = source.pages?.[0]
    if (win) {
      win.location.href = page ? `${blobUrl}#page=${page}` : blobUrl
    } else {
      // A blocker fired anyway — fall back to a download so the file isn't lost.
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = source.file_name ?? source.title
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), REVOKE_AFTER_MS)
  } catch (e) {
    win?.close()
    throw e
  }
}

function SourceRow({ source }: { source: SourceRef }) {
  const [state, setState] = useState<RowState>({ status: 'idle' })
  const secondary = sourceSecondaryLine(source)

  const handleClick = async () => {
    if (state.status === 'loading') return
    setState({ status: 'loading' })
    try {
      await openSource(source)
      setState({ status: 'idle' })
    } catch (e) {
      // A 401 is already handled globally (token cleared → redirect to login).
      setState({
        status: 'error',
        message:
          e instanceof SourceUnavailableError ? 'Source unavailable' : describeError(e),
      })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state.status === 'loading'}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg',
          source.cited ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {state.status === 'loading' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm group-hover:text-primary',
            source.cited ? 'font-medium' : 'font-normal',
          )}
        >
          {source.title}
        </span>
        {state.status === 'error' ? (
          <span className="block truncate text-xs text-destructive">{state.message}</span>
        ) : secondary ? (
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * Collapsed list of the department documents an answer drew on. Renders
 * nothing when the turn searched no documents — `null`, an absent field, and
 * `[]` are all the same case (the backend only ever sends null for "searched
 * but matched nothing"; the empty array is a defensive guard).
 */
export function SourcesPanel({ sources }: { sources?: SourceRef[] | null }) {
  const [open, setOpen] = useState(false)

  if (!sources || sources.length === 0) return null

  return (
    <div className="rounded-xl border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="text-xs font-semibold text-foreground/70">
          Sources ({sources.length})
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 border-t px-2 py-2">
          {sources.map((source) => (
            <SourceRow key={source.document_id} source={source} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `MessageBubble`**

In `src/components/chat/MessageBubble.tsx`, add the import after the existing `ToolTimeline` import:

```tsx
import { SourcesPanel } from './SourcesPanel'
```

Then render it at the end of the assistant column — after the file-cards block, immediately before the closing `</div>` of the `flex min-w-0 flex-1 flex-col gap-2` wrapper:

```tsx
        {hasFiles && (
          <div className="flex flex-col gap-2">
            {message.files!.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        )}

        <SourcesPanel sources={message.sources} />
      </div>
```

`SourcesPanel` self-guards on empty input, so no conditional is needed at the call site.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc -b && npm run lint`
Expected: both exit 0. If eslint flags the `async` click handler passed to `onClick` (a floating promise), wrap it as `onClick={() => { void handleClick() }}` and leave `handleClick` itself `async`.

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test && npm run build`
Expected: all tests PASS; the build completes without errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, log in, and open a department chat.

1. Ask a question that hits ingested documents. Confirm a collapsed `Sources (N)` row appears under the answer once the turn finishes streaming — **not** during it.
2. Expand it. Confirm cited rows read heavier with a tinted icon, and uncited rows read lighter and muted.
3. Click a PDF row with pages. Confirm a new tab opens showing the document at the first cited page, and that the app's own tab is unaffected.
4. Reload the conversation from the sidebar. Confirm the panel is still there (hydrated from `GET /v1/sessions/{id}`).
5. Ask a question in a **general** (non-department) chat. Confirm no panel renders at all.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/SourcesPanel.tsx src/components/chat/MessageBubble.tsx
git commit -m "feat(chat): show RAG source citations under assistant messages"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-09-rag-source-citations-design.md`:

- **Spec section 1 (types/transport)** → Task 1. **Section 2 (state)** → Task 3. **Section 3 (presentation)** → Task 4. **Section 4 (download flow)** → Task 4 Step 1. **Pure helpers** → Task 2. **Error handling table** → Task 1 (403/404/other) + Task 4 (popup fallback, row-level display). **Testing section** → Tasks 1-3. **Evaluation & Improvement** → Task 2 Steps 1 and 5.
- The spec's testing section lists three test files; all three are `.ts` and land in Tasks 1-3. The component has no test, which is stated explicitly in Task 4 rather than left implicit.
- Names are consistent across tasks: `SourceRef`, `SourceFileType`, `SourceUnavailableError`, `fetchSourceDocument`, `formatPages`, `sourceSecondaryLine`, `SourcesPanel`.
