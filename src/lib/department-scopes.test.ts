import { describe, expect, it } from 'vitest'
import { atLeast, hasAnyDepartmentAtLeast } from '@/lib/department-scopes'
import type { Department, DepartmentRole } from '@/lib/api'

function dept(code: string, role: DepartmentRole): Department {
  return {
    id: 1,
    code,
    name: code.toUpperCase(),
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    role,
  }
}

// The ONE piece of department policy on the client, so it is exhausted rather
// than sampled: every level against every minimum, then everything that is not
// a level at all.
describe('atLeast', () => {
  it('lets a viewer meet only the viewer minimum', () => {
    expect(atLeast('viewer', 'viewer')).toBe(true)
    expect(atLeast('viewer', 'editor')).toBe(false)
    expect(atLeast('viewer', 'owner')).toBe(false)
  })

  it('lets an editor meet viewer and editor', () => {
    expect(atLeast('editor', 'viewer')).toBe(true)
    expect(atLeast('editor', 'editor')).toBe(true)
    expect(atLeast('editor', 'owner')).toBe(false)
  })

  it('lets an owner meet every minimum', () => {
    expect(atLeast('owner', 'viewer')).toBe(true)
    expect(atLeast('owner', 'editor')).toBe(true)
    expect(atLeast('owner', 'owner')).toBe(true)
  })

  it('fails closed when the level is absent', () => {
    expect(atLeast(undefined, 'viewer')).toBe(false)
    expect(atLeast(null, 'viewer')).toBe(false)
    expect(atLeast('', 'viewer')).toBe(false)
  })

  // A gateway that has not shipped feat/role sends no `role` at all, and the
  // global role is a different vocabulary entirely. Neither may read as rank 0
  // and pass the viewer check.
  it('fails closed for a string that is not a department level', () => {
    expect(atLeast('admin', 'viewer')).toBe(false)
    expect(atLeast('member', 'viewer')).toBe(false)
    expect(atLeast('superuser', 'viewer')).toBe(false)
  })

  it('fails closed for a level in the wrong case', () => {
    expect(atLeast('Owner', 'viewer')).toBe(false)
    expect(atLeast('VIEWER', 'viewer')).toBe(false)
  })

  it('fails closed for a minimum that is not a department level', () => {
    expect(atLeast('owner', 'admin' as DepartmentRole)).toBe(false)
    expect(atLeast('owner', undefined as unknown as DepartmentRole)).toBe(false)
  })
})

describe('hasAnyDepartmentAtLeast', () => {
  it('is false with no departments at all', () => {
    expect(hasAnyDepartmentAtLeast([], 'editor')).toBe(false)
  })

  it('is false when every grant is too weak', () => {
    expect(hasAnyDepartmentAtLeast([dept('hr', 'viewer'), dept('legal', 'viewer')], 'editor')).toBe(
      false,
    )
  })

  it('is true when one grant of many is strong enough', () => {
    expect(hasAnyDepartmentAtLeast([dept('hr', 'viewer'), dept('legal', 'editor')], 'editor')).toBe(
      true,
    )
  })

  it('counts a stronger grant as meeting a weaker minimum', () => {
    expect(hasAnyDepartmentAtLeast([dept('hr', 'owner')], 'editor')).toBe(true)
  })

  it('is false for the owner minimum when the strongest grant is editor', () => {
    expect(hasAnyDepartmentAtLeast([dept('hr', 'editor')], 'owner')).toBe(false)
  })
})
