import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  RECENT_DEPARTMENTS_KEY,
  rememberDepartment,
  readRecentDepartments,
} from '@/lib/department-recents'

describe('department recents', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('returns no recents before anything has been used', () => {
    expect(readRecentDepartments()).toEqual([])
  })

  it('lists the most recently used department first', () => {
    rememberDepartment('hr')
    rememberDepartment('finance')

    expect(readRecentDepartments()).toEqual(['finance', 'hr'])
  })

  it('moves a re-used department back to the front instead of duplicating it', () => {
    rememberDepartment('hr')
    rememberDepartment('finance')
    rememberDepartment('hr')

    expect(readRecentDepartments()).toEqual(['hr', 'finance'])
  })

  it('keeps only the last three departments', () => {
    for (const code of ['a', 'b', 'c', 'd']) rememberDepartment(code)

    expect(readRecentDepartments()).toEqual(['d', 'c', 'b'])
  })

  it('ignores the General scope so it is never listed as a recent', () => {
    rememberDepartment(null)

    expect(readRecentDepartments()).toEqual([])
  })

  it('recovers from a malformed stored value rather than throwing', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, 'not json')

    expect(readRecentDepartments()).toEqual([])
  })

  it('discards stored entries that are not strings', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['hr', 7, null]))

    expect(readRecentDepartments()).toEqual(['hr'])
  })
})
