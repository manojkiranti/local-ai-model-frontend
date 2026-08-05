# Spreadsheet Upload / Attach / Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload an Excel/CSV spreadsheet, attach it to one chat turn, and have the gateway read it server-side and answer — plus segment uploads from generated files in My Files.

**Architecture:** Extend the single typed gateway client (`src/lib/api.ts`) with an upload endpoint and `file_ids`; add pure validation/formatting helpers; add a small `useAttachment` hook that owns upload state; thread a ready attachment through `ChatPanel → useSessions.send → openChatStream` for exactly one turn. My Files gains source tabs. Tools run server-side, so the trace/timeline UI is untouched.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library, Tailwind v4, Radix UI, lucide-react.

## Global Constraints

- Gateway is the ONLY backend; every request carries `Authorization: Bearer <token>` and goes through `rawFetch`/`request` in `src/lib/api.ts` (base-URL prefix + global 401 handling).
- Accepted extensions: `.xlsx` and `.csv` only. Max size: `10 * 1024 * 1024` bytes (10 MB).
- Do NOT parse/preview the spreadsheet in the browser — upload and display the server's summary only.
- On a `FormData` body, NEVER set `Content-Type` manually (the browser must set the multipart boundary).
- Base URL comes from `@/lib/config` (`API_BASE`) — never hardcode `http://localhost:8000` in components/hooks.
- Run tests with `npm test` (`vitest run`). Type-check/build with `npm run build`.
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `src/lib/api.ts` (modify) — new file types, `uploadFile`, `listFiles(source?)`, `source` on `GatewayFile`, `file_ids` on `ChatTurnRequest`, `rawFetch` FormData guard.
- `src/lib/upload-validation.ts` (create) — pure constants + `validateSpreadsheet`, `describeUploadSummary`, `describeUploadError`.
- `src/lib/upload-validation.test.ts` (create) — unit tests for the above.
- `src/lib/api.test.ts` (modify) — `uploadFile` FormData + `listFiles` source tests.
- `src/hooks/useAttachment.ts` (create) — nullable attachment state machine.
- `src/components/chat/Composer.tsx` (modify) — paperclip + chip row (presentational).
- `src/components/chat/ChatPanel.tsx` (modify) — owns `useAttachment`, passes descriptor to `onSend`.
- `src/hooks/useSessions.ts` (modify) — `send`/`retry` carry `file_ids`; user-bubble attachment; 404 mapping.
- `src/components/chat/MessageBubble.tsx` (modify) — read-only attachment chip on user bubbles.
- `src/hooks/useFiles.ts` (modify) — `source` param.
- `src/components/files/FilesPage.tsx` (modify) — tabs + per-row source badge.

---

### Task 1: API client — upload endpoint, source filter, `file_ids`, FormData guard

**Files:**
- Modify: `src/lib/api.ts`
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: existing `rawFetch`, `request`, `errorFromResponse`, `GatewayError`, `ChatTurnRequest`, `GatewayFile`.
- Produces:
  - `type FileSource = 'uploaded' | 'generated'`
  - `interface SheetSummary { name: string; rows: number; cols: number; headers: string[] }`
  - `interface UploadSummary { kind: string; total_rows: number; sheets?: SheetSummary[] }`
  - `interface UploadedFile { id: string; filename: string; media_type: string; size: number; source: FileSource; summary: UploadSummary }`
  - `uploadFile(file: File, signal?: AbortSignal): Promise<UploadedFile>` — `POST /v1/files`
  - `listFiles(source?: FileSource, signal?: AbortSignal): Promise<GatewayFile[]>` (signature change: `source` is new first arg)
  - `GatewayFile` gains `source: FileSource`
  - `ChatTurnRequest` gains `file_ids?: string[]`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/api.test.ts` — import `uploadFile` and `listFiles` in the top import block, then add this describe block:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/api.test.ts`
Expected: FAIL — `uploadFile is not a function` / `listFiles` arity mismatch.

- [ ] **Step 3: Implement in `src/lib/api.ts`**

Fix the `rawFetch` content-type guard (currently at ~line 243):

```ts
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
```

Add `file_ids` to `ChatTurnRequest`:

```ts
export interface ChatTurnRequest {
  session_id?: string
  message: string
  model?: string
  options?: Record<string, unknown>
  file_ids?: string[]
}
```

Add the new types near the other file types (by `GatewayFile`), and add `source` to `GatewayFile`:

```ts
export type FileSource = 'uploaded' | 'generated'

export interface SheetSummary {
  name: string
  rows: number
  cols: number
  headers: string[]
}

export interface UploadSummary {
  kind: string
  total_rows: number
  sheets?: SheetSummary[]
}

export interface UploadedFile {
  id: string
  filename: string
  media_type: string
  size: number
  source: FileSource
  summary: UploadSummary
}

export interface GatewayFile {
  id: string
  filename: string
  media_type: string
  size: number
  source: FileSource
  created_at: string
}

/**
 * Upload a spreadsheet (`POST /v1/files`, multipart). The browser sets the
 * multipart Content-Type/boundary — do NOT set it manually. Bearer + global 401
 * come from `rawFetch`; non-2xx throws a GatewayError carrying the detail.
 */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await rawFetch('/v1/files', { method: 'POST', body: form }, signal)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<UploadedFile>
}
```

Replace `listFiles` to take an optional `source`:

```ts
export async function listFiles(
  source?: FileSource,
  signal?: AbortSignal,
): Promise<GatewayFile[]> {
  const path = source ? `/v1/files?source=${source}` : '/v1/files'
  const data = await request<{ files: GatewayFile[] }>(path, { method: 'GET' }, signal)
  return data.files
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/api.test.ts`
Expected: PASS (all file-endpoint tests green; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(api): uploadFile, source filter, file_ids, FormData guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Upload validation + formatting helpers

**Files:**
- Create: `src/lib/upload-validation.ts`
- Test: `src/lib/upload-validation.test.ts`

**Interfaces:**
- Consumes: `GatewayError` from `@/lib/api`; `UploadSummary` type from `@/lib/api`.
- Produces:
  - `const MAX_UPLOAD_BYTES = 10 * 1024 * 1024`
  - `const UPLOAD_ACCEPT = '.xlsx,.csv'`
  - `validateSpreadsheet(file: File): string | null`
  - `describeUploadSummary(s: UploadSummary): string`
  - `describeUploadError(err: unknown): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/upload-validation.test.ts`:

```ts
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
  return new File([blob], name)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/upload-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/upload-validation.ts`**

```ts
/**
 * Pure helpers for the spreadsheet-upload path — client-side validation (fail
 * fast before the round trip), a one-line summary for the attachment chip, and
 * upload-specific error copy. Dependency-free and unit tested.
 */
import { GatewayError, type UploadSummary } from '@/lib/api'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UPLOAD_ACCEPT = '.xlsx,.csv'

const ALLOWED_EXT = ['.xlsx', '.csv']

/** Return a user-facing rejection message, or null if the file is acceptable. */
export function validateSpreadsheet(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    return 'Only .xlsx and .csv files are accepted'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File exceeds the 10 MB limit'
  }
  return null
}

/** One-line chip summary, e.g. "Excel · 2 sheets · 1,270 rows" / "CSV · 5 rows". */
export function describeUploadSummary(s: UploadSummary): string {
  const parts = [s.kind]
  const sheetCount = s.sheets?.length ?? 0
  if (sheetCount > 0) {
    parts.push(`${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`)
  }
  const rows = s.total_rows
  parts.push(`${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'}`)
  return parts.join(' · ')
}

/** Upload-specific error copy. NOT describeError (which mislabels 404). */
export function describeUploadError(err: unknown): string {
  if (err instanceof GatewayError) {
    if (err.status === 413) return 'File exceeds the 10 MB limit'
    return err.message
  }
  if (err instanceof TypeError) {
    return 'Cannot reach the gateway. Is it running on port 8000?'
  }
  return err instanceof Error ? err.message : String(err)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/upload-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-validation.ts src/lib/upload-validation.test.ts
git commit -m "feat(upload): validation + summary/error formatting helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `useAttachment` hook

**Files:**
- Create: `src/hooks/useAttachment.ts`

**Interfaces:**
- Consumes: `uploadFile`, `UploadedFile` from `@/lib/api`; `validateSpreadsheet`, `describeUploadError` from `@/lib/upload-validation`.
- Produces:
  - `type Attachment = { status: 'uploading'; filename: string; size: number } | { status: 'ready'; file: UploadedFile } | { status: 'error'; filename: string; message: string }`
  - `useAttachment(): { attachment: Attachment | null; pick(file: File): void; clear(): void }`

> No dedicated test — this is thin glue over `uploadFile` (tested) and `validateSpreadsheet` (tested). Coverage comes from those plus the manual verification in Task 9.

- [ ] **Step 1: Implement `src/hooks/useAttachment.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile, type UploadedFile } from '@/lib/api'
import { describeUploadError, validateSpreadsheet } from '@/lib/upload-validation'

export type Attachment =
  | { status: 'uploading'; filename: string; size: number }
  | { status: 'ready'; file: UploadedFile }
  | { status: 'error'; filename: string; message: string }

/**
 * Owns a single, replaceable spreadsheet attachment for the composer. Validates
 * client-side first (no wasted round trip), uploads, and tracks the result.
 * Picking again or clearing aborts any in-flight upload; also aborts on unmount.
 */
export function useAttachment() {
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const pick = useCallback(
    (file: File) => {
      abortInFlight()
      const rejection = validateSpreadsheet(file)
      if (rejection) {
        setAttachment({ status: 'error', filename: file.name, message: rejection })
        return
      }
      const controller = new AbortController()
      controllerRef.current = controller
      setAttachment({ status: 'uploading', filename: file.name, size: file.size })
      void (async () => {
        try {
          const uploaded = await uploadFile(file, controller.signal)
          if (controllerRef.current === controller) {
            setAttachment({ status: 'ready', file: uploaded })
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          if (controllerRef.current === controller) {
            setAttachment({ status: 'error', filename: file.name, message: describeUploadError(e) })
          }
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      })()
    },
    [abortInFlight],
  )

  const clear = useCallback(() => {
    abortInFlight()
    setAttachment(null)
  }, [abortInFlight])

  useEffect(() => () => abortInFlight(), [abortInFlight])

  return { attachment, pick, clear }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS (compiles; unused-symbol errors here would mean a typo).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAttachment.ts
git commit -m "feat(chat): useAttachment hook for composer upload state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Composer — paperclip + attachment chip (presentational)

**Files:**
- Modify: `src/components/chat/Composer.tsx`

**Interfaces:**
- Consumes: `Attachment` type from `@/hooks/useAttachment`; `UPLOAD_ACCEPT`, `describeUploadSummary` from `@/lib/upload-validation` / `@/lib/api`.
- Produces: `ComposerProps` gains `attachment: Attachment | null`, `onPickFile(file: File): void`, `onClearAttachment(): void`.

> No dedicated test — presentational. Verified in Task 9.

- [ ] **Step 1: Implement the changes**

Update the imports at the top of `src/components/chat/Composer.tsx`:

```ts
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileSpreadsheet, Loader2, Paperclip, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Attachment } from '@/hooks/useAttachment'
import { UPLOAD_ACCEPT } from '@/lib/upload-validation'
import { describeUploadSummary } from '@/lib/upload-validation'
```

Extend the props interface and signature:

```ts
interface ComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  placeholder?: string
  attachment: Attachment | null
  onPickFile: (file: File) => void
  onClearAttachment: () => void
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  attachment,
  onPickFile,
  onClearAttachment,
}: ComposerProps) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
```

Inside the outer `max-w-[760px]` wrapper, ABOVE the input row `<div className="flex items-end …">`, add the chip and a hidden file input:

```tsx
        <input
          ref={fileRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPickFile(file)
            e.target.value = '' // allow re-picking the same file
          }}
        />

        {attachment && (
          <div
            className={cn(
              'mb-2 flex w-fit max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm',
              attachment.status === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {attachment.status === 'uploading' ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <div className="truncate font-medium">{attachment.filename}</div>
              <div className="truncate text-xs text-muted-foreground">
                {attachment.status === 'uploading'
                  ? 'Uploading…'
                  : attachment.status === 'ready'
                    ? describeUploadSummary(attachment.file.summary)
                    : attachment.message}
              </div>
            </div>
            <button
              type="button"
              onClick={onClearAttachment}
              aria-label="Remove attachment"
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
```

Add a paperclip button inside the input row, immediately after the opening `<div className="flex items-end …">` and before the `<textarea>`:

```tsx
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label="Attach a spreadsheet"
            title="Attach a spreadsheet (.xlsx, .csv)"
            className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip className="size-[18px]" />
          </button>
```

(The existing `submit`, `onSend`, textarea, and send/stop buttons are unchanged. Send remains gated only on `text.trim()` — the attachment never blocks or forces a send.)

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: FAIL — `ChatPanel` doesn't pass the new required props yet. That's expected; Task 5 fixes it. Confirm the ONLY errors are the three missing props at the `<Composer …>` usage in `ChatPanel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat(chat): paperclip + attachment chip in composer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: ChatPanel owns `useAttachment`, threads descriptor to `onSend`

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`

**Interfaces:**
- Consumes: `useAttachment` from `@/hooks/useAttachment`; `describeUploadSummary` from `@/lib/upload-validation`.
- Produces: `ChatPanelProps.onSend` signature becomes `(text: string, options?: Record<string, unknown>, attachment?: AttachmentDescriptor) => void` where `AttachmentDescriptor = { id: string; filename: string; summaryLine: string }`. Task 6 defines `AttachmentDescriptor` in `useSessions`; import it from there.

- [ ] **Step 1: Implement the changes**

Update imports:

```ts
import { AlertTriangle, Loader2, Wrench } from 'lucide-react'
import { toOllamaOptions, type GenerationConfig } from '@/lib/chat-config'
import type { AttachmentDescriptor, UIMessage } from '@/hooks/useSessions'
import { useAttachment } from '@/hooks/useAttachment'
import { describeUploadSummary } from '@/lib/upload-validation'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { GenerationSettings } from './GenerationSettings'
```

Change the `onSend` prop type in `ChatPanelProps`:

```ts
  onSend: (
    text: string,
    options?: Record<string, unknown>,
    attachment?: AttachmentDescriptor,
  ) => void
```

Inside the component, add the hook and rewrite `handleSend`:

```ts
  const { attachment, pick, clear } = useAttachment()

  const handleSend = (text: string) => {
    const descriptor =
      attachment?.status === 'ready'
        ? {
            id: attachment.file.id,
            filename: attachment.file.filename,
            summaryLine: describeUploadSummary(attachment.file.summary),
          }
        : undefined
    onSend(text, toOllamaOptions(genConfig), descriptor)
    clear()
  }
```

Pass the new props to `<Composer>`:

```tsx
      <Composer
        onSend={handleSend}
        onStop={onStop}
        streaming={sending}
        disabled={!reachable}
        placeholder="Send a message — the model uses tools when useful…"
        attachment={attachment}
        onPickFile={pick}
        onClearAttachment={clear}
      />
```

(`handleRetry` is unchanged.)

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: FAIL — `AttachmentDescriptor` not yet exported from `useSessions`, and `Workspace`'s `chat.send` doesn't accept a 3rd arg. Both fixed in Task 6. Confirm the errors are only about `AttachmentDescriptor`/`send` arity.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "feat(chat): ChatPanel owns attachment, passes descriptor on send

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `useSessions` — carry `file_ids`, user-bubble attachment, 404 mapping

**Files:**
- Modify: `src/hooks/useSessions.ts`

**Interfaces:**
- Consumes: `openChatStream` (now accepts `file_ids` via `ChatTurnRequest`), `GatewayError`.
- Produces:
  - `interface AttachmentDescriptor { id: string; filename: string; summaryLine: string }` (exported)
  - `UIMessage` gains `attachment?: { filename: string; summaryLine: string }` and `retryFileIds?: string[]`
  - `send(text: string, options?: Record<string, unknown>, attachment?: AttachmentDescriptor): void`
  - `retry` unchanged in signature (re-sends stored `retryFileIds`)

- [ ] **Step 1: Add the type and `UIMessage` fields**

Near the top of `src/hooks/useSessions.ts`, add:

```ts
export interface AttachmentDescriptor {
  id: string
  filename: string
  summaryLine: string
}
```

Extend `UIMessage`:

```ts
  /** Present on a failed assistant turn — the user text to re-send on Retry. */
  retryText?: string
  /** file_ids to re-send on Retry (mirrors the original turn's attachment). */
  retryFileIds?: string[]
  /** Present on a user bubble that carried an uploaded spreadsheet. */
  attachment?: { filename: string; summaryLine: string }
```

- [ ] **Step 2: Thread `file_ids` through `runTurn`**

Change `runTurn`'s signature and its `openChatStream` call to accept and send `fileIds`:

```ts
  const runTurn = useCallback(
    async (
      assistantId: string,
      text: string,
      options?: Record<string, unknown>,
      fileIds?: string[],
    ) => {
      const sessionForTurn = activeIdRef.current ?? undefined
      const controller = new AbortController()
      controllerRef.current = controller
      setSending(true)
      // ... adopt() unchanged ...
      try {
        const { sessionId, events } = await openChatStream(
          {
            session_id: sessionForTurn,
            message: text,
            options,
            ...(fileIds && fileIds.length ? { file_ids: fileIds } : {}),
          },
          controller.signal,
        )
```

- [ ] **Step 3: Map the "attached file not found" 404**

In `runTurn`, in the `catch (e)` block's non-abort branch, compute the error message so a missing-file 404 gets friendly copy. Replace the `describeError(e)` call in that branch with:

```ts
        } else {
          const message =
            e instanceof GatewayError &&
            e.status === 404 &&
            e.message.toLowerCase().includes('attached file not found')
              ? 'That file is no longer available.'
              : describeError(e)
          patch(assistantId, () => ({
            status: 'error',
            error: message,
            retryText: text,
            retryFileIds: fileIds,
            liveTools: undefined,
          }))
          refreshSessions().catch(() => {})
        }
```

Also add `retryFileIds: fileIds` to the `done`-event `stop_reason === 'error'` patch (so a model-reported error still retries with the file):

```ts
            if (ev.stop_reason === 'error') {
              patch(assistantId, () => ({
                status: 'error',
                error: ev.error_message ?? 'The model reported an error.',
                retryText: text,
                retryFileIds: fileIds,
                liveTools: undefined,
                trace,
              }))
```

- [ ] **Step 4: Update `send` and `retry`**

```ts
  const send = useCallback(
    (text: string, options?: Record<string, unknown>, attachment?: AttachmentDescriptor) => {
      const assistantId = uid()
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'user',
          content: text,
          status: 'done',
          ...(attachment
            ? { attachment: { filename: attachment.filename, summaryLine: attachment.summaryLine } }
            : {}),
        },
        { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
      ])
      void runTurn(assistantId, text, options, attachment ? [attachment.id] : undefined)
    },
    [runTurn],
  )

  const retry = useCallback(
    (assistantId: string, text: string, options?: Record<string, unknown>) => {
      let fileIds: string[] | undefined
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m
          fileIds = m.retryFileIds
          return {
            ...m,
            status: 'streaming',
            content: '',
            error: undefined,
            retryText: undefined,
            trace: undefined,
            files: undefined,
            liveTools: undefined,
          }
        }),
      )
      void runTurn(assistantId, text, options, fileIds)
    },
    [runTurn],
  )
```

(This replaces the old `patch(...)`-based `retry`; reading `retryFileIds` inside the updater keeps it in one pass. `patch` is still used elsewhere in `runTurn`, so leave it defined.)

- [ ] **Step 5: Type-check + run tests**

Run: `npm run build && npm test`
Expected: PASS. `ChatPanel` and `Composer` now type-check (Tasks 4–5 resolved), and `Workspace`'s `chat.send`/`chat.retry` wiring is compatible (extra optional arg).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSessions.ts
git commit -m "feat(chat): carry file_ids on send/retry, map missing-file 404

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: MessageBubble — read-only attachment chip on user bubbles

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`

**Interfaces:**
- Consumes: `UIMessage.attachment` from `@/hooks/useSessions`.
- Produces: nothing new (visual only).

> No dedicated test — presentational. Verified in Task 9.

- [ ] **Step 1: Implement the change**

Add `FileSpreadsheet` to the lucide import:

```ts
import { AlertTriangle, FileSpreadsheet, RotateCw } from 'lucide-react'
```

Replace the user-bubble branch so it renders the chip under the text when present:

```tsx
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[74%] flex-col items-end gap-1.5">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-secondary px-4 py-3 text-[15px] leading-relaxed">
            {message.content}
          </div>
          {message.attachment && (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-xs">
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate font-medium">{message.attachment.filename}</span>
              <span className="shrink-0 text-muted-foreground">{message.attachment.summaryLine}</span>
            </div>
          )}
        </div>
      </div>
    )
  }
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageBubble.tsx
git commit -m "feat(chat): show attachment chip on user message bubbles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: My Files — source tabs + per-row badge

**Files:**
- Modify: `src/hooks/useFiles.ts`
- Modify: `src/components/files/FilesPage.tsx`

**Interfaces:**
- Consumes: `listFiles(source?)`, `FileSource`, `GatewayFile` from `@/lib/api`; `Tabs`/`TabsList`/`TabsTrigger` from `@/components/ui/tabs`.
- Produces: `useFiles(source?: FileSource)`.

> No dedicated test — thin data + presentational; `listFiles` source behavior is covered by Task 1. Verified in Task 9.

- [ ] **Step 1: Update `src/hooks/useFiles.ts`**

Take an optional `source`, pass it through, and reload when it changes:

```ts
import { useCallback, useEffect, useState } from 'react'
import { describeError, listFiles, type FileSource, type GatewayFile } from '@/lib/api'

export function useFiles(source?: FileSource) {
  const [files, setFiles] = useState<GatewayFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFiles(await listFiles(source))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => (prev ? prev.filter((f) => f.id !== id) : prev))
  }, [])

  return { files, loading, error, reload: load, removeFile }
}
```

- [ ] **Step 2: Add tabs + badge to `src/components/files/FilesPage.tsx`**

Add a `source` state and drive `useFiles`. Update imports:

```ts
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FileSource } from '@/lib/api'
```

Inside the component, replace `const { files, loading, error, reload, removeFile } = useFiles()` with:

```ts
  const [source, setSource] = useState<FileSource | undefined>(undefined)
  const { files, loading, error, reload, removeFile } = useFiles(source)
```

Add the tabs directly under the `<header>` block (before the `notice`):

```tsx
      <Tabs
        value={source ?? 'all'}
        onValueChange={(v) => setSource(v === 'all' ? undefined : (v as FileSource))}
        className="mb-3"
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="uploaded">Uploads</TabsTrigger>
          <TabsTrigger value="generated">Generated</TabsTrigger>
        </TabsList>
      </Tabs>
```

Add a source badge next to the kind badge in each row (after the existing `<Badge variant="outline">{kind}</Badge>`):

```tsx
                      <Badge variant="outline" className="shrink-0">
                        {kind}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="shrink-0 capitalize text-muted-foreground"
                      >
                        {file.source === 'uploaded' ? 'Uploaded' : 'Generated'}
                      </Badge>
```

Update the empty-state copy to reflect the active tab (replace the `<p>` lines in the empty branch):

```tsx
            <p>{source === 'uploaded' ? 'No uploads yet.' : source === 'generated' ? 'No generated files yet.' : 'No files yet.'}</p>
            <p className="text-xs">
              {source === 'uploaded'
                ? 'Attach a spreadsheet in chat to see it here.'
                : 'Files generated by tools in chat will show up here.'}
            </p>
```

Ensure `useState` is imported (the file already imports from `'react'`; add `useState` if the import is only `useEffect`).

- [ ] **Step 3: Type-check + run tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFiles.ts src/components/files/FilesPage.tsx
git commit -m "feat(files): source tabs + per-row source badge in My Files

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite + build**

Run: `npm test && npm run build && npm run lint`
Expected: all PASS, no lint errors.

- [ ] **Step 2: Record the eval result in the spec**

Open `docs/superpowers/specs/2026-08-05-spreadsheet-upload-design.md`, in the "Evaluation & Improvement" section, update item 2's "Current:" line to the observed `upload-validation.test.ts` pass count (e.g. "Current: 8/8 as of 2026-08-05"). Commit:

```bash
git add docs/superpowers/specs/2026-08-05-spreadsheet-upload-design.md
git commit -m "docs: record upload-validation eval pass rate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Manual smoke test (requires the gateway running on :8000)**

Verify each, noting any failures:
1. Paperclip → pick a `.xlsx` → chip shows spinner then `Excel · N sheets · N rows`.
2. Pick a `.pdf` → chip shows error "Only .xlsx and .csv files are accepted", no round trip.
3. Type a question + send → chip clears; user bubble shows the attachment chip; assistant answers and the tool timeline shows `inspect_excel`/`read_excel`.
4. Ask a follow-up (no re-pick) → still answered from the file (no `file_ids` sent — confirm in network tab).
5. My Files → Uploads tab shows the uploaded file with an "Uploaded" badge; Generated tab excludes it.
6. Delete the upload from My Files → row disappears.

---

## Self-Review

**Spec coverage:**
- api types + `uploadFile` + `listFiles(source)` + `file_ids` + FormData guard → Task 1. ✓
- `upload-validation.ts` (validate/summary/error) → Task 2. ✓
- `useAttachment` state machine → Task 3. ✓
- Composer paperclip + chip + accept + input reset → Task 4. ✓
- ChatPanel owns hook, descriptor to `onSend`, clear on dispatch → Task 5. ✓
- `useSessions` `file_ids` one-turn, user-bubble attachment, retry carries file, 404 mapping → Task 6. ✓
- MessageBubble user-bubble chip → Task 7. ✓
- My Files tabs + badge + `useFiles(source)` + empty copy → Task 8. ✓
- Testing (upload-validation, api) → Tasks 1–2; full pass → Task 9. ✓
- Eval result recorded → Task 9 Step 2. ✓
- Known limitation (session-local chip) → documented in spec, not worked around; nothing to implement. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. ✓

**Type consistency:** `AttachmentDescriptor` defined in Task 6, imported by Task 5; `Attachment` defined in Task 3, consumed by Task 4; `FileSource`/`UploadedFile`/`UploadSummary`/`GatewayFile.source` defined in Task 1, consumed by Tasks 2/3/8. `listFiles(source?)` signature consistent across Tasks 1 and 8. `send(text, options?, attachment?)` consistent across Tasks 5–6. ✓

**Note on task interdependence:** Tasks 4 and 5 intentionally leave the build red (documented in their type-check steps); Task 6 closes it. A reviewer should treat Tasks 4–6 as a unit for a green build, but each is an independently reviewable diff.
