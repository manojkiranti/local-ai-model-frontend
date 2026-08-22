# AGENTS.md — Local LLM Workspace Frontend

Shared repository guidance for coding agents. Read this first. `README.md` is
the product and setup reference; this file records the implementation rules
that should guide changes.

## Stack

- **Build:** Vite 8 + React 19 + TypeScript 6
- **UI:** Tailwind CSS v4 plus local shadcn-style Radix primitives
- **Routing:** React Router 7
- **Testing:** Vitest 4 + jsdom + Testing Library
- **Backend:** authenticated FastAPI gateway; this frontend does not call
  Ollama, Postgres, or MCP servers directly

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite development server
npm run build        # TypeScript project build + production bundle
npm run test         # Vitest unit suite
npm run lint         # ESLint
npm run preview      # preview the production bundle
```

After non-trivial changes, run the checks relevant to the work. For ordinary
application changes, the expected full verification is:

```bash
npm run test
npm run lint
npm run build
```

Do not claim that the gateway, database, Ollama, uploads, or streamed chat work
live unless those services were actually running and exercised.

## Path alias and style

- `@/*` maps to `src/*` in both TypeScript and Vite. Prefer `@/…` imports over
  long relative paths.
- Follow the existing formatting: single quotes, no semicolons, trailing
  commas, and functional React components.
- TypeScript rejects unused locals and parameters and switch fallthrough.
  Prefer concrete types over `any`.
- Use the semantic Tailwind tokens defined in `src/index.css` (`bg-background`,
  `text-foreground`, `text-muted-foreground`, `bg-card`, `text-primary`, etc.)
  so light and dark themes both remain correct. Avoid arbitrary hard-coded
  colors when a token exists.
- Reuse primitives in `src/components/ui/` and the `cn()` helper in
  `src/lib/utils.ts` before adding new one-off component abstractions.
- Preserve accessibility behavior: labels, keyboard operation, focus states,
  button types, and meaningful `aria-*` attributes.

## Folder map

```text
src/
├── App.tsx, main.tsx
├── components/
│   ├── admin/          department RAG, ingestion, member access, NRB updates
│   ├── agent/          tool traces, generated-file cards, live timeline
│   ├── auth/           login and registration
│   ├── chat/           composer, messages, Markdown, chat panel
│   ├── files/          authenticated user file list and downloads
│   ├── layout/         header, sidebar, service status
│   ├── routing/        auth route guards and loading UI
│   ├── ui/             shared Radix/shadcn-style primitives
│   └── workspace/      authenticated shell and nested routes
├── context/            AuthContext
├── hooks/              feature state and gateway orchestration
├── lib/
│   ├── api.ts          single typed authenticated gateway client
│   ├── agent-api.ts    generated-file reference extraction
│   ├── auth-token.ts   bearer token persistence + 401 notification
│   ├── config.ts       API base URL
│   └── *.test.ts       focused unit tests
└── index.css           Tailwind import, theme tokens, global styles
```

Some agent/embedding/model/tool components and hooks remain in the tree but are
not mounted. Do not infer that a feature is user-facing merely because its file
exists; trace it from `App.tsx` and `Workspace.tsx`.

## Related backend repository

The FastAPI gateway is maintained separately:

- **Repository:** `local-ai-model-gateway`
- **Expected sibling path:** `../../python/local-ai-model-gateway`
- **Local absolute path:**
  `/home/manoj/newlaptop/projects/python/local-ai-model-gateway`
- **Live contract:** `http://localhost:8000/openapi.json` when the gateway is
  running; Swagger UI is at `/docs`

When changing an API integration, inspect the gateway schemas/routes or its
live OpenAPI document when available. Do not modify the backend unless the task
explicitly includes backend work.

## Hard rules

1. **Gateway only.** Components must never call Ollama, Postgres, or MCP
   services directly. Put gateway calls and their mirrored response types in
   `src/lib/api.ts`.
2. **Preserve bearer auth.** Requests use `Authorization: Bearer <token>`, not
   cookies and not `credentials: 'include'`. Authenticated calls should go
   through the shared request path so every 401 clears the token and returns
   the user to login.
3. **Do not hardcode service URLs in components.** The browser API base is
   `VITE_API_BASE_URL`, read by `src/lib/config.ts`, and defaults to
   `http://localhost:8000`.
4. **Understand the proxy escape hatch.** An explicitly empty
   `VITE_API_BASE_URL` selects same-origin requests. Vite then proxies `/v1`
   and `/health` to `VITE_GATEWAY_URL`; its current default in
   `vite.config.ts` is `http://localhost:8080`. Check both settings before
   diagnosing a port mismatch.
5. **Keep chat server-owned.** Do not add local conversation persistence. The
   gateway owns sessions and history; each turn sends only the new message and
   optional turn-scoped fields.
6. **Keep the stream NDJSON.** `POST /v1/chat` uses `stream: true` and returns
   newline-delimited typed events (`token`, `tool_call`, `tool_result`,
   `done`), not SSE. Preserve chunk-boundary-safe parsing and read the new
   session id from `X-Session-Id` or the terminal event.
7. **Respect turn-scoped routing.** Send `department` only while creating a
   department-bound session. Send uploaded `file_ids` only on the attachment
   turn; a retry of that failed turn may resend them, but later turns must not.
8. **Surface gateway errors faithfully.** FastAPI errors use
   `{ "detail": "..." }`. Preserve useful backend detail, including upload
   errors. Keep any deliberate status-specific wording covered by tests.
9. **Never trust the model to relay the OCR caveat.** `read_image` warns the
   model that its text is machine-read and that figures need verifying, and the
   model does not reliably pass that on. The provenance note is derived from the
   tool signal — live `tool_call`/`tool_result` events, or `read_image` entries in
   a persisted trace (`src/lib/ocr-provenance.ts`) — never from the answer text.
   Keep the original image reachable for comparison, and never describe the
   feature as image *interpretation*: the backend does text extraction only.
10. **Handle protected files through fetch.** Downloads and previews require a
    bearer-authenticated fetch followed by a blob URL; a plain anchor to the API
    cannot add the header. Revoke blob URLs when no longer needed. Never inject
    returned HTML or SVG unsafely; keep HTML sandboxed and SVG image-loaded.
11. **Treat ingestion acceptance as pending.** Department document uploads and
    text ingestion return HTTP 202. Continue polling `/v1/ingest-jobs/{job_id}`
    until `succeeded` or `failed`; do not present queue acceptance as success.
12. **Keep role enforcement layered.** The client may hide or redirect admin
    UI, but the backend remains authoritative for authorization. Do not rely on
    client-side checks as a security boundary.
13. **Change contracts end to end.** When a gateway field is added or removed,
    trace its types, request construction, hooks, components, retries, and
    tests. Do not leave a visually hidden unsupported option in outgoing JSON.
14. **Respect the NRB contract's four traps.** `POST /v1/nrb/runs` returns 202
    and 409 with the SAME envelope — branch on `started`, render the run a 409
    carries, never show it as a generic failure. `all_files` must stay
    *unexpressible*: no such field on the request type, not merely unsent.
    `GET /v1/nrb/status` is NOT a pure read — it settles finished runs, so the
    poll is what advances an `awaiting_jobs` run; do not cache or dedupe it away.
    And never claim runner health: the gateway does not serialise `heartbeat_at`,
    so a stalled `queued` run is indistinguishable from one about to be claimed.
    Read "is something running" from `active_run`, never from a status string.
15. **Citations are read from `sources`, never from the answer text.** A chat
    answer's `sources` has three meanings: `null` (no corpus searched — every
    general-chat turn, and every turn before the stream's `done`), `[]`
    (searched, nothing returned), and a list. Render nothing for `null`, not an
    empty heading. `download_url` is server-derived: pass it to
    `fetchDepartmentDocument` verbatim, never rebuild it and never persist it.
    A source with `machine_recovered` MUST render its `verify_note` as visible
    text — that document's text came from OCR or a legacy-font conversion no
    human has verified — and `cited: false` must not be presented as the source
    of a specific sentence.
16. **Tests are required for code changes.** Every bug fix, feature, behavior
    change, or API-contract change must add or update automated tests covering
    the affected behavior. Do not consider the task complete until the relevant
    tests pass. If automated testing is genuinely impractical, explicitly
    explain why and describe the manual verification performed.
17. **A department grant's level decides department UI; the global role does
    not.** `Department.role` (`viewer` < `editor` < `owner`) already folds in
    global admins — an admin reads `owner` everywhere — so gate anything scoped
    to a department on it ALONE, through `atLeast` in
    `src/lib/department-scopes.ts`. That module holds the only copy of the
    ordering on the client: no inline `role === 'editor' || role === 'owner'`,
    and it fails closed, so an absent or unrecognised level shows nothing. The
    exceptions are the routes that really are global: department create / rename
    / enable-disable, `GET /users`, and `/v1/nrb/*` gate on `isAdmin`. Two more
    traps. A 403 from a level check is NOT an auth failure — the caller is signed
    in and lacks the level, so render `detail` verbatim, keep the form, never
    retry, and never let it reach the 401 path (only 401 clears the token). And
    the escalation rule (an owner may not mint, change or revoke another owner)
    depends on facts the client does not hold; do not reimplement it — leave the
    control enabled and render the refusal — an owner MAY act on their own row.
    An owner cannot read `GET /users`, so grant by `email`; `user_id` is for
    changing a member already listed. `POST .../members` UPSERTS, so never send a
    `role` the user did not choose: omitting it keeps an existing member's level,
    while a client-side `viewer` default silently demotes them. Members routes
    work on a soft-disabled department (grants outlive it); the corpus routes
    still 404 there.

## Testing conventions

- Co-locate focused tests as `*.test.ts` under `src/`.
- Mock `fetch` or the API boundary for unit tests; tests must not depend on a
  running gateway.
- Add regression coverage for request bodies and stateful semantics, especially
  authentication, 401 handling, `department`, `file_ids`, streaming events,
  upload validation, and retries.
- `vite.config.ts` includes `src/**/*.test.ts` **and** `src/**/*.test.tsx`. Use
  `.test.ts` for pure logic, hooks, and the API client; use `.test.tsx` only when
  the assertion is genuinely about rendered output (a disabled control, the exact
  status wording).
- Vitest does **not** run with `globals` here, so Testing Library's automatic
  cleanup is never registered. Any `.test.tsx` that renders more than once must
  call `cleanup()` in `afterEach`, or the DOM accumulates and queries fail with
  "found multiple elements".
- `@testing-library/jest-dom` is **not** installed: assert with plain matchers
  (`expect(button.disabled).toBe(true)`), not `toBeInTheDocument()` /
  `toBeDisabled()`. `@testing-library/user-event` is not installed either — use
  `fireEvent`.

## Before changing a feature

- **Gateway/API call:** read `src/lib/api.ts`, its tests, and verify the backend
  contract when possible.
- **Chat/session behavior:** read `src/hooks/useSessions.ts` and
  `src/hooks/useSessions.test.ts`.
- **Authentication:** read `src/context/AuthContext.tsx` and
  `src/lib/auth-token.ts`.
- **Upload or attachment flow:** read `src/hooks/useAttachment.ts`,
  `src/lib/upload-validation.ts`, and the attachment tests in
  `src/hooks/useSessions.test.ts`. Images add `src/lib/ocr-provenance.ts`,
  `src/hooks/useAuthedImageUrl.ts`, and the chat components `ImageThumb`,
  `ImageLightbox`, and `OcrNotice`.
- **Chat source citations:** read `src/lib/sources.ts`,
  `src/components/chat/SourcesPanel.tsx`, `src/hooks/useDocumentDownload.ts`, and
  hard rule 15. The gateway resolves which documents an answer used
  (`app/rag/sources.py`); this UI formats and links them and derives nothing.
- **Department levels / the RAG admin screen:** read
  `src/lib/department-scopes.ts` and its test, `src/components/admin/AdminRagPage.tsx`,
  and hard rule 17. The gateway computes the level (`app/rag/permissions.py`,
  `app/rag/access.py`); this client reads `role` off the department row and
  decides nothing itself. The entry point is gated in
  `src/components/workspace/Workspace.tsx` and `src/components/layout/Sidebar.tsx`.
- **NRB operations:** read `src/hooks/useNrbOps.ts`, `src/lib/nrb-format.ts`, and
  `src/components/admin/NrbOpsPage.test.tsx`, then hard rule 14. Pipeline
  lifecycle logic belongs to the gateway (`app/nrb/pipeline.py`); this screen
  reads and displays and computes nothing derived.
- **Styling or theme work:** read the token definitions in `src/index.css` and
  inspect the existing shared UI primitive first.
- **Routes or navigation:** follow `src/App.tsx`, then the nested routes in
  `src/components/workspace/Workspace.tsx` and links in the sidebar.
- **Product behavior and setup:** read `README.md`; the design and rollout notes
  under `docs/superpowers/` are historical context, not necessarily the current
  contract.

## Documentation maintenance

- Keep `AGENTS.md` as the shared source for Codex and other coding agents.
- `CLAUDE.md` imports this file so Claude receives the same instructions; do
  not duplicate the guidance there.
- Update `README.md` when user-visible behavior, prerequisites, environment
  variables, or setup commands change.
- Update this file when repository structure, scripts, architectural rules, or
  agent-specific pitfalls change.
