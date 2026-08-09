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

`/v1/tools` and the Embeddings playground are part of the Gateway contract but
**not yet surfaced** here (those components remain on disk, unmounted).

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
npm run dev               # http://localhost:5173
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
  hooks/        useAuth, useSessions (server-owned chat), useHealth, useTheme  (useModels/useTools: unmounted)
  components/
    ui/         shadcn-style primitives (button, input, label, dropdown-menu, …)
    auth/       LoginPage, RegisterPage, AuthShell
    routing/    ProtectedRoute, PublicOnly, FullScreenSpinner
    workspace/  Workspace (app shell: nested routes — chat index + /files)
    admin/      AdminRagPage (departments, corpus ingestion, member access)
    files/      FilesPage (My Files: GET /v1/files list + bearer-fetch download)
    layout/     Header (account menu), Sidebar (chat + My Files nav), StatusDot
    chat/       ChatPanel, MessageList, MessageBubble, Composer, GenerationSettings
    agent/ embeddings/   present but unmounted (await Gateway slices in this UI)
  App.tsx       routes;  main.tsx  BrowserRouter + AuthProvider
```

See `docs/superpowers/specs/2026-07-30-auth-gateway-wiring-design.md` and
`docs/superpowers/plans/2026-07-30-auth-gateway-wiring.md` for the auth design
and implementation notes.
