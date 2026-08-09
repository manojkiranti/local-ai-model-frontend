# RAG Source Citations — Design

Date: 2026-08-09

## Problem

The gateway now returns structured source citations for department (RAG) chats
and exposes an authenticated per-document download endpoint. The frontend
consumes the responses that carry them but ignores the new field, so a
department answer gives no indication of which documents it drew on.

All backend changes are additive — no existing field was renamed or removed —
so this is purely new UI over data already arriving on the wire.

## Where `sources` appears

The field shows up in three places the app already consumes:

1. `POST /v1/chat` (non-stream) — top-level `sources`
2. `POST /v1/chat` (stream, NDJSON) — on the **`done`** event only, never on
   `token` / `tool_call` / `tool_result`
3. `GET /v1/sessions/{id}` — on each **assistant** message

Shape:

```json
"sources": [
  {
    "document_id": "9f3c1a...",
    "title": "Leave Policy 2026",
    "department_code": "hr",
    "file_name": "leave-policy.pdf",
    "file_type": "pdf",
    "pages": [2, 5],
    "cited": true,
    "download_url": "/v1/departments/hr/documents/9f3c1a.../download"
  }
]
```

### Semantics

- `sources: null` → the turn searched no documents. Render nothing. General
  (non-department) chats are always `null`.
- **`sources: []` is not reachable.** A turn that searched but matched nothing
  returns `null` — the retrieval tool returns before recording, and the empty
  case is already communicated in the assistant's own message text. Treat `[]`
  identically to `null` (render nothing) as a defensive guard; do **not** build
  a distinct empty-state UI.
- `cited: true` → the model explicitly pointed at the document; style it more
  prominently. `cited: false` → the answer drew on it without an explicit
  marker.
- The array is already deduplicated per document and page-aggregated
  server-side. Render it as-is; no client-side grouping.
- `file_name` is `null` for typed-in documents. Fall back to `title`.
- User messages always have `sources: null`.

## Architecture

Four units, each independently understandable and testable.

### 1. Types and transport — `src/lib/api.ts`

The single typed gateway client gains the `SourceRef` type:

```ts
export interface SourceRef {
  document_id: string
  title: string
  department_code: string
  file_name: string | null
  file_type: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text'
  pages: number[]
  cited: boolean
  download_url: string
}
```

`ThreadMessage` and `DoneEvent` each gain `sources?: SourceRef[] | null`. The
property is optional so a gateway build that omits the key is type-correct
rather than asserting `null`.

One new transport function, sitting alongside `fetchFile`:

```ts
/**
 * Fetch a RAG source document by the `download_url` from a chat response, WITH
 * the bearer header. Returns the raw Response so the caller can build a blob.
 */
export async function fetchSourceDocument(
  downloadUrl: string,
  signal?: AbortSignal,
): Promise<Response>
```

It routes through the existing `rawFetch`, which supplies the `API_BASE`
prefix, the `Authorization` header, and the global 401 → clear-token → redirect
behaviour. `download_url` arrives as a root-relative path, which is exactly
what `rawFetch` expects.

A new error type distinguishes the "not yours / not there" case from real
failures:

```ts
export class SourceUnavailableError extends GatewayError {}
```

`fetchSourceDocument` maps both **403** (no department access) and **404**
(unknown, archived, still ingesting, or not readable) to
`SourceUnavailableError`. The UI renders one neutral message for it and never
surfaces a raw status code. Any other non-2xx throws a plain `GatewayError`.

### 2. State — `src/hooks/useSessions.ts`

`UIMessage` gains `sources?: SourceRef[] | null`. Three touchpoints:

- `threadToUI` — carry `m.sources ?? null` through when hydrating a thread from
  `GET /v1/sessions/{id}`.
- The `done` branch of `runTurn` — set `sources: ev.sources ?? null` on the
  success path. The `token`, `tool_call`, and `tool_result` branches are
  untouched; the error path leaves `sources` unset.
- `retry()` — clear `sources: undefined` alongside `trace` and `files`, so a
  retried turn never displays the failed turn's citations.

No other state logic changes.

### 3. Presentation — `src/components/chat/SourcesPanel.tsx`

A single presentational component, `<SourcesPanel sources={…} />`, rendered
inside `MessageBubble` after `TracePanel` and the file cards. It returns `null`
when `sources` is absent, `null`, or empty — one guard covers all three.

Otherwise it renders a collapsed disclosure whose markup mirrors `TracePanel`,
so the two read as the same family of affordance:

```
› Sources (3)
    [icon] Leave Policy 2026            ← cited: medium weight, primary-tinted icon
           leave-policy.pdf · pp. 2, 5
    [icon] Onboarding Handbook          ← uncited: normal weight, muted icon
           handbook.docx
```

Details:

- The header count is the total number of sources, cited and uncited alike.
- Rows are `<button>` elements, not anchors. An anchor would imply a
  navigable `href`, and `download_url` is not navigable without a header.
- The primary line is `title`. The secondary line is `file_name` plus the page
  label; when `file_name` is `null` (typed-in document) the filename segment is
  omitted, and when `pages` is empty the page segment is omitted. A row whose
  secondary line would be empty renders the title alone.
- `cited: true` rows use a primary-tinted icon and `font-medium`; `cited:
  false` rows use a muted icon and normal weight.

### 4. Download flow

Popup blockers reject a `window.open` issued after an `await`, so the tab is
reserved synchronously inside the click handler and pointed at the blob once
the fetch resolves:

```
click
  → win = window.open('', '_blank')          // synchronous — not blocked
  → fetchSourceDocument(download_url)        // bearer header
  → blobUrl = URL.createObjectURL(blob)
  → win.location = pages[0] ? `${blobUrl}#page=${pages[0]}` : blobUrl
  → setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
```

- `#page=N` uses the **first** page only, and only affects PDFs rendered in a
  browser viewer. It is harmless for other types.
- If `window.open` returns `null` (a blocker fired anyway), fall back to
  clicking a synthetic `<a download>` so the user still receives the file.
- If the fetch fails, close the reserved tab before showing the error.
- `download_url` is used from the live message object and is never cached or
  persisted — it is derived per response.

Per-row state is `idle → loading → error`. While loading, a spinner replaces
the row icon. On `SourceUnavailableError` the row shows "Source unavailable"
inline; the panel and every other row keep working. A 401 needs no handling
here — `rawFetch` already redirects to login.

## Pure helpers — `src/lib/source-format.ts`

The formatting branches are the part that is easy to get subtly wrong, so they
are extracted as pure functions with their own test file, matching how
`file-format.ts` is structured:

- `formatPages(pages: number[]): string` — `[]` → `''`, `[2]` → `'p. 2'`,
  `[2, 5]` → `'pp. 2, 5'`.
- `sourceSecondaryLine(source: SourceRef): string` — joins `file_name` and the
  page label with ` · `, dropping either side when absent, returning `''` when
  both are absent.

## Error handling summary

| Condition | Behaviour |
|---|---|
| `sources` null / absent / `[]` | Render nothing |
| 401 on download | Global handler clears token, redirects to login |
| 403 on download | Row shows "Source unavailable" |
| 404 on download | Row shows "Source unavailable" |
| Other non-2xx / network | Row shows the `describeError` message |
| Popup blocked | Falls back to `<a download>` |

## Testing

- `src/lib/source-format.test.ts` — the pure helpers against the fixture set
  below.
- `src/hooks/useSessions.test.ts` — extend with: `sources` from a `done` event
  lands on the assistant message; `sources` from a hydrated thread survives
  `threadToUI`; `retry()` clears `sources`.
- `src/lib/api.test.ts` — extend with: `fetchSourceDocument` sends the bearer
  header, and maps 403 and 404 to `SourceUnavailableError`.

## Evaluation & Improvement

**Success metric.** Share of department-chat turns carrying sources where the
user opens at least one source. This is the nearest available proxy for the
citations being trusted and usable rather than decorative; there is no SQL-side
signal to tie to from the frontend.

**Eval.** Eight labelled fixture `SourceRef` payloads, asserted against their
expected rendered row text in `source-format.test.ts`:

1. `cited: true`, pdf, `pages: [2, 5]`, named file
2. `cited: false`, pdf, `pages: [2]`, named file
3. `cited: true`, docx, `pages: []`, named file
4. `cited: true`, text, `pages: []`, `file_name: null` (typed-in document)
5. `cited: false`, xlsx, `pages: []`, named file
6. `cited: true`, csv, `pages: []`, named file
7. `cited: true`, pdf, `pages: [1, 2, 3, 4]`, named file
8. `cited: false`, docx, `pages: []`, `file_name: null`

Scoring is exact string match on the secondary line and page label. Pass rate
is recorded here on first run.

**Feedback capture.** Row-level download failures (403/404) surface inline and
flow through the existing `describeError` path. No new telemetry endpoint —
none exists in this app yet, and adding one is out of scope.

**Review loop.** Revisit when the gateway changes the `sources` shape, or at
the next RAG milestone, whichever comes first.

## Out of scope

- Any distinct empty-state UI for `sources: []`.
- Inline preview of source documents (the download opens in a browser tab; the
  `FileCard` inline-preview treatment is not extended here).
- Highlighting the cited passage inside the document beyond `#page=N`.
- Client-side caching of `download_url` or of fetched document blobs.
