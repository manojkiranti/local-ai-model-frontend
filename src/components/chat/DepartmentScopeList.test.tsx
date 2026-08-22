import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Department } from '@/lib/api'
import { DepartmentScopeList } from '@/components/chat/DepartmentScopeList'
import { RECENT_DEPARTMENTS_KEY } from '@/lib/department-recents'

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: 1,
    code: 'hr',
    name: 'Human Resources',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    role: 'viewer',
    ...overrides,
  }
}

const DEPARTMENTS: Department[] = [
  department(),
  department({ id: 2, code: 'finance', name: 'Finance' }),
  department({ id: 3, code: 'reing-1', name: 'Reingest Test' }),
  department({ id: 4, code: 'reing-2', name: 'Reingest Test' }),
  department({ id: 5, code: 'legacy', name: 'Retired Unit', is_active: false }),
]

function setup(props: Partial<React.ComponentProps<typeof DepartmentScopeList>> = {}) {
  const onSelect = vi.fn()
  const onDismiss = vi.fn()
  render(
    <DepartmentScopeList
      departments={DEPARTMENTS}
      loading={false}
      error={null}
      value={null}
      onSelect={onSelect}
      onDismiss={onDismiss}
      {...props}
    />,
  )
  return { onSelect, onDismiss }
}

const search = () => screen.getByRole('searchbox', { name: /search departments/i })
const optionNames = () => screen.getAllByRole('option').map((node) => node.textContent ?? '')

describe('DepartmentScopeList', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('offers General plus every active department, and hides inactive ones', () => {
    setup()

    const names = optionNames()
    expect(names[0]).toContain('General')
    expect(names.some((name) => name.includes('Finance'))).toBe(true)
    expect(names.some((name) => name.includes('Retired Unit'))).toBe(false)
  })

  it('filters by department name, case-insensitively', () => {
    setup()

    fireEvent.change(search(), { target: { value: 'fin' } })

    expect(optionNames().some((name) => name.includes('Finance'))).toBe(true)
    expect(optionNames().some((name) => name.includes('Human Resources'))).toBe(false)
  })

  it('filters by department code so same-named departments stay reachable', () => {
    setup()

    fireEvent.change(search(), { target: { value: 'REING-2' } })

    const names = optionNames()
    expect(names.length).toBe(1)
    expect(names[0]).toContain('reing-2')
  })

  it('shows each department code alongside its name', () => {
    setup()

    const duplicates = optionNames().filter((name) => name.includes('Reingest Test'))
    expect(duplicates.length).toBe(2)
    expect(duplicates.some((name) => name.includes('reing-1'))).toBe(true)
    expect(duplicates.some((name) => name.includes('reing-2'))).toBe(true)
  })

  it('reports when nothing matches the search', () => {
    setup()

    fireEvent.change(search(), { target: { value: 'zzz' } })

    expect(screen.queryAllByRole('option').length).toBe(0)
    expect(screen.getByText(/no department matches/i)).toBeTruthy()
  })

  it('reports the department chosen by click', () => {
    const { onSelect } = setup()

    fireEvent.click(screen.getByRole('option', { name: /Finance/ }))

    expect(onSelect).toHaveBeenCalledWith('finance')
  })

  it('reports the General scope as null', () => {
    const { onSelect } = setup({ value: 'finance' })

    fireEvent.click(screen.getByRole('option', { name: /General/ }))

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the active scope as selected for assistive technology', () => {
    setup({ value: 'finance' })

    const selected = screen
      .getAllByRole('option')
      .filter((node) => node.getAttribute('aria-selected') === 'true')
    expect(selected.length).toBe(1)
    expect(selected[0].textContent).toContain('Finance')
  })

  it('lists departments alphabetically, not in the order the gateway returned them', () => {
    setup()

    // Props order is hr, finance, reing-1, reing-2.
    expect(optionNames().slice(1, 3).map((name) => name.trim().slice(0, 5))).toEqual([
      'Finan',
      'Human',
    ])
  })

  it('selects the highlighted option with the arrow keys and Enter', () => {
    const { onSelect } = setup()

    // General is highlighted first; one step down lands on the first department.
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('finance')
  })

  it('walks back up the list with ArrowUp', () => {
    const { onSelect } = setup()

    // Down to Human Resources, then back up to Finance.
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'ArrowUp' })
    fireEvent.keyDown(search(), { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('finance')
  })

  it('points aria-activedescendant at the highlighted option', () => {
    setup()

    fireEvent.keyDown(search(), { key: 'ArrowDown' })

    const active = search().getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active as string)?.textContent).toContain('Finance')
  })

  it('highlights the first match after typing, so Enter picks what is shown', () => {
    const { onSelect } = setup()

    fireEvent.change(search(), { target: { value: 'finance' } })
    fireEvent.keyDown(search(), { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('finance')
  })

  it('asks to be dismissed on Escape without choosing a scope', () => {
    const { onSelect, onDismiss } = setup()

    fireEvent.keyDown(search(), { key: 'Escape' })

    expect(onSelect).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })

  it('lists recently used departments above the full list', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['reing-2']))
    setup()

    const names = optionNames()
    expect(names[1]).toContain('reing-2')
    expect(screen.getByText(/^Recent$/i)).toBeTruthy()
  })

  it('does not repeat a recent department that no longer exists', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['deleted-dept']))
    setup()

    expect(optionNames().some((name) => name.includes('deleted-dept'))).toBe(false)
    expect(screen.queryByText(/^Recent$/i)).toBe(null)
  })

  it('drops the recents section while a search is active', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['finance']))
    setup()

    fireEvent.change(search(), { target: { value: 'finance' } })

    expect(screen.queryByText(/^Recent$/i)).toBe(null)
    expect(optionNames().filter((name) => name.includes('Finance')).length).toBe(1)
  })

  it('surfaces a department loading failure instead of an empty list', () => {
    setup({ error: 'Departments unavailable', departments: [] })

    expect(screen.getByText(/departments unavailable/i)).toBeTruthy()
  })

  it('says departments are still loading', () => {
    setup({ loading: true, departments: [] })

    expect(screen.getByText(/loading departments/i)).toBeTruthy()
  })

  it('still offers General while departments are loading', () => {
    setup({ loading: true, departments: [] })

    expect(optionNames()[0]).toContain('General')
  })
})
