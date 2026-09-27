import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Department } from '@/lib/api'
import { useChatScope } from '@/hooks/useChatScope'
import { RECENT_DEPARTMENTS_KEY } from '@/lib/department-recents'

function named(code: string, name: string): Department {
  return { id: 1, code, name, is_active: true, created_at: '2026-08-01T00:00:00Z', role: 'viewer' }
}

const PROD = [
  named('policy', 'Policy'),
  named('nrb', 'Nepal Rastra Bank'),
  named('it', 'IT'),
  named('hrdept', 'Human Resources'),
  named('guideline', 'Guidelines'),
]

type Props = { departments: Department[]; loading: boolean; sessionOpen: boolean }

function setup(initial: Props) {
  return renderHook((props: Props) => useChatScope(props), { initialProps: initial })
}

describe('useChatScope', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  // Reporting General before the list lands would flash the General notice at
  // someone who is about to be put in a department.
  it('is unknown while the departments are loading', () => {
    const { result } = setup({ departments: [], loading: true, sessionOpen: false })

    expect(result.current.scope).toBeUndefined()
  })

  it('opens in NRB once the departments arrive', () => {
    const { result, rerender } = setup({ departments: [], loading: true, sessionOpen: false })

    rerender({ departments: PROD, loading: false, sessionOpen: false })

    expect(result.current.scope).toBe('nrb')
  })

  it('opens in the department last used in this browser', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['hrdept']))

    const { result } = setup({ departments: PROD, loading: false, sessionOpen: false })

    expect(result.current.scope).toBe('hrdept')
  })

  // Also what a failed department list looks like from here: nothing to offer.
  it('opens in General for a caller with no department', () => {
    const { result } = setup({ departments: [], loading: false, sessionOpen: false })

    expect(result.current.scope).toBeNull()
  })

  it('keeps a chosen department while the list reloads', () => {
    const { result, rerender } = setup({ departments: PROD, loading: false, sessionOpen: false })

    act(() => result.current.pin('it'))
    rerender({ departments: [], loading: true, sessionOpen: false })

    expect(result.current.scope).toBe('it')
  })

  // A first turn sent before the list landed went out as General. The late
  // list must not then relabel that chat as the launch department.
  it('keeps General once a send has pinned it, even after the departments arrive', () => {
    const { result, rerender } = setup({ departments: [], loading: true, sessionOpen: false })

    act(() => result.current.pin(null))
    rerender({ departments: PROD, loading: false, sessionOpen: true })

    expect(result.current.scope).toBeNull()
  })

  it('reports an open chat whose department the gateway did not send as unknown', () => {
    const { result, rerender } = setup({ departments: PROD, loading: false, sessionOpen: false })

    act(() => result.current.pin(undefined))
    rerender({ departments: PROD, loading: false, sessionOpen: true })

    expect(result.current.scope).toBeUndefined()
  })

  // "Unknown" describes an open chat, not a tab: a new chat started from there
  // (or left behind when that chat is deleted) needs a scope it can be sent in.
  it('falls back to the launch department once no chat of unknown department is open', () => {
    const { result, rerender } = setup({ departments: PROD, loading: false, sessionOpen: true })

    act(() => result.current.pin(undefined))
    rerender({ departments: PROD, loading: false, sessionOpen: false })

    expect(result.current.scope).toBe('nrb')
  })
})
