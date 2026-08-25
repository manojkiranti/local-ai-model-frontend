# Per-User MCP Tool Grants — Admin UI Design

Date: 2026-08-25

## Problem

The gateway is the authenticated front door to a remote MCP server exposing 13
business tools. Until now every authenticated chat user could reach all of
them, including an 80+ field HRMS employee record (salary grade included),
pending approval counts, and a caller-composed read-only SQL console over the
whole expenses database.

Each user now holds explicit grants, stored in the gateway
(`user_mcp_grants`) and forwarded to the MCP server on every request. The MCP
server refuses to register a tool the caller holds no grant for; zero grants
means exactly one harmless tool (the server clock).

The grant table is **empty**. There is no UI — grants can only be administered
with `curl`. This screen is how access gets provisioned at cutover, so it is on
the critical path.

## The vocabulary — exactly six strings

Three **roles**, naming a system the user may touch (hyphenated):

| grant | unlocks |
|---|---|
| `mcp-hrms` | staff directory: list employees, list departments, look up an employee (11-field summary) |
| `mcp-izone` | all four iZone SharePoint tools (lists, list items, documents, country circulars) |
| `mcp-ems` | expenses schema discovery only (list tables / columns) |

Three **permissions**, naming a sharp edge inside one of those systems
(dotted):

| grant | unlocks |
|---|---|
| `mcp.hrms.full` | the full 80+ field employee record, including `Salary_Level` |
| `mcp.hrms.tasks` | pending approval counts per employee (resignation, loans, salary advance) |
| `mcp.ems.query` | free-form read-only SQL against the entire expenses database |

A permission never implies its role, and a role never implies its permission.
Two tools require both halves explicitly: the expenses SQL console needs
`mcp-ems` **and** `mcp.ems.query`; employee tasks needs `mcp-hrms` **and**
`mcp.hrms.tasks`. Granting `mcp.ems.query` alone does nothing — the holder can
neither run SQL nor discover table names.

`mcp.hrms.full` is different in shape: it gates an **argument**, not a tool.
Without it an employee lookup still succeeds and returns the 11-field summary
plus a note that full detail was withheld.

The table above is **human-facing copy, not logic**. See "The dependency hint
is copy" below.

## API contract

Verified against the gateway at
`/home/manoj/newlaptop/projects/python/local-ai-model-gateway`
(`app/mcp/grants_router.py`, `app/mcp/schemas.py`, `app/mcp/grants.py`).
All three routes are admin-only, JWT bearer.

```
GET    /v1/users/{user_id}/mcp-grants              -> 200 GrantListResponse
POST   /v1/users/{user_id}/mcp-grants              -> 201 GrantListResponse
       body: {"grant_key": "mcp-hrms"}   (extra="forbid")
DELETE /v1/users/{user_id}/mcp-grants/{grant_key}  -> 204, empty body
```

```json
{ "user_id": 42,
  "items": [ { "grant_key": "mcp-hrms",
               "granted_at": "2026-08-25T08:31:27.259932+05:45",
               "granted_by": 661 } ] }
```

Statuses on all three: 401 no/invalid JWT, 403 caller is not an admin, 404
unknown user, 422 validation.

### Behaviours that shape the UI

- **POST is idempotent.** Re-granting returns 201 with the same list and
  deliberately does **not** rewrite `granted_at` / `granted_by` — the original
  insert is the audit fact. The UI must therefore never render "granted just
  now"; it renders the timestamp the response carries.
- **DELETE is idempotent.** 204 whether or not a row existed. The UI must never
  infer "this was previously granted" from a successful delete.
- **422 names the offending value** and lists the valid set. The body also
  rejects unexpected fields, so nothing but `grant_key` is ever sent.
- **`granted_by` is a user id** (`int | None`), not an email.
- **`GET /v1/mcp/status` is caller-scoped** (`Depends(get_mcp_identity)`), so
  it answers for whoever asks and cannot preview another user.

## Rules this design is bound by

1. **A global gateway admin holds no grant implicitly.** Gateway admin is an
   IT/ops role; auto-conferring salary data and an expenses SQL console on
   whoever operates the gateway is the escalation an audit objects to. An admin
   opening their own grants page sees an empty list, and that is **correct**.
   The UI must not imply admins implicitly hold everything, and must not hide
   the controls on an admin's row — they grant themselves explicitly, which is
   what leaves the audit row.
2. **No tool -> grant map in the frontend.** The gateway deliberately has none
   either (`app/mcp/grants.py` documents why). The MCP server is the single
   source of truth for which grant gates which tool; a second copy drifts
   silently in the worst direction.
3. **No preview of another user's tools.** `GET /v1/tools` and
   `GET /v1/mcp/status` are caller-scoped. This UI shows which grants a user
   holds and never claims a resulting tool list. Not faked, not approximated.
4. **Every route is admin-only.** Non-admins get 403.

## Architecture

Five units, each independently understandable and testable.

### 1. Vocabulary and copy — `src/lib/mcp-grants.ts`

Pure. No React, no fetch. Holds:

- the six keys as named constants, `MCP_ROLES`, `MCP_PERMISSIONS`, and the
  closed union `McpGrantKey`
- `MCP_SYSTEMS`: the three system groups (HRMS, iZone, Expenses), each with its
  role, its permissions in display order, and the human copy for every row
- `holds(items, key)` and `grantFor(items, key)`
- `orphanedPermissions(items)`: permissions held whose role is not

This is the client's only copy of the vocabulary, mirroring how
`department-scopes.ts` owns the level ordering and says so.

**Unknown keys.** `MCP_SYSTEMS` covers what this build knows. A key from the
server that matches nothing renders in an **Other grants** group with a revoke
control and a note that this build does not recognise it. Dropping it silently
is the "lost capability with no error on either side" failure `grants.py`
warns about.

### 2. Transport — `src/lib/api.ts`

```ts
export type McpGrantKey =
  | 'mcp-hrms' | 'mcp-izone' | 'mcp-ems'
  | 'mcp.hrms.full' | 'mcp.hrms.tasks' | 'mcp.ems.query'

export interface McpGrant {
  grant_key: string          // deliberately NOT McpGrantKey — see below
  granted_at: string
  granted_by: number | null
}
export interface McpGrantList { user_id: number; items: McpGrant[] }

listMcpGrants(userId: number, signal?): Promise<McpGrantList>
grantMcpGrant(userId: number, key: McpGrantKey, signal?): Promise<McpGrantList>
revokeMcpGrant(userId: number, grantKey: string, signal?): Promise<void>
```

The asymmetry is deliberate. **Writes** take the closed union: the UI only ever
sends a key it knows, and the body is exactly `{ grant_key }` because the
gateway forbids extra fields. **Reads** type `grant_key` as `string`: the
gateway and this client deploy independently, and `McpIdentity.from_grants`
already tolerates keys a given build does not define. `revokeMcpGrant` takes
`string` so an unrecognised key remains revocable.

`revokeMcpGrant` uses `rawFetch` + `errorFromResponse` (like
`revokeDepartmentMember`) because 204 has no body to parse. The grant key is
passed through `encodeURIComponent`.

#### The 422 fix

`errorFromResponse` currently accepts `detail` only when it is a string, so
FastAPI's validation array degrades to `Request failed (HTTP 422)` and the
gateway's `unknown grant: 'x'; expected one of [...]` is discarded. Add a
branch that flattens a list-shaped `detail` to its `msg` strings, joined. The
string branch stays byte-identical so no wording currently under test moves.

This should not fire in normal use — the UI only sends frozen-union keys — but
it fires exactly when the two vocabularies have drifted, which is when the
message matters most.

### 3. State — `src/hooks/useMcpGrants.ts`

Owns the grant list for one `userId`:

- loads on mount and on id change, with an `AbortSignal` cancelled on unmount
- `grant(key)` / `revoke(key)`
- `busy: string | null` — **one write in flight at a time**

Serialising writes is a correctness requirement, not a nicety. Every POST
returns the *whole* list; two concurrent writes can resolve out of order and
the loser's list overwrites the winner's. One at a time removes the race
without optimistic reconciliation.

- POST resolves -> replace state with the returned list.
- DELETE resolves -> drop that key locally; on failure restore and report.

### 4. Route body — `src/components/admin/UserDetailPage.tsx`

Route `admin/users/:id`, registered in `Workspace.tsx` with **no client-side
redirect**, matching the existing comment above `admin/users`: a non-admin who
reaches the URL sees the gateway's 403 in-page, which is not an expired session
and must not bounce them to login. The backend stays authoritative.

Renders an identity header (email, global role badge, active state,
activate/deactivate) and the grants panel.

**Resolving the email.** There is no `GET /users/{id}` — only `/users/me` and
the paginated list. So:

1. the directory row is passed through router state for an instant header, and
2. `listUsers()` (the existing wide 200-row default) is fetched in parallel,
   which covers a cold deep-link **and** resolves `granted_by` id -> email.

Fallbacks are `User #42` and `admin #661`. Beyond 200 users the fallback shows;
the grants themselves are unaffected. A one-line `GET /users/{id}` on the
gateway would retire this, and is not a blocker.

The activate/deactivate control is extracted from `UsersPage` into a shared
`UserActiveToggle`, so the self-deactivation guard and the 409 path exist once.

### 5. Presentation — `src/components/admin/McpGrantsPanel.tsx`

Grouped by system; role first, its permissions indented beneath.

```
Tool access

HRMS — staff directory
  [x] Staff directory                                    mcp-hrms
        List employees and departments, look up an employee
        (11-field summary).
        Granted 25 Aug 2026 · by you

  [ ] Full employee record                        (!) mcp.hrms.full
        Adds all 80+ fields to a lookup, including Salary_Level.
        Without it a lookup still works and says full detail
        was withheld.

  [ ] Pending approvals                               mcp.hrms.tasks
        Resignation, loan and salary-advance counts per employee.
        Needs mcp-hrms as well.

Expenses (EMS)
  [ ] Schema discovery                                      mcp-ems
        List expense tables and columns.

  [x] SQL console                                  (!) mcp.ems.query
        Free-form read-only SQL against the entire expenses database.
        (!) No effect on its own — without mcp-ems this user cannot
            run SQL, or even discover table names.
                                            [ Also grant mcp-ems ]
        Granted 25 Aug 2026 · by ops@odin.com

This lists grants, not tools. Which tools a grant unlocks is decided
by the MCP server.
```

- Native `<input type="checkbox">` with a real `<label>`: there is no checkbox
  primitive in `src/components/ui/`, and a native control is both the cheapest
  and the most accessible option.
- The raw `grant_key` is always shown in mono beside the friendly name. It is
  the string that appears in the table, in `curl`, and in gateway logs, and
  admins will cross-reference.
- The two sharp permissions (`mcp.hrms.full`, `mcp.ems.query`) render in a
  visually distinct row with their consequence as **always-visible text**. No
  confirm dialog: the admin navigated here deliberately, the audit row is
  written either way, and a dialog on every grant during a 40-user cutover is
  click-through-blind by user five. Legibility over a speed bump.
- Timestamps render absolute (`25 Aug 2026`), never relative.
- One line at the panel foot disclaims the tool mapping, so the copy is not
  read as a contract.

#### The dependency hint is copy

`mcp-grants.ts` carries a permission -> role relation. Name what that is: a
third copy of a fact the MCP server owns, and precisely the drift rule 2 warns
about. It is therefore constrained to **choosing whether a sentence renders**.
It never disables a toggle, never blocks a grant, never alters a request body.
Drift means a stale hint, never a UI that refuses what the server allows or
allows what the server refuses.

It fires one-directionally:

- permission held, role missing -> amber note plus an inline
  `[ Also grant <role> ]` button firing an explicit second POST, so both audit
  rows exist and neither is implicit.
- role held, permission missing -> **silent**. That is a complete, valid, and
  common state.

#### Admin viewing themselves

Byte-identical panel: nothing hidden, nothing pre-ticked, no "you are an admin"
copy anywhere. When an admin views their own row holding zero grants, one
neutral line:

> Global admin does not confer tool access. Grant yourself explicitly — it
> writes an audit row.

Not an error, not a warning.

### Entry point — `src/components/admin/UsersPage.tsx`

Each row gains a `Manage ->` affordance navigating to `/admin/users/:id`,
passing the row through router state. No new sidebar entry; the detail page is
reached through Users, which is already `isAdmin`-gated in both `Sidebar.tsx`
and `Workspace.tsx`.

### Cutover copy — `src/components/layout/McpStatusBadge.tsx`

At cutover every existing user silently drops to one tool. The badge today says
`connected · 1 tools`, which reads as a broken MCP server rather than "you hold
no grants". Two changes to the tooltip:

- **Truthful:** list the exposed tool names. `status.tools` is already fetched
  and is the server's own caller-scoped answer.
- **Heuristic:** when `tools.length <= 1`, add "No business systems are enabled
  for your account. Ask an admin for access."

The threshold encodes an assumption that zero grants yields exactly the clock.
It selects **copy only**, never capability, and the real tool names sit
directly above it, so a wrong guess is a slightly-off hint beside the truth.
Commented as such at the call site.

## Error handling summary

| event | behaviour |
|---|---|
| 401 | untouched global path — `clearToken()` + `notifyUnauthorized()` -> login |
| 403 | `detail` rendered verbatim in-page. No redirect, no retry, never the 401 path |
| 404 | "No such user" plus a link back to the directory |
| 422 | flattened validation messages via the `errorFromResponse` fix |
| network | existing `describeError` `TypeError` branch |
| POST 201 | replace state with the returned list; render its `granted_at` |
| re-grant | shows the **original** date, never "just now" |
| DELETE 204 | drop the key locally; no "was granted…" copy anywhere |
| write failure | restore prior state, report, leave controls enabled |

## Testing

Per hard rule 16, every behaviour below gets automated coverage.

`src/lib/api.test.ts`
- POST body is exactly `{ grant_key }` — no extra fields
- POST path, method, and that the returned list replaces state
- DELETE encodes the key, resolves void on 204
- 403 surfaces `detail` and does **not** clear the token
- 401 does clear the token
- 422 list-shaped `detail` flattens to the gateway's message
- existing string-shaped `detail` wording is unchanged

`src/lib/mcp-grants.test.ts`
- grouping of the six keys into their systems
- an unrecognised key lands in Other grants
- `orphanedPermissions` fires for permission-without-role and **not** for
  role-without-permission

`src/components/admin/UserDetailPage.test.tsx` (`.test.tsx`: the assertions are
about rendered output; `cleanup()` in `afterEach` because Vitest runs without
`globals` here)
- a re-grant response carrying an old `granted_at` renders the **old** date
- an orphaned permission renders the warning **and** keeps its toggle enabled
- revoke removes the row and renders no prior-state copy
- an admin viewing their own row gets enabled controls and no implicit-access
  text
- a 403 renders `detail` in-page with no redirect
- an unrecognised server key renders with a working revoke

`src/components/admin/UsersPage.test.tsx`
- the row exposes navigation to the detail route

Full verification: `npm run test && npm run lint && npm run build`.

## Documentation

- `AGENTS.md`: a new hard rule for MCP grants (six strings, no tool map,
  idempotent POST keeps `granted_at`, 204 says nothing about prior state, 403
  is not an auth failure, an admin holds nothing implicitly), plus a "Before
  changing a feature" entry.
- `README.md`: the user-visible admin behaviour and the cutover note.

## Deploy coupling

This frontend must not ship before the gateway's `mcp-grants` routes are
deployed, or the detail page 404s on load. Same coupling shape as the
department-roles and chat-history-paging work.

## Evaluation & Improvement

**Success metric.** Provisioning completeness at cutover: the share of active
non-admin users holding at least one role grant, measured against the roster
IT expects to have access. The nearest available proxy for "the UI actually got
people provisioned" — there is no SQL-side signal reachable from the frontend.
The secondary metric is the count of orphaned permissions in the table
(permission held without its role), which should trend to zero; a non-zero
count means the dependency copy is not landing.

**Eval.** Ten labelled grant-list fixtures asserted in `mcp-grants.test.ts`
against their expected grouping and hint state:

1. `[]` — no grants; no hints, no groups marked enabled
2. `[mcp-hrms]` — role only; **no** hint
3. `[mcp-hrms, mcp.hrms.full]` — complete pair; no hint
4. `[mcp-hrms, mcp.hrms.tasks]` — complete pair; no hint
5. `[mcp.hrms.tasks]` — orphaned permission; hint names `mcp-hrms`
6. `[mcp.hrms.full]` — orphaned permission; hint names `mcp-hrms`
7. `[mcp-ems]` — role only; no hint
8. `[mcp.ems.query]` — orphaned permission; hint names `mcp-ems`
9. `[mcp-ems, mcp.ems.query]` — complete pair; no hint
10. `[mcp-izone, mcp-future-thing]` — unknown key routed to Other grants,
    `mcp-izone` grouped normally, no hint

Scoring is exact match on group assignment and on the set of hinted keys. Pass
rate recorded here on first run.

**Feedback capture.** Grant and revoke failures surface inline through the
existing `describeError` path with the gateway's `detail` preserved. The
orphaned-permission count is observable from `GET /v1/users/{id}/mcp-grants`
per user and from the `user_mcp_grants` table directly. No new telemetry
endpoint — none exists in this app, and adding one is out of scope.

**Review loop.** Review one week after cutover, then quarterly, or immediately
whenever the MCP server's vocabulary changes — a seventh grant key, or a
changed role/permission pairing, invalidates the copy in `mcp-grants.ts`.

## Out of scope

- Any preview of the tools another user will see. It cannot be derived
  honestly, and the gateway endpoint that would make it possible was declined
  for this iteration.
- A self-verification panel showing what the MCP server exposes to the signed-in
  admin. Technically honest (`/v1/mcp/status` is caller-scoped) but deferred.
- A matrix / bulk overview of all users against all six grants. It needs a bulk
  read the gateway does not have.
- Any confirm dialog, type-to-confirm, or approval workflow on the sharp
  permissions.
- Any change to who may reach `/admin/users` — the existing `isAdmin` gate is
  reused unchanged.
