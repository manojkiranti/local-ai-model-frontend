# Local LLM Workspace (frontend)

The **UI tier** of a 3-tier local-LLM product. A dark-first React workspace for
authenticated chat with local models over live token streaming.

```
Frontend (this app)  →  Gateway API (http://localhost:8000)  →  Ollama LLM · Postgres · MCP tools
```

- **The frontend talks ONLY to the Gateway.** It never calls the LLM, the
  database, or any tool server directly. The Gateway is the single
  authenticated front door — it fans out to Ollama, Postgres, and MCP tools
  server-side.
- **Auth is JWT bearer tokens** (not cookies). Log in once, store the token,
  and send `Authorization: Bearer <token>` on every request. On any **401** →
  clear the token and return to `/login`. Because it's bearer auth, we do
  **not** set `credentials: "include"`.
- **Base URL comes from an env var** (`VITE_API_BASE_URL`, default
  `http://localhost:8000`) — never hardcoded. All calls go through the one
  typed client in `src/lib/api.ts`.

Built with **React 19 + TypeScript + Vite**, **Tailwind CSS v4**, and
**shadcn-style** primitives (Radix UI). Routing via **react-router-dom**.

## Gateway contract

Authoritative live spec: `http://localhost:8000/openapi.json` (Swagger at
`/docs`). The Gateway is `../../python/local-ai-model-gateway`.

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/auth/register` | — | `{email,password}` → 201 user. First user becomes **admin**; 409 if email exists; password ≥ 8. Returns the user, **not** a token. |
| POST | `/auth/login` | — | `{email,password}` → `{access_token, token_type, expires_in}`. 401 on bad credentials. |
| GET  | `/users/me` | bearer | Current user `{id, email, role, …}`. Roles: `admin` \| `member`. |
| POST | `/v1/chat` | bearer | **The one endpoint** — stateful, tool-capable, streaming. `{session_id?, message, department?, model?, stream?, options?, file_ids?}`. Send `department` only when creating a department-bound session; continuing turns send the `session_id` and the server remembers the binding. `stream:true` → **NDJSON of typed events** (`token` / `tool_call` / `tool_result` / `done`, **not** SSE) with the new session id in the **`X-Session-Id` response header**. |
| GET  | `/v1/sessions` | bearer | Sidebar list `[{id, title, created_at, updated_at, message_count}]`, newest-updated first. |
| GET  | `/v1/sessions/{id}` | bearer | Full thread `{…, messages:[{id, seq, role, content, trace, model, created_at}]}`. Assistant rows whose turn called tools carry non-null `trace`. 404 = gone. |
| DELETE | `/v1/sessions/{id}` | bearer | Delete a conversation → 204. |
| GET  | `/v1/tools` | bearer | Tools the model can use. |
| GET  | `/v1/files` | bearer | The current user's generated files `{files:[{id, filename, media_type, size, created_at}]}`, newest-first and owner-scoped server-side. |
| GET  | `/v1/files/{id}` | bearer | Download a generated file — fetch **with** the bearer header and turn the response into a blob URL (a plain `<a href>` can't send the header). Owner-scoped: 404 = not yours / gone. |
| GET | `/v1/departments` | bearer | Available RAG departments. Members receive only active granted departments; admins receive every department. |
| POST/PATCH | `/v1/departments[/{code}]` | bearer + admin | Create, rename, enable, and disable departments. |
| GET/POST/DELETE | `/v1/departments/{code}/members[...]` | bearer + admin | List, grant, and revoke department access. |
| GET/POST/DELETE | `/v1/departments/{code}/documents[...]` | bearer (writes admin-only) | List corpus documents; upload files, add text, and archive documents. Uploads return 202. |
| GET | `/v1/ingest-jobs/{job_id}` | bearer + admin | Poll asynchronous document ingestion progress. |
| GET | `/v1/nrb/status` | bearer + admin | Operational state `{active_run, latest_run, catalog, files, rag}`. **Not a pure read** — the handler settles finished runs and commits, so polling it is what advances an `awaiting_jobs` run. `catalog`/`files` are flat `{string:int}`; `rag` mixes scalars with nested `documents`/`jobs` maps. |
| POST | `/v1/nrb/runs` | bearer + admin | Trigger an update. **202 and 409 share one envelope** `{started, run, detail}` — a 409 carries the run already in progress. A bounded scope is required (422 otherwise); `all_files` is deliberately unavailable over HTTP. |
| GET | `/v1/nrb/runs/{id}` | bearer + admin | One run (`RunOut`), reconciled if still waiting. Terminal runs are frozen. |

Error bodies are FastAPI-style `{"detail": "..."}`. This client maps
`404 → "model not available on the server"`, `502 → "inference service is
unavailable"`, otherwise it surfaces `detail`.

### What this UI currently wires

- **Auth** — register / login / session-restore (`GET /users/me` on load) /
  logout, protected routing, and a header account menu showing the email + role.
- **Server-owned conversations** — the client no longer holds chat state.
  `useSessions` drives a **persisted sidebar** (`GET /v1/sessions`, new-chat /
  select / delete) and loads each **thread** from `GET /v1/sessions/{id}`, so
  history survives reloads. A turn sends only the new message (`{session_id?,
  message}`); a new conversation adopts the server's id (from the response body,
  or the `X-Session-Id` header when streaming).
- **One streaming turn endpoint** — every message goes to `/v1/chat` with
  `stream:true`. The client renders the typed event stream: `token` deltas grow
  the answer bubble, `tool_call`/`tool_result` drive a **live tool timeline**,
  and `done` settles the turn with the authoritative trace. No mode toggle —
  the model calls a tool only when it's useful.
- **Tool turns** render a collapsible **"How it worked"** trace panel
  (iterations → tool calls: name / args / status / result), for both live turns
  and rows loaded from history (`trace != null`).
- **Files** produced by tools render **inline as cards**. Every `/v1/files/<id>`
  reference is detected in **both** the answer text and the trace, fetched
  **with** the bearer header (a plain `<a href>` can't), and rendered by the
  response's real **Content-Type**: `image/svg+xml` charts show inline via
  **`<img>`** (never innerHTML — img-loaded SVG can't run scripts) + download;
  `text/html` previews in a sandboxed **`<iframe srcdoc>`** (empty sandbox — no
  scripts) + download; spreadsheets and everything else get a download chip. The
  blob URL is revoked on unmount, and the raw "GET /v1/files/…" text is stripped
  once its card renders.
- **My Files** — a sidebar nav entry + `/files` route lists the current user's
  generated files (`GET /v1/files`, owner-scoped, newest-first): filename, a type
  badge (PDF / Excel / HTML / SVG / …), a human size, and a relative time. Each
  row's **Download** re-fetches `GET /v1/files/{id}` **with** the bearer header
  into a blob URL; a **404** ("not yours / gone") quietly drops the row with a
  transient notice. Loading / error-with-Retry / empty states included.
- **Failed turns** (e.g. 502): the user's message is already saved server-side,
  so the reply bubble shows the error with a **Retry** affordance.
- **Department-scoped RAG** — General plus the current user's active departments
  render as chat tabs. Changing scope starts a fresh conversation and sends the
  selected department code only on its first turn. Existing sessions continue
  without resending a scope; a 409 explains that a new department chat is needed.
- **RAG Admin** — admins get a `/admin` workspace for creating/disabling
  departments, uploading PDF/DOCX/XLSX/CSV or typed knowledge, watching the 202
  ingestion job progress every two seconds, archiving documents, and granting or
  revoking members. Members are redirected away from the route.
- **NRB updates** — admins get a `/admin/nrb` screen over the three `/v1/nrb`
  endpoints: the update in progress (or the latest result) with its status,
  stage, timestamps, counters, job counts and failure text; and the catalog /
  files / RAG count blocks, rendered by **iterating whatever keys the gateway
  returned** so a new counter appears without a frontend change. `bytes_on_disk`
  is formatted as a size. Both actions are disabled while `active_run` is
  non-null, and the primary submit stays disabled until a department **and** at
  least one bound (limit / years / sections / owners / extensions) are set —
  there is no default bound, so "Succeeded" never means an arbitrary slice.
  "Retry failed ingest" sends `stages:["rag"]` with `retry_failed:true`. Polling
  is every 5s and only while a run is active; a failed poll keeps the last good
  status on screen. A **409 renders the in-progress run**, not an error. A
  **403** says the account is not an administrator without returning to login;
  a **401** anywhere ends the session and returns to login with a
  "session expired" notice.

`/v1/tools` and the Embeddings playground are part of the Gateway contract but
**not yet surfaced** here (those components remain on disk, unmounted).

> **Runner health is not observable.** The gateway does not expose whether the
> NRB pipeline runner process is alive (`heartbeat_at` is not serialised), so a
> `queued` run that sits still is indistinguishable from one about to be
> claimed. The UI says only "waiting for the NRB pipeline runner to claim it"
> and must never infer "no runner" from elapsed time.

## Prerequisites

The **Gateway** must be running on `http://localhost:8000`:

```bash
cd ../../python/local-ai-model-gateway
.venv/bin/uvicorn app.main:app --reload
# plus an Ollama server: `ollama serve` with a model pulled
```

> ⚠️ **Port collision.** The older standalone prototype
> `../../python/local-ai-model` also defaults to `:8000` but has **no auth** —
> if it's the one running, `/auth/login` returns 404 and login breaks. Confirm
> the right service with:
> `curl -s localhost:8000/openapi.json | grep -o '"title":"[^"]*"'`
> — it must read **"Local LLM Gateway"** (has `/auth/*`), not "Ollama Gateway".

## Run

```bash
cp .env.example .env      # VITE_API_BASE_URL=http://localhost:8000 (default)
npm install
npm run dev               # http://localhost:3000 (vite.config.ts pins this port)
```

The NRB updates screen additionally needs **two background processes** the
Gateway does not start for you — without them a triggered run is accepted and
then waits, which is exactly what the screen will say:

```bash
cd ../../python/local-ai-model-gateway
.venv/bin/python -m app.nrb.runner   # claims queued runs → sync/fetch/extract/rag
.venv/bin/python -m app.rag.worker   # chunk/embed → moves `Indexing` to a verdict
```

Point at a different Gateway by setting `VITE_API_BASE_URL`. CORS is enabled on
the Gateway for dev; bearer tokens mean no cookies / no `credentials:"include"`.

## Scripts

| Command         | Description                             |
| --------------- | --------------------------------------- |
| `npm run dev`   | Dev server with HMR                     |
| `npm run build` | Typecheck (`tsc -b`) + production build |
| `npm run test`  | Vitest unit tests (jsdom)               |
| `npm run lint`  | ESLint                                  |

## Structure

```
src/
  lib/          api.ts (the ONE gateway client: bearer + 401 handling + NDJSON stream),
                auth-token.ts, auth-validation.ts, config.ts, chat-config.ts, utils.ts
  context/      AuthContext (session, login/register/logout)
  hooks/        useAuth, useSessions (server-owned chat), useHealth, useTheme,
                useNrbOps (NRB status + polling + trigger)  (useModels/useTools: unmounted)
  components/
    ui/         shadcn-style primitives (button, input, label, dropdown-menu, …)
    auth/       LoginPage, RegisterPage, AuthShell
    routing/    ProtectedRoute, PublicOnly, FullScreenSpinner
    workspace/  Workspace (app shell: nested routes — chat index + /files + /admin*)
    admin/      AdminRagPage (departments, corpus ingestion, member access),
                NrbOpsPage + NrbStatusBlock (NRB updates: /v1/nrb)
    files/      FilesPage (My Files: GET /v1/files list + bearer-fetch download)
    layout/     Header (account menu), Sidebar (chat + My Files nav), StatusDot
    chat/       ChatPanel, MessageList, MessageBubble, Composer, GenerationSettings
    agent/ embeddings/   present but unmounted (await Gateway slices in this UI)
  App.tsx       routes;  main.tsx  BrowserRouter + AuthProvider
```

## Evaluation & Improvement — NRB updates screen

1. **Success metric.** Share of NRB corpus updates an admin can start and follow
   to a correct terminal verdict **without opening a terminal or the database** —
   measured as: triggered runs whose outcome the operator read off this screen ÷
   all triggered runs. The nearest proxy while volume is low is the count of
   `trigger: "api"` rows in `nrb_pipeline_runs` versus `cli`.
2. **Eval.** The labelled set is `src/components/admin/NrbOpsPage.test.tsx`
   (22 cases) plus `src/lib/nrb-format.test.ts` and `src/lib/nrb-api.test.ts`.
   It fixes the payloads the gateway actually returns and scores the rendered
   output against them, covering the four failure modes that make this screen
   misleading rather than merely ugly: a 409 shown as an error, a silent default
   bound, `running` confused with `awaiting_jobs`, and any claim about runner
   health. **Current pass rate: 157/157** (`npm run test`, whole suite).
   Not yet exercised against a live gateway.
3. **Feedback capture.** The screen itself captures none — it is read-only over
   `/v1/nrb`, and the durable record is the gateway's own `nrb_pipeline_runs`
   table (`trigger`, `requested_by`, `scope`, `counters`, `error`), which already
   says who asked for what and how it ended. Operator corrections arrive as
   changes to the eval set above; add a case before changing behaviour.
4. **Review loop.** Re-run the eval on every change to `/v1/nrb` or to this
   screen, and review monthly: check whether any counter key rendered as an
   unlabelled fallback (a stage added one), and whether the bounds offered still
   match `RunTriggerIn`.

See `docs/superpowers/specs/2026-07-30-auth-gateway-wiring-design.md` and
`docs/superpowers/plans/2026-07-30-auth-gateway-wiring.md` for the auth design
and implementation notes.
