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
| POST | `/v1/chat` | bearer | **The one endpoint** — stateful, tool-capable, streaming. `{session_id?, message, model?, stream?, options?}`. Omit `session_id` to start a conversation; the server owns history — send only the new message. Tools are always available (no mode toggle). `stream:true` → **NDJSON of typed events** (`token` / `tool_call` / `tool_result` / `done`, **not** SSE) with the new session id in the **`X-Session-Id` response header**. `stream:false` → `{session_id, message:{role,content}, model, stop_reason, trace}`. |
| GET  | `/v1/sessions` | bearer | Sidebar list `[{id, title, created_at, updated_at, message_count}]`, newest-updated first. |
| GET  | `/v1/sessions/{id}` | bearer | Full thread `{…, messages:[{id, seq, role, content, trace, model, created_at}]}`. Assistant rows whose turn called tools carry non-null `trace`. 404 = gone. |
| DELETE | `/v1/sessions/{id}` | bearer | Delete a conversation → 204. |
| GET  | `/v1/tools` | bearer | Tools the model can use. |
| GET  | `/v1/files/{id}` | bearer | Download a generated file — fetch **with** the bearer header and turn the response into a blob URL (a plain `<a href>` can't send the header). |

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
- **Files** produced by tools are parsed from the trace and fetched from
  `/v1/files/{id}` **with** the bearer header (a plain `<a href>` can't). Branch:
  `text/html` → sandboxed **`<iframe srcdoc>`** preview (empty sandbox — no
  scripts) **+** download; xlsx → download only (blob URL).
- **Failed turns** (e.g. 502): the user's message is already saved server-side,
  so the reply bubble shows the error with a **Retry** affordance.

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
    workspace/  Workspace (chat shell)
    layout/     Header (account menu), Sidebar, StatusDot
    chat/       ChatPanel, MessageList, MessageBubble, Composer, GenerationSettings
    agent/ embeddings/   present but unmounted (await Gateway slices in this UI)
  App.tsx       routes;  main.tsx  BrowserRouter + AuthProvider
```

See `docs/superpowers/specs/2026-07-30-auth-gateway-wiring-design.md` and
`docs/superpowers/plans/2026-07-30-auth-gateway-wiring.md` for the auth design
and implementation notes.
