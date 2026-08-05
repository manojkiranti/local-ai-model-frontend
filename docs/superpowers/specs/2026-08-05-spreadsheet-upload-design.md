# Spreadsheet upload, attach, and read — design

**Date:** 2026-08-05
**Status:** Approved, pre-implementation

## Goal

Let a user upload an Excel/CSV spreadsheet, attach it to a chat message, and have
the model read it and answer. The gateway (base URL, port 8000) does all the
reading server-side; the frontend only uploads, attaches, and displays. Uploaded
files also appear in **My Files**, segmented from generated files.

## Scope decisions

- **One attachment per turn.** Picking a new file replaces the current chip.
  `file_ids` is still sent as an array (`[id]`), so multi-file is a later additive
  change.
- **No re-attach from My Files (this change).** Attaching happens only via the
  composer paperclip. My Files gets source segmentation, download, delete.
- **My Files uses tabs + a per-row source badge** (All / Uploads / Generated),
  driving the `?source=` query param.

## Constraints

- The gateway is the only backend; every request carries `Authorization: Bearer
  <token>` and flows through the existing single client (`src/lib/api.ts`) so
  global 401 handling and base-URL prefixing are preserved.
- Accepted: `.xlsx` and `.csv` only. Max 10 MB (server enforces; client fails
  fast). Do not parse/preview the spreadsheet in the browser.

## Components

### 1. `src/lib/api.ts` — types + endpoints

New types:

```ts
export type FileSource = 'uploaded' | 'generated'
export interface SheetSummary { name: string; rows: number; cols: number; headers: string[] }
export interface UploadSummary { kind: string; total_rows: number; sheets?: SheetSummary[] }
export interface UploadedFile {
  id: string; filename: string; media_type: string; size: number
  source: FileSource; summary: UploadSummary
}
```

- `uploadFile(file: File, signal?): Promise<UploadedFile>` — `POST /v1/files`,
  `FormData` with a single `file` field. Bearer via `rawFetch`; on non-2xx throw
  `GatewayError` (carries `detail`).
- `listFiles(source?: FileSource, signal?)` → `GET /v1/files[?source=…]`.
- `GatewayFile` gains `source: FileSource`.
- `ChatTurnRequest` gains `file_ids?: string[]`.

**Bug fix (required for multipart to work):** `rawFetch` (api.ts ~243) currently
sets `Content-Type: application/json` whenever a body is present and no type was
passed — that would clobber the multipart boundary on a `FormData` body. Guard it:

```ts
if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
  headers.set('Content-Type', 'application/json')
}
```

So `uploadFile` reuses `rawFetch` (bearer + global 401) but the browser sets the
multipart `Content-Type` itself.

### 2. `src/lib/upload-validation.ts` — pure, unit-tested

- `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`, `UPLOAD_ACCEPT = '.xlsx,.csv'`.
- `validateSpreadsheet(file): string | null` — extension check (case-insensitive)
  then size check; returns the user-facing message or `null` if OK.
  - Bad extension → `"Only .xlsx and .csv files are accepted"`.
  - Too big → `"File exceeds the 10 MB limit"`.
- `describeUploadSummary(s: UploadSummary): string` — e.g. `"Excel · 2 sheets ·
  1,270 rows"`, `"CSV · 1,270 rows"` (no sheet count when there are no sheets).
  Uses `toLocaleString()` for the row count.
- `describeUploadError(err: unknown): string` — 413 → `"File exceeds the 10 MB
  limit"`; `GatewayError` → its `detail` verbatim (400 messages like "could not
  read the spreadsheet" / "expands too large" pass through); network/TypeError →
  the gateway-unreachable message. Deliberately NOT `describeError`, which maps
  404 → "model not available on the server" (wrong wording for a file).

### 3. `src/hooks/useAttachment.ts` — one nullable attachment

State machine (single object, nullable):

```
null
  → { status: 'uploading', filename, size }
  → { status: 'ready', file: UploadedFile }
  | { status: 'error', filename, message }
```

API: `{ attachment, pick(file: File), clear() }`.
- `pick` runs `validateSpreadsheet` first (→ immediate `error` state, no round
  trip), else sets `uploading`, calls `uploadFile`, resolves to `ready`/`error`.
- Picking again aborts any in-flight upload and replaces.
- `clear()` aborts in-flight and resets to `null`. Aborts on unmount.

### 4. `Composer` (presentational)

New props: `attachment: Attachment | null`, `onPickFile(file: File)`,
`onClearAttachment()`.
- Paperclip button (left of send) opens a hidden
  `<input type="file" accept=".xlsx,.csv">`. Reset `input.value` after each pick
  so re-picking the same file re-fires `change`.
- Chip row above the textarea:
  - `uploading` → spinner + filename + ✕.
  - `ready` → filename + summary line + ✕.
  - `error` → filename + message (destructive styling) + ✕.
- Send stays enabled on text alone. A chip in `uploading`/`error` state does not
  block sending — it just isn't attached to the turn.

### 5. `ChatPanel`

Owns `useAttachment`. `handleSend` passes a ready attachment down as a compact
descriptor and clears the chip at dispatch:

```ts
onSend(text, toOllamaOptions(genConfig),
  attachment?.status === 'ready'
    ? { id, filename, summaryLine: describeUploadSummary(summary) }
    : undefined)
clear()
```

### 6. `useSessions`

- `UIMessage` gains `attachment?: { filename: string; summaryLine: string }` (for
  the user bubble) and the errored-assistant message gains `retryFileIds?:
  string[]`.
- `send(text, options?, attachment?: AttachmentDescriptor)` — stamps the
  optimistic user bubble with `{ filename, summaryLine }`; passes `file_ids:
  [attachment.id]` to `openChatStream` on this turn only.
- `retry` re-sends `retryFileIds` (stored on the errored assistant message so a
  retry still carries the file).
- 404 with `detail` containing `attached file not found` → error bubble reads
  **"That file is no longer available."** (mapped in `runTurn`'s catch/`done`
  error handling by checking the detail).

### 7. `MessageBubble`

On a user bubble with `message.attachment`, render a small read-only chip
(spreadsheet icon + filename + summary line) under the text.

### 8. My Files (`useFiles` + `FilesPage`)

- `useFiles(source?: FileSource)` — passes `source` to `listFiles`; reloads when
  `source` changes.
- `FilesPage` uses Radix `Tabs` (already a dependency): **All / Uploads /
  Generated**, mapping to `undefined` / `'uploaded'` / `'generated'`.
- Each row gets a source badge (`Uploaded` / `Generated`).
- Per-tab empty-state copy (e.g. Uploads: "No uploads yet. Attach a spreadsheet
  in chat to see it here.").
- Download and delete unchanged (already owner-scoped, bearer via `fetchFile`).

## Data flow

1. Paperclip → pick → `validateSpreadsheet` → `uploadFile` → chip shows summary.
2. Send → `file_ids:[id]` on that one turn → chip clears → user bubble shows the
   attachment chip.
3. Model reads server-side; `inspect_excel`/`read_excel` appear in the existing
   `tool_call`/`tool_result` timeline and persisted trace — no new handling.
4. Follow-ups in the same session send no `file_ids`; the gateway still has the
   file.
5. Uploaded file appears under My Files → Uploads.

## Error handling

| Case | Surface |
| --- | --- |
| Bad extension / too big (client) | Immediate chip `error`, no round trip |
| 400 (corrupt / zip-bomb / expands too large) | Gateway `detail` verbatim in chip |
| 413 | "File exceeds the 10 MB limit" |
| 401 | Global handler clears token → login |
| 404 `attached file not found` on send | Error bubble: "That file is no longer available." |

## Testing

- `upload-validation.test.ts` — `validateSpreadsheet` (good/bad ext, boundary at
  exactly 10 MB, over), `describeUploadSummary` (Excel multi-sheet, CSV no sheets,
  thousands separator), `describeUploadError` (413, GatewayError detail,
  TypeError).
- `api.test.ts` — extend: `uploadFile` posts `FormData` and does **not** set
  `Content-Type` (assert the header is absent so the boundary survives);
  `listFiles('uploaded')` hits `?source=uploaded`.

## Known limitation (documented, not worked around)

`ThreadMessage` (api.ts) has no attachment field, so the user-bubble attachment
chip is **session-local**: reload or reselect the session and the chip is gone
from history. The model still has the file server-side; only the visual marker is
missing on reloaded history. Surfacing it in reloaded threads requires a gateway
change to include the attachment on thread messages — out of scope here.

## Evaluation & Improvement

1. **Success metric.** Attach-to-answer completion rate: of turns where a user
   attaches a spreadsheet, the share that reach a `done` (non-error) assistant
   turn whose trace shows an `inspect_excel`/`read_excel` call. Proxy for "the
   upload+attach path actually let the model use the file."
2. **Eval.** A labelled set of 8 upload inputs scored by `validateSpreadsheet` /
   `describeUploadError` output: valid `.xlsx`, valid `.csv`, uppercase `.XLSX`,
   `.xls` (reject), `.pdf` (reject), 10 MB exactly (accept), 10 MB + 1 byte
   (reject), and a simulated 413 and 400-corrupt response. Scored by exact match
   of the returned message against the expected string. Target: 8/8. Current:
   `upload-validation.test.ts` passes 14/14 as of 2026-08-05 (7 `validateSpreadsheet`
   incl. the exact-10 MB / 10 MB+1 boundary, 4 `describeUploadSummary`, 3
   `describeUploadError` incl. 413 and 400-detail) — every labelled eval case
   covered. Full suite 67/67 green; `npm run build` and `npm run lint` clean.
3. **Feedback capture.** The chip's `error` state is the in-product correction
   signal (user sees exactly why an upload failed and can retry). No server
   logging added client-side; failures already surface through the gateway.
4. **Review loop.** Re-check the eval set whenever the accepted extensions or the
   size cap change, and whenever the gateway alters `POST /v1/files` error
   `detail` strings (the messages are surfaced verbatim). Default cadence:
   revisit on the next spreadsheet-related gateway change.
