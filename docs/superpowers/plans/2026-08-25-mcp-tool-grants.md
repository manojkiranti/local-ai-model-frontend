# Per-User MCP Tool Grants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give gateway admins a UI to grant and revoke the six per-user MCP
grants, so access can be provisioned at cutover without `curl`.

**Architecture:** A per-user detail route (`/admin/users/:id`) reached from the
existing admin Users directory. A pure vocabulary module owns the six strings
and their human copy; a hook owns the grant list for one user and serialises
writes; a presentational panel renders three system groups. The gateway stays
authoritative — the client renders grants, never tools.

**Tech Stack:** Vite 8, React 19, TypeScript 6, React Router 7, Tailwind v4,
Vitest 4 + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-mcp-tool-grants-design.md`

## Global Constraints

- **The vocabulary is exactly six strings.** Roles: `mcp-hrms`, `mcp-izone`,
  `mcp-ems`. Permissions: `mcp.hrms.full`, `mcp.hrms.tasks`, `mcp.ems.query`.
  Copy them verbatim; a typo is a 422.
- **No tool -> grant map anywhere in the frontend.** Which tools a grant unlocks
  is the MCP server's decision. Descriptions are human copy, never logic.
- **Never render "granted just now".** POST is idempotent and deliberately does
  not rewrite `granted_at`; always render the timestamp the response carries.
- **Never infer prior state from a DELETE.** 204 comes back whether or not a row
  existed.
- **Only 401 clears the token.** A 403 is a policy refusal from a signed-in
  caller: render `detail` verbatim, keep the page, do not retry, never redirect.
- **A global admin holds no grant implicitly.** Never hide or pre-tick controls
  on an admin's own row; never imply admins have everything.
- **Request body is exactly `{ grant_key }`.** The gateway sets `extra="forbid"`.
- Style: single quotes, no semicolons, trailing commas, `@/…` imports,
  functional components, semantic Tailwind tokens (`bg-card`, `text-primary`,
  `text-muted-foreground`, `text-destructive`), `cn()` from `@/lib/utils`.
- Tests: `.test.ts` for pure logic/hooks/API, `.test.tsx` only for rendered
  output. Vitest runs **without** `globals`, so every `.test.tsx` that renders
  more than once MUST call `cleanup()` in `afterEach`. `@testing-library/jest-dom`
  is NOT installed — use plain matchers (`expect(el.disabled).toBe(true)`,
  `expect(el).not.toBeNull()`). `user-event` is NOT installed — use `fireEvent`.
- Full verification: `npm run test && npm run lint && npm run build`.

---

### Task 1: Stop 422 validation errors from being swallowed

FastAPI returns `{"detail": [{loc, msg, type}, ...]}` — a **list**.
`errorFromResponse` only reads `detail` when it is a string, so the gateway's
`unknown grant: 'x'; expected one of [...]` degrades to
`Request failed (HTTP 422)`. Fix it once, in the shared error path.

**Files:**
- Modify: `src/lib/api.ts` (`errorFromResponse`, around line 283)
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `errorFromResponse(res: Response): Promise<GatewayError>` — unchanged
  signature; a list-shaped `detail` now yields its `msg` strings joined with
  `'; '`. String-shaped `detail` behaviour is unchanged.

- [ ] **Step 1: Write the failing tests**

Add `errorFromResponse` to the existing import block at the top of
`src/lib/api.test.ts`, then append this describe block at the end of the file:

```ts
// FastAPI validation errors are a LIST of {loc, msg, type}, not a string. The
// gateway's grant route relies on that shape to name an unknown grant key.
describe('errorFromResponse', () => {
  it('flattens a FastAPI validation array into its messages', async () => {
    const err = await errorFromResponse(
      jsonResponse(
        {
          detail: [
            {
              loc: ['body', 'grant_key'],
              msg: "Value error, unknown grant: 'nope'; expected one of ['mcp-ems']",
              type: 'value_error',
            },
          ],
        },
        422,
      ),
    )
    expect(err.status).toBe(422)
    expect(err.message).toBe(
      "Value error, unknown grant: 'nope'; expected one of ['mcp-ems']",
    )
  })

  it('joins several validation messages', async () => {
    const err = await errorFromResponse(
      jsonResponse(
        { detail: [{ msg: 'field required' }, { msg: 'extra fields not permitted' }] },
        422,
      ),
    )
    expect(err.message).toBe('field required; extra fields not permitted')
  })

  it('keeps a string detail exactly as the gateway sent it', async () => {
    const err = await errorFromResponse(jsonResponse({ detail: 'Unknown user' }, 404))
    expect(err.message).toBe('Unknown user')
  })

  it('falls back to the generic message for a detail it cannot read', async () => {
    const err = await errorFromResponse(jsonResponse({ detail: { nested: true } }, 500))
    expect(err.message).toBe('Request failed (HTTP 500)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/api.test.ts -t errorFromResponse`
Expected: the first two FAIL with the received message being
`Request failed (HTTP 422)`. The last two already PASS — they are regression
guards for behaviour that must not move.

- [ ] **Step 3: Implement the list branch**

Replace the body of `errorFromResponse` in `src/lib/api.ts`:

```ts
export async function errorFromResponse(res: Response): Promise<GatewayError> {
  let detail = `Request failed (HTTP ${res.status})`
  try {
    const data = await res.json()
    if (data && typeof data.detail === 'string') {
      detail = data.detail
    } else if (data && Array.isArray(data.detail)) {
      // FastAPI validation errors arrive as a LIST of {loc, msg, type}. Without
      // this branch a 422 loses the gateway's message — which is exactly the
      // one naming an unknown grant key and listing the valid set.
      const messages = data.detail
        .map((item: unknown) =>
          item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string'
            ? (item as { msg: string }).msg
            : null,
        )
        .filter((msg: string | null): msg is string => msg !== null)
      if (messages.length > 0) detail = messages.join('; ')
    }
  } catch {
    // Body wasn't JSON; keep the generic message.
  }
  return new GatewayError(res.status, detail)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS, including every pre-existing test in the file — the string
branch must not have moved.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "fix(api): surface FastAPI validation detail instead of a generic 422"
```

---

### Task 2: MCP grant types and transport

**Files:**
- Modify: `src/lib/api.ts` (append a new section after the department members
  section, before the NRB section)
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Consumes: `rawFetch`, `request`, `errorFromResponse` (module-private helpers
  already in `api.ts`)
- Produces:
  - `type McpGrantKey = 'mcp-hrms' | 'mcp-izone' | 'mcp-ems' | 'mcp.hrms.full' | 'mcp.hrms.tasks' | 'mcp.ems.query'`
  - `interface McpGrant { grant_key: string; granted_at: string; granted_by: number | null }`
  - `interface McpGrantList { user_id: number; items: McpGrant[] }`
  - `listMcpGrants(userId: number, signal?: AbortSignal): Promise<McpGrantList>`
  - `grantMcpGrant(userId: number, key: McpGrantKey, signal?: AbortSignal): Promise<McpGrantList>`
  - `revokeMcpGrant(userId: number, grantKey: string, signal?: AbortSignal): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Add `GatewayError, listMcpGrants, grantMcpGrant, revokeMcpGrant` to the import
block in `src/lib/api.test.ts` (`GatewayError` is already imported), then append:

```ts
describe('MCP grant routes', () => {
  const list = {
    user_id: 42,
    items: [
      { grant_key: 'mcp-hrms', granted_at: '2026-08-25T08:31:27.259932+05:45', granted_by: 661 },
    ],
  }

  beforeEach(() => setToken('tok.grants'))
  afterEach(() => {
    vi.restoreAllMocks()
    clearToken()
  })

  it('GETs the grants for one user', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(list))
    const got = await listMcpGrants(42)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8000/v1/users/42/mcp-grants',
    )
    expect(got.items[0].grant_key).toBe('mcp-hrms')
  })

  // extra="forbid" on the gateway: anything but grant_key is a 422.
  it('POSTs exactly { grant_key } and returns the full list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(list, 201))
    const got = await grantMcpGrant(42, 'mcp-hrms')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:8000/v1/users/42/mcp-grants')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({ grant_key: 'mcp-hrms' })
    expect(got.items).toHaveLength(1)
  })

  it('DELETEs an encoded grant key and resolves void on 204', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await expect(revokeMcpGrant(42, 'mcp.ems.query')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'http://localhost:8000/v1/users/42/mcp-grants/mcp.ems.query',
    )
    expect(init!.method).toBe('DELETE')
  })

  // A 403 means "signed in, not an admin" — a policy refusal, not an expired
  // session. It must reach the caller with the gateway's wording and MUST NOT
  // clear the token or fire the unauthorized handler.
  it('keeps the session on a 403 and surfaces the detail verbatim', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Admin privileges required' }, 403),
    )
    await expect(grantMcpGrant(42, 'mcp-ems')).rejects.toMatchObject({
      status: 403,
      message: 'Admin privileges required',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(getToken()).toBe('tok.grants')
  })

  it('clears the session on a 401', async () => {
    const onUnauthorized = vi.fn()
    registerUnauthorizedHandler(onUnauthorized)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Could not validate credentials' }, 401),
    )
    await expect(listMcpGrants(42)).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalled()
    expect(getToken()).toBeNull()
  })

  it('surfaces a 404 for an unknown user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Unknown user' }, 404),
    )
    await expect(listMcpGrants(999)).rejects.toMatchObject({
      status: 404,
      message: 'Unknown user',
    })
  })

  it('surfaces the flattened 422 when a grant key is unknown to the gateway', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { detail: [{ msg: "Value error, unknown grant: 'mcp-nope'" }] },
        422,
      ),
    )
    await expect(
      grantMcpGrant(42, 'mcp-hrms'),
    ).rejects.toMatchObject({ status: 422, message: "Value error, unknown grant: 'mcp-nope'" })
  })

  it('revoke rejects on a non-2xx rather than resolving silently', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Unknown user' }, 404),
    )
    await expect(revokeMcpGrant(999, 'mcp-hrms')).rejects.toBeInstanceOf(GatewayError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/api.test.ts -t "MCP grant routes"`
Expected: FAIL — `listMcpGrants is not a function` (the module has no such
export yet).

- [ ] **Step 3: Implement the transport**

Append to `src/lib/api.ts`, immediately after `revokeDepartmentMember` and
before the NRB section:

```ts
// --------------------------------------------------------------------------- //
// Per-user MCP tool grants (admin only). Three roles name a SYSTEM the user may
// touch, three permissions name a SHARP EDGE inside one. Neither implies the
// other, and a global admin holds NOTHING implicitly — that is deliberate, so
// operating the gateway does not confer salary data and an expenses SQL console.
//
// The gateway does not hold a tool -> grant map and neither does this client:
// the MCP server decides which tools a grant unlocks, and a second copy drifts
// silently in the worst direction.
// --------------------------------------------------------------------------- //
/** The six strings the gateway accepts. Send only these. */
export type McpGrantKey =
  | 'mcp-hrms'
  | 'mcp-izone'
  | 'mcp-ems'
  | 'mcp.hrms.full'
  | 'mcp.hrms.tasks'
  | 'mcp.ems.query'

export interface McpGrant {
  /**
   * Deliberately `string`, not `McpGrantKey`. The gateway and this client deploy
   * independently, and `McpIdentity.from_grants` already tolerates a key a given
   * build does not define. Dropping an unrecognised key here would hide a grant
   * the user actually holds — a lost capability with no error on either side.
   */
  grant_key: string
  granted_at: string
  /** The admin who granted it. Never rewritten by a re-grant: it is the audit fact. */
  granted_by: number | null
}

export interface McpGrantList {
  user_id: number
  items: McpGrant[]
}

/** 403 when the caller is not an admin, 404 for an unknown user. */
export async function listMcpGrants(
  userId: number,
  signal?: AbortSignal,
): Promise<McpGrantList> {
  return request<McpGrantList>(`/v1/users/${userId}/mcp-grants`, { method: 'GET' }, signal)
}

/**
 * Grant one key. Idempotent: re-granting is a 201 with the SAME list and an
 * UNTOUCHED `granted_at`/`granted_by`, never a 409. Render the returned
 * timestamp — never "granted just now".
 *
 * The body is exactly `{ grant_key }`; the gateway sets `extra="forbid"`.
 */
export async function grantMcpGrant(
  userId: number,
  key: McpGrantKey,
  signal?: AbortSignal,
): Promise<McpGrantList> {
  return request<McpGrantList>(
    `/v1/users/${userId}/mcp-grants`,
    { method: 'POST', body: JSON.stringify({ grant_key: key }) },
    signal,
  )
}

/**
 * Revoke one key. 204 with an empty body whether or not a row existed, so a
 * success says NOTHING about whether the user previously held it.
 *
 * Takes `string`, not `McpGrantKey`, so a key this build does not recognise
 * stays revocable.
 */
export async function revokeMcpGrant(
  userId: number,
  grantKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawFetch(
    `/v1/users/${userId}/mcp-grants/${encodeURIComponent(grantKey)}`,
    { method: 'DELETE' },
    signal,
  )
  if (!res.ok) throw await errorFromResponse(res)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS.

Note on the DELETE URL assertion: `encodeURIComponent('mcp.ems.query')` leaves
dots untouched, so the asserted URL is the literal key. The call is kept for
keys that might contain characters needing escaping.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api.test.ts
git commit -m "feat(api): add the admin MCP grant routes"
```

---

### Task 3: The vocabulary and its copy

The client's only copy of the six strings, their grouping, and their
human-facing descriptions — the same role `department-scopes.ts` plays for
department levels.

**Files:**
- Create: `src/lib/mcp-grants.ts`
- Test: `src/lib/mcp-grants.test.ts`

**Interfaces:**
- Consumes: `McpGrant`, `McpGrantKey` from `@/lib/api`
- Produces:
  - `interface McpGrantCopy { key: McpGrantKey; label: string; description: string; sharp?: boolean }`
  - `interface McpSystem { id: string; name: string; role: McpGrantCopy; permissions: McpGrantCopy[] }`
  - `const MCP_SYSTEMS: readonly McpSystem[]`
  - `holds(items: McpGrant[], key: string): boolean`
  - `grantFor(items: McpGrant[], key: string): McpGrant | undefined`
  - `isKnownGrant(key: string): key is McpGrantKey`
  - `unknownGrants(items: McpGrant[]): McpGrant[]`
  - `requiredRoleFor(key: string): McpGrantKey | null`
  - `orphanedPermissions(items: McpGrant[]): McpGrantKey[]`
  - `formatGrantedAt(iso: string): string`
  - `exposedToolsHint(tools: string[]): string | null`
  - `const NO_TOOLS_HINT: string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mcp-grants.test.ts`. The ten fixtures are the spec's eval set.

```ts
import { describe, expect, it } from 'vitest'
import type { McpGrant } from '@/lib/api'
import {
  exposedToolsHint,
  formatGrantedAt,
  grantFor,
  holds,
  isKnownGrant,
  MCP_SYSTEMS,
  NO_TOOLS_HINT,
  orphanedPermissions,
  requiredRoleFor,
  unknownGrants,
} from '@/lib/mcp-grants'

function grants(...keys: string[]): McpGrant[] {
  return keys.map((grant_key) => ({
    grant_key,
    granted_at: '2026-08-25T08:31:27.259932+05:45',
    granted_by: 661,
  }))
}

describe('MCP_SYSTEMS', () => {
  it('covers the three systems in display order', () => {
    expect(MCP_SYSTEMS.map((system) => system.role.key)).toEqual([
      'mcp-hrms',
      'mcp-izone',
      'mcp-ems',
    ])
  })

  it('covers exactly the six strings the gateway accepts', () => {
    const keys = MCP_SYSTEMS.flatMap((system) => [
      system.role.key,
      ...system.permissions.map((permission) => permission.key),
    ])
    expect([...keys].sort()).toEqual([
      'mcp-ems',
      'mcp-hrms',
      'mcp-izone',
      'mcp.ems.query',
      'mcp.hrms.full',
      'mcp.hrms.tasks',
    ])
  })

  it('marks the two sharp permissions and nothing else', () => {
    const sharp = MCP_SYSTEMS.flatMap((system) =>
      system.permissions.filter((permission) => permission.sharp).map((p) => p.key),
    )
    expect([...sharp].sort()).toEqual(['mcp.ems.query', 'mcp.hrms.full'])
  })

  it('gives iZone no permissions of its own', () => {
    const izone = MCP_SYSTEMS.find((system) => system.role.key === 'mcp-izone')!
    expect(izone.permissions).toEqual([])
  })
})

describe('holds / grantFor / isKnownGrant', () => {
  it('reads a held key and its row', () => {
    const items = grants('mcp-hrms')
    expect(holds(items, 'mcp-hrms')).toBe(true)
    expect(holds(items, 'mcp-ems')).toBe(false)
    expect(grantFor(items, 'mcp-hrms')!.granted_by).toBe(661)
    expect(grantFor(items, 'mcp-ems')).toBeUndefined()
  })

  it('recognises only the six strings', () => {
    expect(isKnownGrant('mcp.hrms.full')).toBe(true)
    expect(isKnownGrant('mcp-future-thing')).toBe(false)
    expect(isKnownGrant('MCP-HRMS')).toBe(false)
  })
})

describe('requiredRoleFor', () => {
  it('pairs each permission with the role it needs', () => {
    expect(requiredRoleFor('mcp.hrms.full')).toBe('mcp-hrms')
    expect(requiredRoleFor('mcp.hrms.tasks')).toBe('mcp-hrms')
    expect(requiredRoleFor('mcp.ems.query')).toBe('mcp-ems')
  })

  it('returns null for a role, and for anything unknown', () => {
    expect(requiredRoleFor('mcp-hrms')).toBeNull()
    expect(requiredRoleFor('mcp-future-thing')).toBeNull()
  })
})

// The spec's ten labelled fixtures. A permission held WITHOUT its role is the
// only state that warns; a role held without its permission is complete and
// common, and must stay silent.
describe('orphanedPermissions', () => {
  it('1. no grants at all', () => {
    expect(orphanedPermissions(grants())).toEqual([])
  })

  it('2. a role on its own does not warn', () => {
    expect(orphanedPermissions(grants('mcp-hrms'))).toEqual([])
  })

  it('3. mcp-hrms + mcp.hrms.full is a complete pair', () => {
    expect(orphanedPermissions(grants('mcp-hrms', 'mcp.hrms.full'))).toEqual([])
  })

  it('4. mcp-hrms + mcp.hrms.tasks is a complete pair', () => {
    expect(orphanedPermissions(grants('mcp-hrms', 'mcp.hrms.tasks'))).toEqual([])
  })

  it('5. mcp.hrms.tasks alone is orphaned', () => {
    expect(orphanedPermissions(grants('mcp.hrms.tasks'))).toEqual(['mcp.hrms.tasks'])
  })

  it('6. mcp.hrms.full alone is orphaned', () => {
    expect(orphanedPermissions(grants('mcp.hrms.full'))).toEqual(['mcp.hrms.full'])
  })

  it('7. mcp-ems on its own does not warn', () => {
    expect(orphanedPermissions(grants('mcp-ems'))).toEqual([])
  })

  it('8. mcp.ems.query alone is orphaned', () => {
    expect(orphanedPermissions(grants('mcp.ems.query'))).toEqual(['mcp.ems.query'])
  })

  it('9. mcp-ems + mcp.ems.query is a complete pair', () => {
    expect(orphanedPermissions(grants('mcp-ems', 'mcp.ems.query'))).toEqual([])
  })

  it('10. an unknown key is routed aside and never warns', () => {
    const items = grants('mcp-izone', 'mcp-future-thing')
    expect(orphanedPermissions(items)).toEqual([])
    expect(unknownGrants(items).map((item) => item.grant_key)).toEqual(['mcp-future-thing'])
  })
})

describe('formatGrantedAt', () => {
  it('renders an absolute date, never a relative one', () => {
    expect(formatGrantedAt('2026-08-25T12:00:00Z')).toBe('25 Aug 2026')
  })

  it('returns the raw value rather than "Invalid Date"', () => {
    expect(formatGrantedAt('not-a-date')).toBe('not-a-date')
  })
})

describe('exposedToolsHint', () => {
  it('names the empty-grant state when only the freebie tool is exposed', () => {
    expect(exposedToolsHint(['get_server_time'])).toBe(NO_TOOLS_HINT)
    expect(exposedToolsHint([])).toBe(NO_TOOLS_HINT)
  })

  it('says nothing once a business tool is exposed', () => {
    expect(exposedToolsHint(['get_server_time', 'hrms_list_employees'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/mcp-grants.test.ts`
Expected: FAIL — cannot resolve `@/lib/mcp-grants`.

- [ ] **Step 3: Implement the module**

Create `src/lib/mcp-grants.ts`:

```ts
import type { McpGrant, McpGrantKey } from '@/lib/api'

/**
 * The client's only copy of the MCP grant vocabulary — the same role
 * `department-scopes.ts` plays for department levels. The gateway holds the
 * authoritative copy and remains the security boundary either way.
 *
 * WHAT IS DELIBERATELY NOT HERE: a tool -> grant map. The MCP server applies
 * `canAccess` at session construction, so its own tool list is already exactly
 * what an identity may call. A second copy here would drift, and the dangerous
 * direction is silent.
 *
 * The descriptions below ARE copy: they tell an admin what they are handing
 * over. They never gate a control and never shape a request.
 */

/** One grantable string plus the sentence an admin reads before granting it. */
export interface McpGrantCopy {
  key: McpGrantKey
  label: string
  description: string
  /** Salary data, or SQL over the whole expenses database. Rendered distinctly. */
  sharp?: boolean
}

export interface McpSystem {
  id: string
  name: string
  role: McpGrantCopy
  permissions: McpGrantCopy[]
}

export const MCP_SYSTEMS: readonly McpSystem[] = [
  {
    id: 'hrms',
    name: 'HRMS — staff directory',
    role: {
      key: 'mcp-hrms',
      label: 'Staff directory',
      description:
        'List employees and departments, and look up an employee (11-field summary).',
    },
    permissions: [
      {
        key: 'mcp.hrms.full',
        label: 'Full employee record',
        sharp: true,
        description:
          'Adds all 80+ fields to a lookup, including Salary_Level. Without it a lookup still works and says full detail was withheld.',
      },
      {
        key: 'mcp.hrms.tasks',
        label: 'Pending approvals',
        description:
          'Pending approval counts per employee: resignation, personal, home and vehicle loans, salary advances.',
      },
    ],
  },
  {
    id: 'izone',
    name: 'iZone — SharePoint intranet',
    role: {
      key: 'mcp-izone',
      label: 'iZone access',
      description:
        'All four iZone tools: lists, list items, documents and country circulars.',
    },
    permissions: [],
  },
  {
    id: 'ems',
    name: 'Expenses (EMS)',
    role: {
      key: 'mcp-ems',
      label: 'Schema discovery',
      description: 'List the expense database tables and their columns. No data access.',
    },
    permissions: [
      {
        key: 'mcp.ems.query',
        label: 'SQL console',
        sharp: true,
        description:
          'Free-form read-only SQL against the entire expenses database.',
      },
    ],
  },
]

/** Permission -> the role it needs to have any effect.
 *
 *  This is COPY, not enforcement: it only decides whether a sentence renders. It
 *  never disables a control, never blocks a grant, never alters a request. The
 *  MCP server owns the real pairing, so drift here means a stale hint — never a
 *  UI that refuses what the server allows, or offers what it refuses. */
const REQUIRED_ROLE: Readonly<Record<string, McpGrantKey>> = {
  'mcp.hrms.full': 'mcp-hrms',
  'mcp.hrms.tasks': 'mcp-hrms',
  'mcp.ems.query': 'mcp-ems',
}

const KNOWN_KEYS: readonly string[] = MCP_SYSTEMS.flatMap((system) => [
  system.role.key,
  ...system.permissions.map((permission) => permission.key),
])

export function isKnownGrant(key: string): key is McpGrantKey {
  return KNOWN_KEYS.includes(key)
}

export function holds(items: McpGrant[], key: string): boolean {
  return items.some((item) => item.grant_key === key)
}

export function grantFor(items: McpGrant[], key: string): McpGrant | undefined {
  return items.find((item) => item.grant_key === key)
}

/** Keys this build does not recognise. Shown so they stay revocable rather than
 *  vanishing from a UI that pretends the user does not hold them. */
export function unknownGrants(items: McpGrant[]): McpGrant[] {
  return items.filter((item) => !isKnownGrant(item.grant_key))
}

export function requiredRoleFor(key: string): McpGrantKey | null {
  return REQUIRED_ROLE[key] ?? null
}

/**
 * Permissions the user holds whose role they do NOT hold — the state a
 * well-meaning admin lands in by granting the permission alone.
 *
 * One direction only. A role without its permission is a complete, valid and
 * common state and must stay silent.
 */
export function orphanedPermissions(items: McpGrant[]): McpGrantKey[] {
  return items
    .map((item) => item.grant_key)
    .filter(isKnownGrant)
    .filter((key) => {
      const role = requiredRoleFor(key)
      return role !== null && !holds(items, role)
    })
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Absolute, never relative. A re-grant returns the ORIGINAL `granted_at` on
 * purpose — that is the audit fact — so "3 weeks ago" after a re-grant would be
 * correct and still read as a bug. Formatted by hand rather than through
 * `toLocaleDateString` so the output does not depend on the runtime's ICU data.
 */
export function formatGrantedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export const NO_TOOLS_HINT =
  'No business systems are enabled for your account. Ask an admin for access.'

/**
 * Copy for the status badge when a caller's exposed tool list looks like "zero
 * grants". The threshold encodes one assumption — that no grants yields exactly
 * the server-clock tool — and it selects COPY ONLY, never capability. The real
 * tool names are rendered beside it, so a wrong guess sits next to the truth.
 */
export function exposedToolsHint(tools: string[]): string | null {
  return tools.length <= 1 ? NO_TOOLS_HINT : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/mcp-grants.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp-grants.ts src/lib/mcp-grants.test.ts
git commit -m "feat(mcp): add the grant vocabulary, copy and dependency hint"
```

---

### Task 4: The grants hook

**Files:**
- Create: `src/hooks/useMcpGrants.ts`
- Test: `src/hooks/useMcpGrants.test.ts`

**Interfaces:**
- Consumes: `listMcpGrants`, `grantMcpGrant`, `revokeMcpGrant`, `describeError`,
  `McpGrant`, `McpGrantKey` from `@/lib/api`
- Produces: `useMcpGrants(userId: number)` returning
  `{ items: McpGrant[]; loading: boolean; error: string | null; busy: string | null; grant: (key: McpGrantKey) => Promise<void>; revoke: (key: string) => Promise<void> }`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useMcpGrants.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listMcpGrants: vi.fn(),
    grantMcpGrant: vi.fn(),
    revokeMcpGrant: vi.fn(),
  }
})

import {
  GatewayError,
  grantMcpGrant,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
} from '@/lib/api'
import { useMcpGrants } from '@/hooks/useMcpGrants'

const mockList = vi.mocked(listMcpGrants)
const mockGrant = vi.mocked(grantMcpGrant)
const mockRevoke = vi.mocked(revokeMcpGrant)

const ORIGINAL = '2026-08-01T09:00:00Z'

function grant(key: string, granted_at = ORIGINAL): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function list(items: McpGrant[]) {
  return { user_id: 42, items }
}

describe('useMcpGrants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue(list([]))
    mockGrant.mockResolvedValue(list([grant('mcp-hrms')]))
    mockRevoke.mockResolvedValue(undefined)
  })

  it('loads the grants for the given user', async () => {
    mockList.mockResolvedValue(list([grant('mcp-izone')]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith(42, expect.any(AbortSignal))
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-izone'])
  })

  it('replaces the list with whatever the POST returns', async () => {
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.grant('mcp-hrms')
    })
    expect(mockGrant).toHaveBeenCalledWith(42, 'mcp-hrms')
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-hrms'])
  })

  // POST is idempotent and does NOT rewrite granted_at. The hook must keep what
  // the server sent rather than stamping "now".
  it('keeps the original granted_at when a grant is re-granted', async () => {
    mockList.mockResolvedValue(list([grant('mcp-hrms', ORIGINAL)]))
    mockGrant.mockResolvedValue(list([grant('mcp-hrms', ORIGINAL)]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.grant('mcp-hrms')
    })
    expect(result.current.items[0].granted_at).toBe(ORIGINAL)
  })

  it('drops a key locally once the DELETE has resolved', async () => {
    mockList.mockResolvedValue(list([grant('mcp-ems'), grant('mcp.ems.query')]))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.revoke('mcp.ems.query')
    })
    expect(mockRevoke).toHaveBeenCalledWith(42, 'mcp.ems.query')
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-ems'])
  })

  it('leaves the row in place when a revoke fails', async () => {
    mockList.mockResolvedValue(list([grant('mcp-ems')]))
    mockRevoke.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.revoke('mcp-ems')
    })
    expect(result.current.items.map((item) => item.grant_key)).toEqual(['mcp-ems'])
    expect(result.current.error).toBe('Admin privileges required')
  })

  it('surfaces a 403 on load as an error string, not a thrown value', async () => {
    mockList.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Admin privileges required')
    expect(result.current.items).toEqual([])
  })

  // Every POST returns the WHOLE list, so two writes in flight can resolve out
  // of order and the loser's list overwrites the winner's. One at a time.
  it('refuses a second write while one is in flight', async () => {
    let release: (() => void) | null = null
    mockGrant.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(list([grant('mcp-hrms')]))
        }),
    )
    const { result } = renderHook(() => useMcpGrants(42))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.grant('mcp-hrms')
    })
    await waitFor(() => expect(result.current.busy).toBe('mcp-hrms'))
    await act(async () => {
      await result.current.grant('mcp-ems')
    })
    expect(mockGrant).toHaveBeenCalledTimes(1)

    await act(async () => {
      release!()
      await first
    })
    expect(result.current.busy).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useMcpGrants.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useMcpGrants`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useMcpGrants.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeError,
  grantMcpGrant,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
  type McpGrantKey,
} from '@/lib/api'

/**
 * The MCP grants held by ONE user, for the admin screen.
 *
 * Writes are serialised — one in flight at a time. That is a correctness
 * requirement, not a nicety: every POST returns the WHOLE list, so two
 * concurrent writes can resolve out of order and the loser's list silently
 * overwrites the winner's.
 *
 * State changes only after the server has confirmed. Nothing is applied
 * optimistically, so a failed write needs no rollback.
 */
export function useMcpGrants(userId: number) {
  const [items, setItems] = useState<McpGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // Intentional: the flag flips before the request, and the rest of the state
    // is written after it resolves — not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    listMcpGrants(userId, controller.signal)
      .then((list) => {
        setItems(list.items)
        setError(null)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setItems([])
        setError(describeError(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [userId])

  const start = useCallback((key: string): boolean => {
    if (busyRef.current !== null) return false
    busyRef.current = key
    setBusy(key)
    setError(null)
    return true
  }, [])

  const finish = useCallback(() => {
    busyRef.current = null
    setBusy(null)
  }, [])

  const grant = useCallback(
    async (key: McpGrantKey) => {
      if (!start(key)) return
      try {
        // The response is the user's full list AFTER the change, and its
        // `granted_at` is the ORIGINAL insert time on a re-grant. Take it as-is.
        const list = await grantMcpGrant(userId, key)
        setItems(list.items)
      } catch (cause) {
        setError(describeError(cause))
      } finally {
        finish()
      }
    },
    [finish, start, userId],
  )

  const revoke = useCallback(
    async (key: string) => {
      if (!start(key)) return
      try {
        await revokeMcpGrant(userId, key)
        // 204 arrives whether or not a row existed, so this says nothing about
        // whether the user previously held it — it only reflects our own list.
        setItems((current) => current.filter((item) => item.grant_key !== key))
      } catch (cause) {
        setError(describeError(cause))
      } finally {
        finish()
      }
    },
    [finish, start, userId],
  )

  return { items, loading, error, busy, grant, revoke }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useMcpGrants.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMcpGrants.ts src/hooks/useMcpGrants.test.ts
git commit -m "feat(mcp): add the per-user grants hook with serialised writes"
```

---

### Task 5: The grants panel

**Files:**
- Create: `src/components/admin/McpGrantsPanel.tsx`
- Test: `src/components/admin/McpGrantsPanel.test.tsx`

**Interfaces:**
- Consumes: `MCP_SYSTEMS`, `holds`, `grantFor`, `formatGrantedAt`,
  `orphanedPermissions`, `requiredRoleFor`, `unknownGrants` from
  `@/lib/mcp-grants`; `McpGrant`, `McpGrantKey` from `@/lib/api`
- Produces: `McpGrantsPanel(props: McpGrantsPanelProps)` where

```ts
interface McpGrantsPanelProps {
  items: McpGrant[]
  loading: boolean
  error: string | null
  /** The key currently being written, or null. Disables every control. */
  busy: string | null
  onGrant: (key: McpGrantKey) => void
  onRevoke: (key: string) => void
  /** granted_by -> email, or null when it cannot be resolved. */
  resolveGranter: (id: number | null) => string | null
  /** The admin is looking at their own row. */
  isSelf: boolean
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/components/admin/McpGrantsPanel.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpGrant } from '@/lib/api'
import { McpGrantsPanel } from '@/components/admin/McpGrantsPanel'

function grant(key: string, granted_at = '2026-08-25T12:00:00Z'): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function renderPanel(overrides: Partial<Parameters<typeof McpGrantsPanel>[0]> = {}) {
  const props = {
    items: [] as McpGrant[],
    loading: false,
    error: null,
    busy: null,
    onGrant: vi.fn(),
    onRevoke: vi.fn(),
    resolveGranter: () => 'ops@odin.test',
    isSelf: false,
    ...overrides,
  }
  render(<McpGrantsPanel {...props} />)
  return props
}

afterEach(() => cleanup())

describe('McpGrantsPanel', () => {
  it('renders every grant with its raw key, so an admin can cross-reference', () => {
    renderPanel()
    for (const key of [
      'mcp-hrms',
      'mcp-izone',
      'mcp-ems',
      'mcp.hrms.full',
      'mcp.hrms.tasks',
      'mcp.ems.query',
    ]) {
      expect(screen.getByText(key)).not.toBeNull()
    }
  })

  it('grants a key by ticking its box', () => {
    const props = renderPanel()
    fireEvent.click(screen.getByLabelText('Staff directory'))
    expect(props.onGrant).toHaveBeenCalledWith('mcp-hrms')
  })

  it('revokes a held key by unticking its box', () => {
    const props = renderPanel({ items: [grant('mcp-hrms')] })
    fireEvent.click(screen.getByLabelText('Staff directory'))
    expect(props.onRevoke).toHaveBeenCalledWith('mcp-hrms')
  })

  // The POST deliberately does not rewrite granted_at — the original insert is
  // the audit fact — so a re-grant must never read as "just now".
  it('renders the timestamp it was given, absolutely', () => {
    renderPanel({ items: [grant('mcp-hrms', '2026-08-01T12:00:00Z')] })
    expect(screen.getByText(/1 Aug 2026/)).not.toBeNull()
    expect(screen.queryByText(/just now/i)).toBeNull()
    expect(screen.queryByText(/ago/i)).toBeNull()
  })

  it('names who granted it', () => {
    renderPanel({ items: [grant('mcp-hrms')] })
    expect(screen.getByText(/ops@odin.test/)).not.toBeNull()
  })

  it('falls back to the admin id when the granter cannot be resolved', () => {
    renderPanel({ items: [grant('mcp-hrms')], resolveGranter: () => null })
    expect(screen.getByText(/admin #661/)).not.toBeNull()
  })

  // The hint is copy. It must never take a control away.
  it('warns about a permission held without its role, and keeps the toggle usable', () => {
    const props = renderPanel({ items: [grant('mcp.ems.query')] })
    expect(screen.getByText(/No effect on its own/i)).not.toBeNull()
    const box = screen.getByLabelText('SQL console') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(props.onRevoke).toHaveBeenCalledWith('mcp.ems.query')
  })

  it('offers to grant the missing role in one explicit click', () => {
    const props = renderPanel({ items: [grant('mcp.ems.query')] })
    fireEvent.click(screen.getByRole('button', { name: /Also grant mcp-ems/ }))
    expect(props.onGrant).toHaveBeenCalledWith('mcp-ems')
  })

  // A role without its permission is complete and common. Silence.
  it('says nothing about a role held without its permissions', () => {
    renderPanel({ items: [grant('mcp-ems')] })
    expect(screen.queryByText(/No effect on its own/i)).toBeNull()
  })

  it('keeps an unrecognised key visible and revocable', () => {
    const props = renderPanel({ items: [grant('mcp-future-thing')] })
    expect(screen.getByText('mcp-future-thing')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Revoke mcp-future-thing/ }))
    expect(props.onRevoke).toHaveBeenCalledWith('mcp-future-thing')
  })

  it('disables every control while a write is in flight', () => {
    renderPanel({ busy: 'mcp-hrms' })
    const box = screen.getByLabelText('iZone access') as HTMLInputElement
    expect(box.disabled).toBe(true)
  })

  it('renders an error verbatim', () => {
    renderPanel({ error: 'Admin privileges required' })
    expect(screen.getByText('Admin privileges required')).not.toBeNull()
  })

  // Rule 1: a global admin holds nothing implicitly, and the controls must not
  // be hidden on their own row — they grant themselves, which is the audit row.
  it('tells an admin viewing themselves that admin confers nothing, with controls live', () => {
    renderPanel({ isSelf: true, items: [] })
    expect(screen.getByText(/does not confer tool access/i)).not.toBeNull()
    const box = screen.getByLabelText('Staff directory') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(false)
  })

  it('disclaims the tool mapping', () => {
    renderPanel()
    expect(screen.getByText(/decided by the MCP server/i)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/admin/McpGrantsPanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/McpGrantsPanel`.

- [ ] **Step 3: Implement the panel**

Create `src/components/admin/McpGrantsPanel.tsx`:

```tsx
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpGrant, McpGrantKey } from '@/lib/api'
import {
  formatGrantedAt,
  grantFor,
  holds,
  MCP_SYSTEMS,
  orphanedPermissions,
  requiredRoleFor,
  unknownGrants,
  type McpGrantCopy,
} from '@/lib/mcp-grants'

export interface McpGrantsPanelProps {
  items: McpGrant[]
  loading: boolean
  error: string | null
  /** The key currently being written, or null. Disables every control. */
  busy: string | null
  onGrant: (key: McpGrantKey) => void
  onRevoke: (key: string) => void
  /** granted_by -> email, or null when it cannot be resolved. */
  resolveGranter: (id: number | null) => string | null
  /** The signed-in admin is looking at their own row. */
  isSelf: boolean
}

/**
 * Which MCP grants one user holds.
 *
 * This screen renders GRANTS, never tools: the MCP server decides what a grant
 * unlocks, and there is no way to ask it about anybody but the caller. The
 * descriptions are copy for a human, not a contract.
 */
export function McpGrantsPanel({
  items,
  loading,
  error,
  busy,
  onGrant,
  onRevoke,
  resolveGranter,
  isSelf,
}: McpGrantsPanelProps) {
  const orphans = orphanedPermissions(items)
  const unknown = unknownGrants(items)
  const writing = busy !== null

  function row(copy: McpGrantCopy, nested: boolean) {
    const held = holds(items, copy.key)
    const record = grantFor(items, copy.key)
    const orphaned = orphans.includes(copy.key)
    const missingRole = orphaned ? requiredRoleFor(copy.key) : null
    const granter = record ? resolveGranter(record.granted_by) : null

    return (
      <div
        key={copy.key}
        className={cn(
          'rounded-lg border px-3 py-2.5',
          nested && 'ml-6',
          copy.sharp ? 'border-amber-500/40 bg-amber-500/5' : 'bg-card',
        )}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id={`grant-${copy.key}`}
            checked={held}
            disabled={writing}
            onChange={(event) =>
              event.target.checked ? onGrant(copy.key) : onRevoke(copy.key)
            }
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`grant-${copy.key}`} className="text-sm font-medium">
                {copy.label}
              </label>
              {copy.sharp && (
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              )}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {copy.key}
              </code>
              {busy === copy.key && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>

            {missingRole && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                <p className="min-w-0 flex-1 text-xs">
                  No effect on its own — without <code className="font-mono">{missingRole}</code>{' '}
                  this user cannot use it, or discover anything through it.
                </p>
                {/* An explicit second POST, so both audit rows exist and
                    neither grant is implied by the other. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={writing}
                  onClick={() => onGrant(missingRole)}
                >
                  Also grant {missingRole}
                </Button>
              </div>
            )}

            {record && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Granted {formatGrantedAt(record.granted_at)}
                {record.granted_by !== null && ` · by ${granter ?? `admin #${record.granted_by}`}`}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2.5 border-b pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-4" />
        </span>
        <h2 className="text-base font-semibold">Tool access</h2>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0">{error}</p>
        </div>
      )}

      {/* Rule 1: gateway admin is an IT/ops role and confers no tool access.
          The controls stay live — an admin grants themselves explicitly, and
          that is what leaves the audit row. */}
      {isSelf && items.length === 0 && (
        <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Global admin does not confer tool access. Grant yourself explicitly — it writes an
          audit row.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading grants…
        </div>
      ) : (
        <div className="space-y-5">
          {MCP_SYSTEMS.map((system) => (
            <div key={system.id} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {system.name}
              </h3>
              {row(system.role, false)}
              {system.permissions.map((permission) => row(permission, true))}
            </div>
          ))}

          {unknown.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Other grants
              </h3>
              {unknown.map((item) => (
                <div
                  key={item.grant_key}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <code className="font-mono text-xs">{item.grant_key}</code>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This build does not recognise this grant. It is left here so it stays
                      revocable.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={writing}
                    onClick={() => onRevoke(item.grant_key)}
                  >
                    Revoke {item.grant_key}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
        This lists grants, not tools. Which tools a grant unlocks is decided by the MCP
        server.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/admin/McpGrantsPanel.test.tsx`
Expected: PASS — 14 tests.

If `getByText(/1 Aug 2026/)` fails on a text node split across elements, the
timestamp line is a single `<p>` so a regex match on it works; do **not** relax
the assertion to `queryAllByText`.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/McpGrantsPanel.tsx src/components/admin/McpGrantsPanel.test.tsx
git commit -m "feat(mcp): add the grants panel with the both-halves hint"
```

---

### Task 6: Extract the active toggle and link the directory rows

`UsersPage` currently owns the activate/deactivate buttons inline. The detail
page needs the same control with the same self-deactivation guard, so extract it
once rather than duplicating the policy.

**Note:** adding a router `Link` to `UsersPage` breaks its existing tests, which
render the component with no router context. Wrapping them in `MemoryRouter` is
part of this task, not a follow-up.

**Files:**
- Create: `src/components/admin/UserActiveToggle.tsx`
- Modify: `src/components/admin/UsersPage.tsx`
- Test: `src/components/admin/UsersPage.test.tsx`

**Interfaces:**
- Consumes: `UserOut` from `@/lib/api`
- Produces: `UserActiveToggle(props: { user: UserOut; isSelf: boolean; busy: boolean; onChange: (isActive: boolean) => void })`

- [ ] **Step 1: Write the failing test**

In `src/components/admin/UsersPage.test.tsx`, add the router import and wrap
every render. Replace the import line at the top:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
```

Add this helper just below the `page()` helper:

```tsx
function renderPage(currentUserId: number) {
  return render(
    <MemoryRouter>
      <UsersPage currentUserId={currentUserId} />
    </MemoryRouter>,
  )
}
```

Replace every `render(<UsersPage currentUserId={N} />)` in the file with
`renderPage(N)`. Then append this test inside the existing `describe`:

```tsx
it('links each row to that user’s detail page', async () => {
  mockList.mockResolvedValue(page([user({ id: 12, email: 'alice@odin.test' })]))
  renderPage(99)
  await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
  const link = screen.getByRole('link', { name: /alice@odin.test/ }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe('/admin/users/12')
})
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run src/components/admin/UsersPage.test.tsx`
Expected: the new test FAILS (`Unable to find role="link"`). Every pre-existing
test still PASSES — the `MemoryRouter` wrapper alone must not change behaviour.

- [ ] **Step 3: Extract the toggle**

Create `src/components/admin/UserActiveToggle.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UserOut } from '@/lib/api'

interface UserActiveToggleProps {
  user: UserOut
  /** The signed-in admin's own row. */
  isSelf: boolean
  busy: boolean
  onChange: (isActive: boolean) => void
}

/**
 * Offboard or restore an account. Shared by the directory and the detail page so
 * the one refusal the client can be certain of — self-deactivation — is decided
 * in a single place. The last-active-admin case is a 409 from the gateway and is
 * rendered by the caller, verbatim.
 */
export function UserActiveToggle({ user, isSelf, busy, onChange }: UserActiveToggleProps) {
  if (!user.is_active) {
    return (
      <Button variant="outline" size="sm" onClick={() => onChange(true)} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null} Activate
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive"
      onClick={() => onChange(false)}
      disabled={busy || isSelf}
      title={isSelf ? 'You cannot deactivate your own account' : undefined}
    >
      {busy ? <Loader2 className="animate-spin" /> : null} Deactivate
    </Button>
  )
}
```

- [ ] **Step 4: Use it in `UsersPage` and link the row**

In `src/components/admin/UsersPage.tsx`:

Add to the imports:

```tsx
import { Link } from 'react-router-dom'
import { UserActiveToggle } from '@/components/admin/UserActiveToggle'
```

Replace the email `<span>` in the row with a link that carries the row through
router state (so the detail page renders instantly, without a lookup):

```tsx
<Link
  to={`/admin/users/${user.id}`}
  state={{ user }}
  className="min-w-0 flex-1 truncate text-sm hover:text-primary hover:underline"
>
  {user.email}
</Link>
```

Replace the whole `{user.is_active ? (<Button …>Deactivate</Button>) : (<Button …>Activate</Button>)}`
block with:

```tsx
<UserActiveToggle
  user={user}
  isSelf={isSelf}
  busy={busy === user.id}
  onChange={(isActive) => void setActive(user, isActive)}
/>
```

Keep the `Loader2` import: the "Loading users…" block still uses it. Every other
symbol the removed buttons used (`Button`) is still referenced by the search
form, so no import changes are needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/admin/UsersPage.test.tsx`
Expected: PASS — including the pre-existing self-deactivation and 409 tests,
which now exercise the extracted component.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/UserActiveToggle.tsx src/components/admin/UsersPage.tsx src/components/admin/UsersPage.test.tsx
git commit -m "refactor(admin): extract UserActiveToggle and link directory rows"
```

---

### Task 7: The user detail page and its route

**Files:**
- Create: `src/components/admin/UserDetailPage.tsx`
- Modify: `src/components/workspace/Workspace.tsx`
- Test: `src/components/admin/UserDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useMcpGrants` from `@/hooks/useMcpGrants`; `McpGrantsPanel`;
  `UserActiveToggle`; `listUsers`, `updateUser`, `describeError`, `GatewayError`,
  `UserOut` from `@/lib/api`
- Produces: `UserDetailPage(props: { currentUserId: number })`, mounted at
  `admin/users/:id`

There is **no `GET /users/{id}`** on the gateway — only `/users/me` and the
paginated list. So the email is resolved two ways: from router state when the
admin arrived from the directory, and otherwise from `listUsers()` (whose
default is a single wide 200-row page), which also resolves `granted_by` ids to
emails. Both fall back to an id.

- [ ] **Step 1: Write the failing tests**

Create `src/components/admin/UserDetailPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listUsers: vi.fn(),
    updateUser: vi.fn(),
    listMcpGrants: vi.fn(),
    grantMcpGrant: vi.fn(),
    revokeMcpGrant: vi.fn(),
  }
})

import {
  GatewayError,
  grantMcpGrant,
  listMcpGrants,
  listUsers,
  revokeMcpGrant,
  updateUser,
  type McpGrant,
  type UserOut,
} from '@/lib/api'
import { UserDetailPage } from '@/components/admin/UserDetailPage'

const mockListUsers = vi.mocked(listUsers)
const mockUpdateUser = vi.mocked(updateUser)
const mockListGrants = vi.mocked(listMcpGrants)
const mockGrant = vi.mocked(grantMcpGrant)
const mockRevoke = vi.mocked(revokeMcpGrant)

function user(overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 42,
    email: 'alice@odin.test',
    auth_provider: 'local',
    role: 'member',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function grant(key: string, granted_at = '2026-08-01T12:00:00Z'): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function renderDetail(id = 42, currentUserId = 661) {
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${id}`]}>
      <Routes>
        <Route
          path="/admin/users/:id"
          element={<UserDetailPage currentUserId={currentUserId} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserDetailPage', () => {
  beforeEach(() => {
    mockListUsers.mockResolvedValue({
      total: 2,
      limit: 200,
      offset: 0,
      items: [user(), user({ id: 661, email: 'ops@odin.test', role: 'admin' })],
    })
    mockListGrants.mockResolvedValue({ user_id: 42, items: [] })
    mockGrant.mockResolvedValue({ user_id: 42, items: [grant('mcp-hrms')] })
    mockRevoke.mockResolvedValue(undefined)
    mockUpdateUser.mockImplementation(async (id, body) =>
      user({ id, is_active: body.is_active }),
    )
  })

  it('resolves the user’s email from the directory on a cold link', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    expect(mockListGrants).toHaveBeenCalledWith(42, expect.any(AbortSignal))
  })

  it('falls back to the id when the directory cannot resolve it', async () => {
    mockListUsers.mockResolvedValue({ total: 0, limit: 200, offset: 0, items: [] })
    renderDetail(4242)
    await waitFor(() => expect(screen.getByText(/User #4242/)).not.toBeNull())
  })

  it('grants a key through the panel', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByLabelText('Staff directory')).not.toBeNull())
    fireEvent.click(screen.getByLabelText('Staff directory'))
    await waitFor(() => expect(mockGrant).toHaveBeenCalledWith(42, 'mcp-hrms'))
  })

  // The re-grant response carries the ORIGINAL granted_at on purpose.
  // Every write returns the WHOLE list, and an untouched grant keeps the
  // granted_at the gateway already had. Neither may re-render as “just now”.
  it('renders the timestamps the server returned after a write', async () => {
    const original = grant('mcp-hrms', '2026-08-01T12:00:00Z')
    mockListGrants.mockResolvedValue({ user_id: 42, items: [original] })
    mockGrant.mockResolvedValue({
      user_id: 42,
      items: [original, grant('mcp-izone', '2026-08-20T12:00:00Z')],
    })
    renderDetail()
    await waitFor(() => expect(screen.getByText(/1 Aug 2026/)).not.toBeNull())
    fireEvent.click(screen.getByLabelText('iZone access'))
    await waitFor(() => expect(screen.getByText(/20 Aug 2026/)).not.toBeNull())
    // The untouched grant still shows its ORIGINAL date.
    expect(screen.getByText(/1 Aug 2026/)).not.toBeNull()
    expect(screen.queryByText(/just now/i)).toBeNull()
  })

  it('revokes a key through the panel', async () => {
    mockListGrants.mockResolvedValue({ user_id: 42, items: [grant('mcp-izone')] })
    renderDetail()
    await waitFor(() => expect(screen.getByLabelText('iZone access')).not.toBeNull())
    fireEvent.click(screen.getByLabelText('iZone access'))
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(42, 'mcp-izone'))
  })

  // 403 is a policy refusal from a signed-in caller. Rendered in place, no
  // redirect — the route deliberately has no client-side guard.
  it('renders a 403 in place with the gateway’s wording', async () => {
    mockListGrants.mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    renderDetail()
    await waitFor(() => expect(screen.getByText('Admin privileges required')).not.toBeNull())
  })

  it('renders a 404 for an unknown user without losing the way back', async () => {
    mockListGrants.mockRejectedValue(new GatewayError(404, 'Unknown user'))
    renderDetail(999)
    await waitFor(() => expect(screen.getByText('Unknown user')).not.toBeNull())
    expect(screen.getByRole('link', { name: /Users/ })).not.toBeNull()
  })

  // Rule 1 again, at the page level: an admin's own row is not special-cased.
  it('lets an admin manage their own grants', async () => {
    mockListGrants.mockResolvedValue({ user_id: 661, items: [] })
    renderDetail(661, 661)
    await waitFor(() => expect(screen.getByLabelText('SQL console')).not.toBeNull())
    const box = screen.getByLabelText('SQL console') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(screen.getByText(/does not confer tool access/i)).not.toBeNull()
  })

  it('disables deactivating your own account', async () => {
    renderDetail(661, 661)
    await waitFor(() => expect(screen.getByText('ops@odin.test')).not.toBeNull())
    const button = screen.getByRole('button', { name: /Deactivate/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('renders a 409 deactivation refusal verbatim', async () => {
    mockUpdateUser.mockRejectedValue(
      new GatewayError(409, 'This is the last active admin; promote or activate another admin first'),
    )
    renderDetail()
    await waitFor(() => expect(screen.getByText('alice@odin.test')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Deactivate/ }))
    await waitFor(() =>
      expect(
        screen.getByText('This is the last active admin; promote or activate another admin first'),
      ).not.toBeNull(),
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/admin/UserDetailPage.test.tsx`
Expected: FAIL — cannot resolve `@/components/admin/UserDetailPage`.

- [ ] **Step 3: Implement the page**

Create `src/components/admin/UserDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, UserCog } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { McpGrantsPanel } from '@/components/admin/McpGrantsPanel'
import { UserActiveToggle } from '@/components/admin/UserActiveToggle'
import { useMcpGrants } from '@/hooks/useMcpGrants'
import { describeError, listUsers, updateUser, type UserOut } from '@/lib/api'

interface UserDetailPageProps {
  currentUserId: number
}

/**
 * One user's administrable state: their account switch, and the MCP grants they
 * hold.
 *
 * The route has NO client-side admin guard, matching the Users and NRB screens:
 * a non-admin who reaches the URL sees the gateway's 403 rendered here, which is
 * not an expired session and must not bounce them to login.
 */
export function UserDetailPage({ currentUserId }: UserDetailPageProps) {
  const { id } = useParams()
  const userId = Number(id)
  const location = useLocation()
  const seeded = (location.state as { user?: UserOut } | null)?.user ?? null

  const [directory, setDirectory] = useState<UserOut[]>([])
  const [record, setRecord] = useState<UserOut | null>(seeded)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grants = useMcpGrants(userId)

  // There is no GET /users/{id}: only /users/me and the paginated list. One wide
  // page covers a cold deep-link AND resolves granted_by ids to emails.
  useEffect(() => {
    const controller = new AbortController()
    listUsers({}, controller.signal)
      .then((page) => {
        setDirectory(page.items)
        const found = page.items.find((item) => item.id === userId)
        if (found) setRecord(found)
      })
      .catch(() => {
        // Non-fatal: the grants panel is the point of this page, and it reports
        // its own failures. Falling back to an id is better than an error here.
      })
    return () => controller.abort()
  }, [userId])

  const resolveGranter = useCallback(
    (granterId: number | null): string | null => {
      if (granterId === null) return null
      if (granterId === currentUserId) return 'you'
      return directory.find((item) => item.id === granterId)?.email ?? null
    },
    [currentUserId, directory],
  )

  const isSelf = userId === currentUserId
  const heading = useMemo(
    () => record?.email ?? `User #${Number.isFinite(userId) ? userId : id}`,
    [id, record, userId],
  )

  async function setActive(isActive: boolean) {
    if (!record) return
    setBusy(true)
    setNotice(null)
    try {
      setRecord(await updateUser(record.id, { is_active: isActive }))
    } catch (error) {
      // A 409 (own account, last active admin) is a policy refusal, not an auth
      // failure: render it verbatim and leave the account as it was.
      setNotice(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <Link
          to="/admin/users"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Users
        </Link>

        <header className="mb-5 flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserCog className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{heading}</h1>
            {record && (
              <p className="text-xs text-muted-foreground">
                {record.is_active ? 'Active' : 'Inactive'} · {record.auth_provider}
              </p>
            )}
          </div>
          {record && (
            <>
              <Badge variant="outline" className="capitalize">{record.role}</Badge>
              <UserActiveToggle
                user={record}
                isSelf={isSelf}
                busy={busy}
                onChange={(isActive) => void setActive(isActive)}
              />
            </>
          )}
        </header>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="min-w-0">{notice}</p>
          </div>
        )}

        <McpGrantsPanel
          items={grants.items}
          loading={grants.loading}
          error={grants.error}
          busy={grants.busy}
          onGrant={grants.grant}
          onRevoke={grants.revoke}
          resolveGranter={resolveGranter}
          isSelf={isSelf}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Mount the route**

In `src/components/workspace/Workspace.tsx`, add the import:

```tsx
import { UserDetailPage } from '@/components/admin/UserDetailPage'
```

and add this route immediately after the existing `admin/users` route:

```tsx
{/* Same reasoning as admin/users: no client redirect. A non-admin who reaches
    this URL sees the gateway's 403 in-page, which is not an expired session. */}
<Route
  path="admin/users/:id"
  element={<UserDetailPage currentUserId={user?.id ?? -1} />}
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/admin/UserDetailPage.test.tsx`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/UserDetailPage.tsx src/components/admin/UserDetailPage.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat(mcp): add the per-user tool access page at /admin/users/:id"
```

---

### Task 8: Name the empty-grant state in the status badge

At cutover every existing user drops to one exposed tool. The badge says
`connected · 1 tools`, which reads as a broken MCP server rather than "you hold
no grants".

**Files:**
- Modify: `src/components/layout/McpStatusBadge.tsx`

**Interfaces:**
- Consumes: `exposedToolsHint` from `@/lib/mcp-grants` (already built and tested
  in Task 3)
- Produces: no new exports

- [ ] **Step 1: Implement the copy**

The decision itself is already covered by `exposedToolsHint` tests in
`src/lib/mcp-grants.test.ts`; this step wires it in. The tooltip body is Radix
content that only mounts while open, so it is not asserted in a component test —
the pure helper is where the behaviour lives.

Add the import:

```tsx
import { exposedToolsHint } from '@/lib/mcp-grants'
```

Below the existing `mcpDetail` computation, add:

```tsx
// Truthful: these are the names the MCP server just told us IT exposes to this
// caller. The hint below is a copy-only heuristic and sits under them, so a
// wrong guess is next to the truth.
const exposedTools = state === 'connected' ? (status?.tools ?? []) : []
const toolsHint = state === 'connected' ? exposedToolsHint(exposedTools) : null
```

In the tooltip's grid, after the MCP row, add:

```tsx
{exposedTools.length > 0 && (
  <>
    <span className="text-muted-foreground">Tools</span>
    <span className="break-words">{exposedTools.join(' · ')}</span>
  </>
)}
```

and after the closing `</div>` of the grid, before the closing `</div>` of the
`space-y-2` wrapper:

```tsx
{toolsHint && <p className="text-[11px] leading-relaxed">{toolsHint}</p>}
```

Also fix the pluralisation in `mcpDetail`, which currently always says "tools":

```tsx
const mcpDetail =
  state === 'connected'
    ? `connected · ${status?.tools.length ?? 0} ${status?.tools.length === 1 ? 'tool' : 'tools'}`
    : state === 'off'
      ? 'not configured'
      : state === 'disconnected'
        ? status?.error || 'unavailable'
        : 'checking'
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npx vitest run && npm run lint`
Expected: PASS. No test asserts the tooltip body today, and none is added — the
decision is tested as `exposedToolsHint`.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/McpStatusBadge.tsx
git commit -m "feat(mcp): name the no-grants state in the system status tooltip"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Add the hard rule**

Append to the numbered **Hard rules** list in `AGENTS.md` as rule 18:

```markdown
18. **MCP grants are six strings, and the client maps none of them to tools.**
    Roles name a system (`mcp-hrms`, `mcp-izone`, `mcp-ems`); permissions name a
    sharp edge inside one (`mcp.hrms.full`, `mcp.hrms.tasks`, `mcp.ems.query`).
    Neither implies the other, and two tools need both halves. The MCP server is
    the only place a tool -> grant map exists — do not add a second copy here;
    `src/lib/mcp-grants.ts` holds descriptions and a permission -> role hint that
    render COPY ONLY and never gate a control. Four traps. `POST` is idempotent
    and deliberately does NOT rewrite `granted_at`/`granted_by`, so render the
    timestamp the response carries and never "granted just now". `DELETE` returns
    204 whether or not a row existed, so a success says nothing about prior
    state. A global admin holds NO grant implicitly — an admin's own page shows an
    empty list, and its controls must stay visible and enabled, because granting
    themselves is what writes the audit row. And a 403 here is a policy refusal
    from a signed-in caller: render `detail` verbatim, never let it reach the 401
    path. Reads type `grant_key` as `string`, not the union, so a key this build
    does not recognise stays visible and revocable.
```

Add to the **Before changing a feature** list:

```markdown
- **MCP tool grants:** read `src/lib/mcp-grants.ts`, `src/hooks/useMcpGrants.ts`,
  `src/components/admin/McpGrantsPanel.tsx` and its test, then hard rule 18. The
  gateway owns the vocabulary (`app/mcp/grants.py`) and the MCP server owns which
  tool a grant unlocks; this client renders grants and derives nothing. The entry
  point is the row link in `src/components/admin/UsersPage.tsx` and the
  `admin/users/:id` route in `src/components/workspace/Workspace.tsx`.
```

- [ ] **Step 2: Update the README**

Add to the admin section of `README.md`:

```markdown
### MCP tool access

Admins open a user from **Users** to reach their tool access page. Six grants
are available: three roles naming a system (`mcp-hrms`, `mcp-izone`, `mcp-ems`)
and three permissions naming a sharp edge inside one (`mcp.hrms.full`,
`mcp.hrms.tasks`, `mcp.ems.query`). A permission never implies its role, so the
expenses SQL console needs both `mcp-ems` and `mcp.ems.query`; the page says so
when only one half is held.

Being a gateway admin confers no tool access. Admins grant themselves
explicitly, which is what records who granted what.

Until a user holds a grant the assistant can reach only the MCP server's clock
tool, and the system status tooltip says so.
```

- [ ] **Step 3: Full verification**

Run, and paste the real output into the commit or the report — do not summarise
from memory:

```bash
npm run test
npm run lint
npm run build
```

Expected: all three succeed. If `npm run build` reports unused imports (TS
rejects unused locals), remove them rather than suppressing the error.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs(mcp): record the grant contract's traps and the admin flow"
```

---

## Notes for the executor

- **Do not touch the working tree's uncommitted session-paging changes**
  (`useSessions.ts`, `Sidebar.tsx`, `api.ts` cursor paging, `README.md` paging
  section). They are separate in-flight work. `api.ts` is shared — add the grant
  section without reformatting anything around it.
- **Deploy coupling:** this frontend must not ship before the gateway's
  `mcp-grants` routes are deployed, or the detail page 404s on load.
- **Do not add** a preview of another user's tools, a bulk/matrix view, or a
  confirm dialog on the sharp permissions. All three were considered and
  declined; see the spec's "Out of scope".
