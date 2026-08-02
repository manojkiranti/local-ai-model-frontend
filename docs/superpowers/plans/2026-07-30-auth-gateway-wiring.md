# Auth UI + Gateway Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JWT auth (login/register, session restore, protected routing, logout) and route all gateway calls through one typed client, keeping chat working against the auth-gated gateway.

**Architecture:** A React-context auth layer (`AuthProvider`) sits above `react-router-dom` routes. A single `api.ts` client prefixes `API_BASE`, injects `Authorization: Bearer <token>`, and on any 401 clears the token and redirects to `/login`. The existing chat UI is preserved but the model picker and the Agent/Embeddings tabs (whose gateway endpoints are unimplemented stubs) are unmounted.

**Tech Stack:** Vite 8, React 19, TypeScript ~6, Tailwind v4 (CSS-first), shadcn/Radix primitives, react-router-dom v7, Vitest (jsdom).

## Global Constraints

- Backend is the gateway ONLY: `http://localhost:8000` (env `VITE_API_BASE_URL`, default `http://localhost:8000`). Every call absolute-prefixed with `API_BASE`.
- JWT bearer, NOT cookies → plain `fetch`, never `credentials:"include"`.
- Gateway endpoints that exist: `GET /health`, `POST /auth/register`, `POST /auth/login`, `GET /users/me`, `POST /v1/chat`. Everything else 404s.
- `/auth/register` returns a `UserOut` (NOT a token); password min length 8; 409 if email exists.
- `/auth/login` → `{ access_token, token_type:"bearer", expires_in:<seconds> }`; 401 bad creds.
- `UserOut = { id:number, email:string, auth_provider:string, role:"admin"|"member", is_active:boolean, created_at:string, updated_at:string }`. Roles are `admin`/`member` (never "user").
- Chat stream is NDJSON (Ollama shape): text at `message.content`, end at `{"done":true}`. Buffer + split on `\n`.
- Chat `model` is optional → send NO model field (server default `qwen2.5:latest`).
- Errors: FastAPI `{"detail":"..."}`. Map 404 → "model not available on the server", 502 → "inference service is unavailable", else show `detail`. 401 → clear token + `/login`.
- Conventions: `@/*` alias; `import type` (verbatimModuleSyntax on); Tailwind tokens (no config file); shadcn `ui/` primitives lowercase; feature files PascalCase in lowercase folders; named exports; thread `AbortSignal`; throw `GatewayError`; `noUnusedLocals`/`noUnusedParameters` on — no dead vars/imports.
- localStorage token key: `ollama-workspace-token`.

---

### Task 1: Project setup — dependencies, test env, env files

**Files:**
- Modify: `package.json` (add `react-router-dom`)
- Modify: `vite.config.ts:22-25` (test env → jsdom)
- Modify: `src/vite-env.d.ts` (doc only)
- Create: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `react-router-dom` available; Vitest runs under jsdom (gives `localStorage`, DOM globals) so later token/api tests work.

- [ ] **Step 1: Install react-router-dom**

Run: `npm install react-router-dom@^7`
Expected: `react-router-dom` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Switch the Vitest environment to jsdom**

In `vite.config.ts`, change the `test` block:

```ts
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
```

- [ ] **Step 3: Add `.env.example`**

Create `.env.example`:

```
# Base URL of the Local LLM Gateway (the only backend this app talks to).
VITE_API_BASE_URL=http://localhost:8000
```

- [ ] **Step 4: Update the env-var doc comment**

In `src/vite-env.d.ts`, replace the JSDoc for `VITE_API_BASE_URL` so it no longer mentions the dev proxy:

```ts
interface ImportMetaEnv {
  /** Base URL of the Local LLM Gateway (default "http://localhost:8000"). */
  readonly VITE_API_BASE_URL?: string
}
```

- [ ] **Step 5: Verify the existing suite still passes under jsdom**

Run: `npm test`
Expected: PASS (existing `readNdjson`/`cosineSimilarity`/agent tests still green).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/vite-env.d.ts .env.example
git commit -m "chore: add react-router-dom, jsdom test env, env example"
```

---

### Task 2: Token store — `src/lib/auth-token.ts`

**Files:**
- Create: `src/lib/auth-token.ts`
- Test: `src/lib/auth-token.test.ts`

**Interfaces:**
- Consumes: browser `localStorage` (jsdom in tests).
- Produces:
  - `getToken(): string | null`
  - `setToken(token: string): void`
  - `clearToken(): void`
  - `registerUnauthorizedHandler(fn: () => void): void`
  - `notifyUnauthorized(): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth-token.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearToken,
  getToken,
  notifyUnauthorized,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

afterEach(() => {
  clearToken()
  localStorage.clear()
  registerUnauthorizedHandler(() => {})
})

describe('auth-token', () => {
  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('persists a token to localStorage and reads it back', () => {
    setToken('abc.def.ghi')
    expect(getToken()).toBe('abc.def.ghi')
    expect(localStorage.getItem('ollama-workspace-token')).toBe('abc.def.ghi')
  })

  it('clears the token from memory and localStorage', () => {
    setToken('abc.def.ghi')
    clearToken()
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('ollama-workspace-token')).toBeNull()
  })

  it('invokes the registered handler on notifyUnauthorized', () => {
    const spy = vi.fn()
    registerUnauthorizedHandler(spy)
    notifyUnauthorized()
    expect(spy).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth-token.test.ts`
Expected: FAIL — module `@/lib/auth-token` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth-token.ts`:

```ts
/**
 * JWT token store: in-memory value mirrored to localStorage, plus a single
 * "unauthorized" callback the API client fires on any 401 so the React layer
 * can clear the session and redirect to /login. Kept React-free on purpose.
 */
const STORAGE_KEY = 'ollama-workspace-token'

let token: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function getToken(): string | null {
  if (token !== null) return token
  try {
    token = localStorage.getItem(STORAGE_KEY)
  } catch {
    token = null
  }
  return token
}

export function setToken(next: string): void {
  token = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Non-fatal: keep the in-memory copy.
  }
}

export function clearToken(): void {
  token = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Non-fatal.
  }
}

export function registerUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-token.ts src/lib/auth-token.test.ts
git commit -m "feat: add JWT token store with unauthorized handler"
```

---

### Task 3: Auth validation helpers — `src/lib/auth-validation.ts`

**Files:**
- Create: `src/lib/auth-validation.ts`
- Test: `src/lib/auth-validation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `emailError(email: string): string | null`
  - `passwordError(password: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth-validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emailError, passwordError } from '@/lib/auth-validation'

describe('emailError', () => {
  it('rejects an empty email', () => {
    expect(emailError('')).toBe('Email is required.')
  })
  it('rejects a malformed email', () => {
    expect(emailError('not-an-email')).toBe('Enter a valid email address.')
  })
  it('accepts a valid email (trimmed)', () => {
    expect(emailError('  user@example.com ')).toBeNull()
  })
})

describe('passwordError', () => {
  it('rejects passwords shorter than 8 chars', () => {
    expect(passwordError('short')).toBe('Password must be at least 8 characters.')
  })
  it('accepts an 8-char password', () => {
    expect(passwordError('supersecret123')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth-validation.ts`:

```ts
/** Client-side auth form validation. Server remains the source of truth. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function emailError(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Email is required.'
  if (!EMAIL_RE.test(value)) return 'Enter a valid email address.'
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth-validation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-validation.ts src/lib/auth-validation.test.ts
git commit -m "feat: add email/password validation helpers"
```

---

### Task 4: API client — bearer injection, 401 handling, auth methods, error mapping

**Files:**
- Modify: `src/lib/api.ts` (add types, `request`/`rawFetch` core, auth methods; rewrite `streamChat`/`getHealth`/`describeError`; keep `readNdjson`/`cosineSimilarity`/`GatewayError`/`errorFromResponse`)
- Test: `src/lib/api.test.ts` (extend — do NOT remove existing `readNdjson`/`cosineSimilarity` tests)

**Interfaces:**
- Consumes: `getToken`, `clearToken`, `notifyUnauthorized` from `@/lib/auth-token`; `API_BASE` from `@/lib/config`.
- Produces:
  - `interface UserOut { id:number; email:string; auth_provider:string; role:'admin'|'member'; is_active:boolean; created_at:string; updated_at:string }`
  - `interface TokenResponse { access_token:string; token_type:string; expires_in:number }`
  - `register(email:string, password:string): Promise<UserOut>`
  - `login(email:string, password:string): Promise<TokenResponse>`
  - `getMe(signal?:AbortSignal): Promise<UserOut>`
  - `streamChat(params:StreamChatParams, signal?:AbortSignal): AsyncGenerator<ChatChunk>` (now bearer-authed, absolute URL)
  - `getHealth(signal?:AbortSignal): Promise<HealthResponse>` (absolute URL)
  - `describeError(err:unknown): string` (with 404/502 mapping)

- [ ] **Step 1: Write the failing tests (append to `src/lib/api.test.ts`)**

Add these imports at the top of `src/lib/api.test.ts` (merge with the existing import line) and append the new `describe` blocks:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cosineSimilarity,
  describeError,
  getMe,
  login,
  readNdjson,
  register,
  GatewayError,
} from '@/lib/api'
import {
  clearToken,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
      .mockResolvedValue(jsonResponse({ access_token: 'x', token_type: 'bearer', expires_in: 60 }))
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
```

Note: keep the file's existing `describe('readNdjson')` and `describe('cosineSimilarity')` blocks; only the import line is replaced/merged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL — `getMe`/`login`/`register`/`describeError` mapping not implemented.

- [ ] **Step 3: Rewrite the client core, add types + auth methods**

In `src/lib/api.ts`:

(a) Replace the top file doc comment (lines 1-6) with:

```ts
/**
 * The single typed client for the Local LLM Gateway — the ONLY backend this
 * app talks to. Every call is prefixed with API_BASE, carries a Bearer token
 * when logged in, and on any 401 clears the token and notifies the auth layer
 * to redirect to /login. Plain fetch, no cookies (JWT bearer auth).
 */
import { API_BASE } from '@/lib/config'
import { clearToken, getToken, notifyUnauthorized } from '@/lib/auth-token'
```

(b) Add the auth types near the other interfaces (after `ChatChunk`/before `StreamChatParams` is fine):

```ts
export interface UserOut {
  id: number
  email: string
  auth_provider: string
  role: 'admin' | 'member'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}
```

(c) Make the two model-name fields on `HealthResponse` optional (the gateway `/health` no longer returns them):

```ts
export interface HealthResponse {
  status: 'ok' | 'degraded'
  ollama: { base_url: string; reachable: boolean }
  default_chat_model?: string
  default_embed_model?: string
}
```

(d) Update `describeError` to map 404/502:

```ts
/** Normalize a thrown value (network error, abort, GatewayError) to a message. */
export function describeError(err: unknown): string {
  if (err instanceof GatewayError) {
    if (err.status === 404) return 'model not available on the server'
    if (err.status === 502) return 'inference service is unavailable'
    return err.message
  }
  if (err instanceof DOMException && err.name === 'AbortError') return 'Stopped.'
  if (err instanceof TypeError) {
    return 'Cannot reach the gateway. Is it running on port 8000?'
  }
  return err instanceof Error ? err.message : String(err)
}
```

(e) Add the request core just above the "Endpoints" section:

```ts
// --------------------------------------------------------------------------- //
// Request core — base URL prefix, bearer injection, global 401 handling
// --------------------------------------------------------------------------- //
async function rawFetch(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal })

  if (res.status === 401) {
    clearToken()
    notifyUnauthorized()
    throw await errorFromResponse(res)
  }
  return res
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await rawFetch(path, init, signal)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<T>
}

// --------------------------------------------------------------------------- //
// Auth endpoints
// --------------------------------------------------------------------------- //
/** Register a new user. Returns the created user (NOT a token). 409 if taken. */
export async function register(email: string, password: string): Promise<UserOut> {
  return request<UserOut>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/** Exchange credentials for a JWT. 401 on bad credentials. */
export async function login(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/** Fetch the current user (bearer required). 401 restores to logged-out. */
export async function getMe(signal?: AbortSignal): Promise<UserOut> {
  return request<UserOut>('/users/me', { method: 'GET' }, signal)
}
```

(f) Rewrite `getHealth` and `streamChat` to use `API_BASE` + the bearer core. Replace the existing `getHealth` body and `streamChat` body:

```ts
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  // 200 (ok) or 503 (degraded); both carry the JSON body. No auth required.
  const res = await fetch(`${API_BASE}/health`, { signal })
  const data = await res.json().catch(() => null)
  if (!data) throw new GatewayError(res.status, 'Gateway returned no health JSON')
  return data as HealthResponse
}
```

```ts
export async function* streamChat(
  params: StreamChatParams,
  signal?: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const res = await rawFetch(
    '/v1/chat',
    { method: 'POST', body: JSON.stringify({ ...params, stream: true }) },
    signal,
  )
  if (!res.ok || !res.body) throw await errorFromResponse(res)
  for await (const obj of readNdjson(res.body)) {
    yield obj as ChatChunk
  }
}
```

Leave `listModels`/`getEmbeddings` as-is for now (unmounted; still type-checks). They are not part of this slice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS (existing + new blocks).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat: single gateway client with bearer auth, 401 handling, auth endpoints"
```

---

### Task 5: Auth session — `AuthContext` + `useAuth`

**Files:**
- Create: `src/context/AuthContext.tsx`
- Create: `src/hooks/useAuth.ts`

**Interfaces:**
- Consumes: `login`/`register`/`getMe`/`UserOut` from `@/lib/api`; `getToken`/`setToken`/`clearToken`/`registerUnauthorizedHandler` from `@/lib/auth-token`; `useNavigate` from `react-router-dom`.
- Produces:
  - `AuthProvider({ children }): JSX` (must render inside a Router)
  - `AuthContext` (React context of `AuthContextValue | null`)
  - `type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'`
  - `interface AuthContextValue { user:UserOut|null; status:AuthStatus; isAdmin:boolean; login(email,password):Promise<void>; register(email,password):Promise<void>; logout():void }`
  - `useAuth(): AuthContextValue`

Verified by typecheck/lint/build + manual smoke in Task 9 (React component behavior is not unit-tested; the node-only `*.test.ts` harness doesn't render components).

- [ ] **Step 1: Create the context/provider**

Create `src/context/AuthContext.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMe,
  login as apiLogin,
  register as apiRegister,
  type UserOut,
} from '@/lib/api'
import {
  clearToken,
  getToken,
  registerUnauthorizedHandler,
  setToken,
} from '@/lib/auth-token'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  user: UserOut | null
  status: AuthStatus
  /** Role flag for later admin-only UI (no admin screens yet). */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserOut | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  // Any 401 anywhere clears the session and returns to /login.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setUser(null)
      setStatus('unauthenticated')
      navigate('/login', { replace: true })
    })
  }, [navigate])

  // Restore the session on app load.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!getToken()) {
        setStatus('unauthenticated')
        return
      }
      try {
        const me = await getMe()
        if (!cancelled) {
          setUser(me)
          setStatus('authenticated')
        }
      } catch {
        // 401 handled by the unauthorized handler; any other failure also
        // means we can't trust the token → logged out.
        if (!cancelled) {
          clearToken()
          setUser(null)
          setStatus('unauthenticated')
        }
      }
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password)
    setToken(res.access_token)
    const me = await getMe()
    setUser(me)
    setStatus('authenticated')
  }, [])

  const register = useCallback(
    async (email: string, password: string) => {
      // Register returns the user (not a token), so log in afterwards.
      await apiRegister(email, password)
      await login(email, password)
    },
    [login],
  )

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setStatus('unauthenticated')
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <AuthContext.Provider
      value={{ user, status, isAdmin: user?.role === 'admin', login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] **Step 2: Create the hook**

Create `src/hooks/useAuth.ts`:

```ts
import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from '@/context/AuthContext'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: no errors. (If react-refresh flags the context export, the inline disable comment already handles it.)

- [ ] **Step 4: Commit**

```bash
git add src/context/AuthContext.tsx src/hooks/useAuth.ts
git commit -m "feat: auth context with session restore, login/register/logout"
```

---

### Task 6: Routing — router shell, guards, spinner, Workspace extraction

**Files:**
- Modify: `src/main.tsx` (wrap in `BrowserRouter` + `AuthProvider`)
- Rewrite: `src/App.tsx` (routes only)
- Create: `src/components/routing/ProtectedRoute.tsx`
- Create: `src/components/routing/PublicOnly.tsx`
- Create: `src/components/routing/FullScreenSpinner.tsx`
- Create: `src/components/workspace/Workspace.tsx` (the former App body, minus Agent/Embeddings tabs and model state)

**Interfaces:**
- Consumes: `useAuth` from `@/hooks/useAuth`; router primitives from `react-router-dom`; existing `Sidebar`/`Header`/`ChatPanel`/hooks.
- Produces: `<Workspace />`, `<ProtectedRoute>`, `<PublicOnly>`, `<FullScreenSpinner>`; `/login` and `/register` reachable only when logged out, everything else guarded.

- [ ] **Step 1: Full-screen spinner**

Create `src/components/routing/FullScreenSpinner.tsx`:

```tsx
import { Loader2 } from 'lucide-react'

export function FullScreenSpinner() {
  return (
    <div className="grid h-full place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
```

- [ ] **Step 2: Protected route guard**

Create `src/components/routing/ProtectedRoute.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullScreenSpinner } from './FullScreenSpinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 3: Public-only guard**

Create `src/components/routing/PublicOnly.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullScreenSpinner } from './FullScreenSpinner'

export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [ ] **Step 4: Extract `Workspace` from the old App (chat only)**

Create `src/components/workspace/Workspace.tsx`. This is the old `App.tsx` body with: Agent/Embeddings tabs removed, `Tabs` removed (single chat view), model state removed, and `useAuth` wired into the header:

```tsx
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useHealth } from '@/hooks/useHealth'
import { useConversations } from '@/hooks/useConversations'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_GENERATION, type GenerationConfig } from '@/lib/chat-config'
import { useState } from 'react'

export function Workspace() {
  const { theme, toggle } = useTheme()
  const health = useHealth()
  const conv = useConversations()
  const { user, logout } = useAuth()

  const [genConfig, setGenConfig] = useState<GenerationConfig>(DEFAULT_GENERATION)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            conversations={conv.conversations}
            activeId={conv.activeId}
            onSelect={conv.selectConversation}
            onCreate={conv.createConversation}
            onRename={conv.renameConversation}
            onDelete={conv.deleteConversation}
            onCollapse={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            health={health.health}
            reachable={health.reachable}
            loading={health.loading}
            error={health.error}
            theme={theme}
            onToggleTheme={toggle}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            email={user?.email ?? ''}
            role={user?.role ?? 'member'}
            onLogout={logout}
          />

          <div className="min-h-0 flex-1">
            <ChatPanel
              conversation={conv.active}
              genConfig={genConfig}
              onGenConfigChange={setGenConfig}
              reachable={health.reachable}
              actions={{
                addMessage: conv.addMessage,
                appendContent: conv.appendContent,
                updateMessage: conv.updateMessage,
              }}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 5: Rewrite `App.tsx` as routes**

Replace the entire contents of `src/App.tsx`:

```tsx
import { Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/components/auth/LoginPage'
import { RegisterPage } from '@/components/auth/RegisterPage'
import { ProtectedRoute } from '@/components/routing/ProtectedRoute'
import { PublicOnly } from '@/components/routing/PublicOnly'
import { Workspace } from '@/components/workspace/Workspace'

function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <RegisterPage />
          </PublicOnly>
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Workspace />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
```

Note: `LoginPage`/`RegisterPage` come from Task 7, and `Header`/`ChatPanel` prop changes come from Task 8 — so this task will not fully typecheck until Tasks 7 and 8 land. That's expected; run the typecheck gate at the end of Task 8. (Implement 6→7→8 back to back.)

- [ ] **Step 6: Wrap the app in the router + provider**

Replace `src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/context/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 7: Commit (compiles after Task 8)**

```bash
git add src/main.tsx src/App.tsx src/components/routing src/components/workspace
git commit -m "feat: router shell, auth route guards, chat-only workspace"
```

---

### Task 7: Auth pages — shell, login, register

**Files:**
- Create: `src/components/auth/AuthShell.tsx`
- Create: `src/components/auth/LoginPage.tsx`
- Create: `src/components/auth/RegisterPage.tsx`

**Interfaces:**
- Consumes: `useAuth`; `emailError`/`passwordError` from `@/lib/auth-validation`; `describeError` from `@/lib/api`; `Button`/`Input`/`Label` primitives; `Link`/`useNavigate` from `react-router-dom`.
- Produces: `<LoginPage />`, `<RegisterPage />`.

- [ ] **Step 1: Shared auth shell**

Create `src/components/auth/AuthShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Cpu } from 'lucide-react'

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="grid min-h-full place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Cpu className="size-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">{children}</div>
        <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Login page**

Create `src/components/auth/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { emailError, passwordError } from '@/lib/auth-validation'
import { describeError } from '@/lib/api'
import { AuthShell } from './AuthShell'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = { email: emailError(email) ?? undefined, password: passwordError(password) ?? undefined }
    setFieldErrors(errs)
    if (errs.email || errs.password) return

    setPending(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Local LLM Workspace"
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          {fieldErrors.email && (
            <p className="text-xs text-destructive">{fieldErrors.email}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
          />
          {fieldErrors.password && (
            <p className="text-xs text-destructive">{fieldErrors.password}</p>
          )}
        </div>

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" disabled={pending} className="mt-1">
          {pending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthShell>
  )
}
```

- [ ] **Step 3: Register page**

Create `src/components/auth/RegisterPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { emailError, passwordError } from '@/lib/auth-validation'
import { describeError } from '@/lib/api'
import { AuthShell } from './AuthShell'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = { email: emailError(email) ?? undefined, password: passwordError(password) ?? undefined }
    setFieldErrors(errs)
    if (errs.email || errs.password) return

    setPending(true)
    try {
      await register(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      title="Create account"
      subtitle="Local LLM Workspace"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          {fieldErrors.email && (
            <p className="text-xs text-destructive">{fieldErrors.email}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          {fieldErrors.password && (
            <p className="text-xs text-destructive">{fieldErrors.password}</p>
          )}
        </div>

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" disabled={pending} className="mt-1">
          {pending && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthShell>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/auth
git commit -m "feat: login and register pages with client-side validation"
```

---

### Task 8: Header user menu + chat model-picker removal

**Files:**
- Rewrite: `src/components/layout/Header.tsx` (drop the Tabs list; add email + role badge + logout dropdown)
- Modify: `src/components/chat/ChatPanel.tsx` (remove model `Select` + `models`/`model`/`onModelChange` props; send no `model`)

**Interfaces:**
- Consumes (Header): `email:string`, `role:'admin'|'member'`, `onLogout:()=>void` plus existing health/theme/sidebar props; `Badge`; `DropdownMenu*`.
- Produces (ChatPanel): new prop shape `{ conversation, genConfig, onGenConfigChange, reachable, actions }` (matches the call site written in Task 6 Workspace).

- [ ] **Step 1: Rewrite the Header**

Replace the entire contents of `src/components/layout/Header.tsx`:

```tsx
import { Cpu, LogOut, Moon, PanelLeft, Sun, User } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { HealthResponse } from '@/lib/api'
import type { Theme } from '@/hooks/useTheme'

interface HeaderProps {
  health: HealthResponse | null
  reachable: boolean
  loading: boolean
  error: string | null
  theme: Theme
  onToggleTheme: () => void
  sidebarOpen: boolean
  onOpenSidebar: () => void
  email: string
  role: 'admin' | 'member'
  onLogout: () => void
}

export function Header({
  health,
  reachable,
  loading,
  error,
  theme,
  onToggleTheme,
  sidebarOpen,
  onOpenSidebar,
  email,
  role,
  onLogout,
}: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      {!sidebarOpen && (
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
          <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <Cpu className="size-3.5" />
          </div>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Ollama Workspace
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <StatusDot health={health} reachable={reachable} loading={loading} error={error} />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm transition-colors hover:border-primary"
          >
            <User className="size-4 text-muted-foreground" />
            <span className="hidden max-w-40 truncate sm:inline">{email}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <div className="flex flex-col gap-1 px-2 py-1.5">
              <span className="truncate text-sm font-medium">{email}</span>
              <Badge
                variant={role === 'admin' ? 'default' : 'outline'}
                className="w-fit capitalize"
              >
                {role}
              </Badge>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Remove the model picker from ChatPanel**

Edit `src/components/chat/ChatPanel.tsx`:

(a) Remove the `Select`/`ModelInfo` imports. New import block for the top:

```tsx
import { useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { describeError, streamChat, type ChatMessage } from '@/lib/api'
import { toOllamaOptions, type GenerationConfig } from '@/lib/chat-config'
import type { Conversation, UIMessage } from '@/hooks/useConversations'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { GenerationSettings } from './GenerationSettings'
```

(b) Replace the `ChatPanelProps` interface and the component signature to drop `models`/`model`/`onModelChange`:

```tsx
interface ChatPanelProps {
  conversation: Conversation
  genConfig: GenerationConfig
  onGenConfigChange: (config: GenerationConfig) => void
  reachable: boolean
  actions: ChatActions
}

export function ChatPanel({
  conversation,
  genConfig,
  onGenConfigChange,
  reachable,
  actions,
}: ChatPanelProps) {
```

(c) In `handleSend`, drop `model` from the `streamChat` call:

```tsx
      for await (const chunk of streamChat(
        { messages: payloadMessages, options: toOllamaOptions(genConfig) },
        controller.signal,
      )) {
```

(d) Replace the toolbar row (the `<div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">` block containing the `Select`) with a toolbar that keeps only the generation settings:

```tsx
      <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
        <span className="text-xs text-muted-foreground">
          Model: <span className="font-mono">server default</span>
        </span>
        <div className="ml-auto">
          <GenerationSettings value={genConfig} onChange={onGenConfigChange} />
        </div>
      </div>
```

Leave the rest of ChatPanel (offline banner, `MessageList`, `Composer`) unchanged.

- [ ] **Step 3: Typecheck the whole app (Tasks 6–8 together)**

Run: `npx tsc -b`
Expected: no errors. Fix any unused-import/unused-var fallout (`noUnusedLocals`/`noUnusedParameters`).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Header.tsx src/components/chat/ChatPanel.tsx
git commit -m "feat: header account menu + logout; drop unsupported model picker"
```

---

### Task 9: Full verification — build, tests, manual smoke against the gateway

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS (auth-token, auth-validation, api client, existing ndjson/cosine).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc -b` clean + Vite build succeeds.

- [ ] **Step 3: Ensure the gateway is running**

Check: `curl -s http://localhost:8000/health` returns JSON.
If not up: `cd /home/manoj/newlaptop/projects/python/local-ai-model-gateway && .venv/bin/uvicorn app.main:app --reload`
(Note: the older `local-ai-model` prototype also defaults to :8000 — make sure only the gateway is bound to 8000.)

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`, open the app. Verify, in order:
1. Visiting any path while logged out → redirected to `/login`.
2. Register a NEW email (≥8-char password) → auto-logged-in → lands on the workspace; a too-short password shows the inline error without calling the server; a duplicate email shows "Email already registered".
3. Log out → back at `/login`; token gone from localStorage (DevTools → Application).
4. Log in with `admin@example.com` / `supersecret123` → workspace; header shows the email and an `admin` role badge.
5. Send a chat message → tokens stream in (NDJSON), assistant bubble fills live, meta populates on `done`.
6. Reload the page → session restored via `/users/me` (no flash of the login page beyond the brief spinner).
7. Simulate expiry: in DevTools set the `ollama-workspace-token` value to `garbage`, reload → `/users/me` 401 → redirected to `/login`, token cleared.
8. `/register` and `/login` while logged in → redirected to `/`.

- [ ] **Step 5: Final commit (if any verification-driven fixes were made)**

```bash
git add -A
git commit -m "test: verify auth + gateway chat end to end"
```

---

## Self-Review

**Spec coverage:**
- Base URL from env, default 8000 → Task 1/Task 4 (`API_BASE`, `.env.example`). ✓
- One typed client, base prefix, bearer on every request, 401 → clear+`/login` → Task 4 (`rawFetch`). ✓
- Plain fetch, no `credentials:"include"` → Task 4 (no credentials set). ✓
- register/login/getMe contracts (201/409, token shape, UserOut) → Task 4 types + methods. ✓
- Login/Register pages, email + password validation (≥8) → Tasks 3 + 7. ✓
- Store token in memory + localStorage, redirect on login → Tasks 2 + 5 + 7. ✓
- Session restore via `/users/me`, 401 → clear + login → Task 5. ✓
- Protected routing (`/login`, `/register` only when logged out) → Task 6 guards. ✓
- Header with email + logout (client-only) → Task 8. ✓
- Show role, admin vs member flag → Task 5 (`isAdmin`) + Task 8 (badge). ✓
- Chat POST `/v1/chat` bearer, running messages array with prior assistant turns → existing ChatPanel history logic (preserved) + Task 4/8. ✓
- NDJSON streaming reader, `message.content`, `done:true` → existing `readNdjson`/`streamChat` (preserved) + Task 4. ✓
- Error mapping 401/404/502/detail → Task 4 `describeError`. ✓
- Do NOT build agent/file-gen/history; structure send-path for future `/v1/agent` → Task 6/8 (agent code unmounted; `streamChat` params object is the seam a future `runAgent` mirrors). ✓
- Match framework/styling/folder conventions, no new UI library → all tasks use existing Vite/Tailwind/shadcn primitives; only `react-router-dom` (routing, not UI) added, per approved decision. ✓

**Placeholder scan:** none — every step has concrete code or a concrete command.

**Type consistency:** `UserOut`/`TokenResponse`/`AuthContextValue`/`AuthStatus` names match across Tasks 4/5/6/8; `role:'admin'|'member'` consistent; Header prop shape in Task 8 matches the Workspace call site in Task 6; ChatPanel prop shape in Task 8 matches the Workspace call site in Task 6.

**Note on build ordering:** Tasks 6, 7, 8 are interdependent (App imports auth pages from 7 and the new Header/ChatPanel shapes from 8). Implement 6→7→8 consecutively and run the typecheck gate at the end of Task 8; earlier per-task commits may not typecheck standalone, which is expected and called out in Task 6 Step 5.
```
