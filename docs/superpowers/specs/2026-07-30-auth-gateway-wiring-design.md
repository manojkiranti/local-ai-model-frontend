# Auth UI + Gateway Wiring — Design

Date: 2026-07-30
Project: `local-ai-model-frontend` (Vite + React 19 + TS + Tailwind v4 + shadcn/Radix)
Backend: `local-ai-model-gateway` (FastAPI "Local LLM Gateway" v0.2.0) — the ONLY backend this app talks to.

## Goal

Add authentication UI (login/register, session restore, protected routing, logout) and
consolidate all gateway calls into one typed API client, then keep the existing chat
working against the now auth-gated, reduced gateway surface.

## Context: what actually changed in the backend

The frontend was originally built against the older standalone `local-ai-model` prototype,
which exposed `/v1/chat`, `/v1/models`, `/v1/embeddings`, `/v1/agent`, `/v1/tools`, `/v1/files`.

The **new gateway** implements only:

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET  | `/health`        | none        | `{status, ollama:{base_url,reachable}}` (503 when degraded) |
| POST | `/auth/register` | none        | `UserOut` (201; 409 if email exists; password >= 8) |
| POST | `/auth/login`    | none        | `TokenResponse` (401 bad creds; 403 inactive) |
| GET  | `/users/me`      | Bearer      | `UserOut` |
| GET  | `/users`         | Bearer+admin| `UserListResponse` |
| POST | `/v1/chat`       | Bearer      | `ChatResponse` JSON or `application/x-ndjson` stream |

`agent`, `embeddings`, `models`, `tools`, `files` are empty stubs — those endpoints 404.

Key contract facts:
- `TokenResponse` = `{ access_token, token_type:"bearer", expires_in: <seconds> }`.
- `UserOut` = `{ id, email, auth_provider, role, is_active, created_at, updated_at }`. Roles: `"admin" | "member"` (NOT "user"). No display-name field.
- `/auth/register` returns the **user**, not a token → must call `/auth/login` afterward.
- Chat stream is **NDJSON** (Ollama native shape), one JSON per line, text at `message.content`, end signaled by `{"done": true}`. No SSE, no `data:` prefix, no `choices[].delta`. Raw byte chunks may not align to line boundaries → buffer + split on `\n`.
- Errors are FastAPI default `{"detail": "..."}`.
- Chat `model` is optional; server defaults to `qwen2.5:latest`. No `/v1/models` to list.
- CORS default `*`; we use plain fetch with Bearer and NO `credentials:"include"`, which is compatible with `allow_origins=["*"]`.

## Decisions (confirmed with user)

1. **Routing:** add `react-router-dom` (v7) for real URL paths `/login`, `/register` and redirects.
2. **Unsupported features:** hide Agent & Embeddings tabs and the model dropdown; keep the code on disk (unmounted), structured so a future `/v1/agent` slot re-enables cleanly.
3. **Model selection:** send no `model` field; use the gateway's server default.

## Architecture

### 1. Single gateway client — `src/lib/api.ts` (+ `config.ts`)
- `config.ts`: `API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"`; `.env.example` documents it. All calls absolute-prefixed with `API_BASE` (drop same-origin/dev-proxy reliance).
- Core `request<T>(path, opts)`: prefixes base, JSON content-type, injects `Authorization: Bearer <token>` when present, threads `AbortSignal`. On **401**: clear token → invoke registered `onUnauthorized()`; otherwise throw `GatewayError`.
- Error mapping (`describeError`): 404 → "model not available on the server", 502 → "inference service is unavailable", else body `detail`.
- Auth methods: `register`, `login`, `getMe`.
- Chat: NDJSON async-generator `streamChat(messages, {signal})`, bearer-authed, no model field. Send-path factored so a future `agent` kind (`POST /v1/agent`) slots in.

### 2. Token store — `src/lib/auth-token.ts`
`getToken/setToken/clearToken` (in-memory var + `localStorage` key `ollama-workspace-token`), `registerUnauthorizedHandler(fn)`. Keeps React out of `api.ts`.

### 3. Session — `src/context/AuthContext.tsx` + `src/hooks/useAuth.ts`
State `{ user, status: 'loading'|'authenticated'|'unauthenticated' }`; actions `login`, `register`, `logout`; `isAdmin` flag. On mount, if token exists call `getMe()` to restore; on 401 clear → unauthenticated. Registers `onUnauthorized` → clear user + navigate `/login`. `logout` = clear token + `/login` (no server logout).

### 4. Routing — `react-router-dom`
`main.tsx`: `<BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>`. `App.tsx` = routes: `/login`, `/register` behind `PublicOnly` (→ `/` if authed); `/*` behind `ProtectedRoute` (loading → spinner; unauthenticated → `<Navigate to="/login" replace/>`) rendering `Workspace` (extracted from current `App.tsx`).

### 5. Auth pages — `src/components/auth/{LoginPage,RegisterPage}.tsx`
Existing shadcn primitives + tokens. Client validation: email regex + password >= 8; inline errors; disabled-while-pending; server errors via `describeError`. Register → auto-login → `/`.

### 6. Header — `src/components/layout/Header.tsx`
Show email + role badge (`badge.tsx`) + Logout (existing Radix `dropdown-menu`).

### 7. Hide unsupported features
`Workspace.tsx` renders only the Chat tab; no model dropdown. `agent/`, `embeddings/`, `useModels`, `useTools`, `agent-api.ts` remain on disk, unmounted. `useHealth` keeps polling public `/health`.

### 8. Testing (Vitest, node env, colocated `*.test.ts`)
- `auth-token.test.ts`: set/get/clear + localStorage round-trip.
- `api.test.ts` (extend): Bearer injection; 401 → clear + handler; 404/502/detail mapping; register/login/getMe shapes.

## File touch list
**New:** `lib/auth-token.ts`, `context/AuthContext.tsx`, `hooks/useAuth.ts`, `components/auth/LoginPage.tsx`, `components/auth/RegisterPage.tsx`, `components/routing/ProtectedRoute.tsx`, `components/routing/PublicOnly.tsx`, `components/workspace/Workspace.tsx`, `.env.example`, tests.
**Modified:** `lib/api.ts`, `lib/config.ts`, `App.tsx`, `main.tsx`, `components/layout/Header.tsx`, `package.json`.
**Unmounted (kept):** `components/agent/*`, `components/embeddings/*`, `hooks/useModels.ts`, `hooks/useTools.ts`, `lib/agent-api.ts`.

## Out of scope (per spec)
tool-calling/agent, file generation/downloads, chat-history persistence, admin screens, server-side logout.

## Conventions to honor
`@/*` alias; `import type` (verbatimModuleSyntax); Tailwind v4 CSS tokens (no config file); shadcn `ui/` lowercase primitives; feature folders lowercase + PascalCase files; named exports; `AbortSignal` threaded; `GatewayError` + `describeError`; no unused locals/params.
