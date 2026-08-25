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
