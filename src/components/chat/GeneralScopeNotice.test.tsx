import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Department } from '@/lib/api'
import { GeneralScopeNotice } from '@/components/chat/GeneralScopeNotice'
import { RECENT_DEPARTMENTS_KEY, readRecentDepartments } from '@/lib/department-recents'

function named(code: string, name: string, is_active = true): Department {
  return { id: 1, code, name, is_active, created_at: '2026-08-01T00:00:00Z', role: 'viewer' }
}

const PROD = [
  named('policy', 'Policy'),
  named('nrb', 'Nepal Rastra Bank'),
  named('it', 'IT'),
  named('hrdept', 'Human Resources'),
  named('guideline', 'Guidelines'),
]

function setup(props: Partial<React.ComponentProps<typeof GeneralScopeNotice>> = {}) {
  const onChoose = vi.fn()
  render(
    <GeneralScopeNotice departments={PROD} hasMessages={false} onChoose={onChoose} {...props} />,
  )
  return { onChoose }
}

const switches = () => screen.queryAllByRole('button').map((node) => node.textContent?.trim())

describe('GeneralScopeNotice', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('says plainly that General chat searches no department documents', () => {
    setup()

    expect(screen.getByText(/General chat doesn't search department documents/)).not.toBeNull()
  })

  it('offers NRB first, then departments by name, three at most', () => {
    setup()

    expect(switches()).toEqual(['Nepal Rastra Bank', 'Guidelines', 'Human Resources'])
  })

  it('offers the department last used in this browser first', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['it']))

    setup()

    expect(switches()).toEqual(['IT', 'Nepal Rastra Bank', 'Guidelines'])
  })

  it('switches to a department in one click', () => {
    const { onChoose } = setup()

    fireEvent.click(screen.getByRole('button', { name: /Nepal Rastra Bank/ }))

    expect(onChoose).toHaveBeenCalledWith('nrb')
  })

  // Same as picking the chip in the bar: it is where this user works now, so it
  // is where the next launch should open.
  it('records the department chosen as recently used', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: /Human Resources/ }))

    expect(readRecentDepartments()).toEqual(['hrdept'])
  })

  // A General chat cannot be moved into a department (the gateway answers 409),
  // so a switch from a chat with history must say it leaves that chat behind.
  it('says a switch starts a new chat once this chat has messages', () => {
    setup({ hasMessages: true })

    expect(screen.getByText(/starts a new chat/)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Start a new chat in Nepal Rastra Bank' })).not.toBeNull()
  })

  it('does not warn about a new chat when this one is still empty', () => {
    setup()

    expect(screen.queryByText(/starts a new chat/)).toBeNull()
  })

  it('offers no switch to someone who holds no active department', () => {
    setup({ departments: [named('it', 'IT', false)] })

    expect(screen.getByText(/General chat doesn't search department documents/)).not.toBeNull()
    expect(switches()).toEqual([])
  })
})
