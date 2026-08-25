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
        description: 'Free-form read-only SQL against the entire expenses database.',
      },
    ],
  },
]

/**
 * Permission -> the role it needs to have any effect.
 *
 * This is COPY, not enforcement: it only decides whether a sentence renders. It
 * never disables a control, never blocks a grant, never alters a request. The
 * MCP server owns the real pairing, so drift here means a stale hint — never a
 * UI that refuses what the server allows, or offers what it refuses.
 */
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
