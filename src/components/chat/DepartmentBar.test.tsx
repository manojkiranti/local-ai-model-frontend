import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Department } from '@/lib/api'
import { DepartmentBar } from '@/components/chat/DepartmentBar'
import { RECENT_DEPARTMENTS_KEY, readRecentDepartments } from '@/lib/department-recents'

// Radix positions its popover with floating-ui, which observes the trigger.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: 1,
    code: 'hr',
    name: 'Human Resources',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A small tenant: everything fits as chips. */
const FEW: Department[] = [
  department({ id: 1, code: 'hr', name: 'Human Resources' }),
  department({ id: 2, code: 'finance', name: 'Finance' }),
  department({ id: 3, code: 'risk', name: 'Risk' }),
  department({ id: 4, code: 'legacy', name: 'Retired Unit', is_active: false }),
]

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

/** `count` distinct departments named "Dept A", "Dept B", … with codes `dept-a`, … */
function many(count: number): Department[] {
  return LETTERS.slice(0, count).map((letter, index) =>
    department({
      id: index + 1,
      code: `dept-${letter.toLowerCase()}`,
      name: `Dept ${letter}`,
    }),
  )
}

function setup(props: Partial<React.ComponentProps<typeof DepartmentBar>> = {}) {
  const onChange = vi.fn()
  render(
    <DepartmentBar
      departments={FEW}
      loading={false}
      error={null}
      value={null}
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange }
}

const chipNames = () =>
  screen
    .getAllByRole('button')
    .map((node) => node.textContent?.trim() ?? '')
    .filter((name) => !name.includes('more'))

const overflow = () => screen.queryByRole('button', { name: /more$/i })
const search = () => screen.getByRole('searchbox', { name: /search departments/i })

describe('DepartmentBar', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('chips General plus every active department for a small tenant', () => {
    setup()

    expect(chipNames()).toEqual(['General', 'Finance', 'Human Resources', 'Risk'])
  })

  it('offers no overflow control when every department is already a chip', () => {
    setup()

    expect(overflow()).toBe(null)
  })

  it('never chips an inactive department', () => {
    setup()

    expect(chipNames().some((name) => name.includes('Retired Unit'))).toBe(false)
  })

  it('marks the active department chip as pressed', () => {
    setup({ value: 'finance' })

    const pressed = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('aria-pressed') === 'true')
    expect(pressed.length).toBe(1)
    expect(pressed[0].textContent).toContain('Finance')
  })

  it('marks the General chip as pressed for a general chat', () => {
    setup()

    const pressed = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('aria-pressed') === 'true')
    expect(pressed.length).toBe(1)
    expect(pressed[0].textContent).toContain('General')
  })

  it('changes scope in one click on a chip', () => {
    const { onChange } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Finance' }))

    expect(onChange).toHaveBeenCalledWith('finance')
  })

  it('does not re-select the active chip, which would discard the open chat', () => {
    const { onChange } = setup({ value: 'finance' })

    fireEvent.click(screen.getByRole('button', { name: 'Finance' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns to the General scope from its chip', () => {
    const { onChange } = setup({ value: 'finance' })

    fireEvent.click(screen.getByRole('button', { name: 'General' }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('records a chip selection as a recent scope', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Finance' }))

    expect(readRecentDepartments()).toEqual(['finance'])
  })

  it('keeps a five-department tenant fully chipped rather than hiding one', () => {
    setup({ departments: many(5) })

    expect(chipNames().length).toBe(6)
    expect(overflow()).toBe(null)
  })

  it('moves the tail into an overflow control once there are too many', () => {
    setup({ departments: many(6) })

    expect(chipNames()).toEqual(['General', 'Dept A', 'Dept B', 'Dept C', 'Dept D'])
    expect(overflow()?.textContent).toContain('2 more')
  })

  it('counts every hidden department in the overflow label', () => {
    setup({ departments: many(12) })

    expect(overflow()?.textContent).toContain('8 more')
  })

  it('always chips the active department, even one that sorts into the overflow', () => {
    setup({ departments: many(12), value: 'dept-l' })

    expect(chipNames()).toContain('Dept L')
    expect(overflow()?.textContent).toContain('8 more')
  })

  it('chips recently used departments ahead of alphabetical filler', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['dept-k']))
    setup({ departments: many(12) })

    expect(chipNames()).toContain('Dept K')
    expect(chipNames().some((name) => name === 'Dept D')).toBe(false)
  })

  it('displays chips alphabetically so they do not jump between selections', () => {
    window.localStorage.setItem(RECENT_DEPARTMENTS_KEY, JSON.stringify(['dept-k']))
    setup({ departments: many(12), value: 'dept-l' })

    expect(chipNames()).toEqual(['General', 'Dept A', 'Dept B', 'Dept K', 'Dept L'])
  })

  it('chips an active department that is not in the loaded list, showing its code', () => {
    setup({ departments: [], loading: true, value: 'not-loaded-yet' })

    expect(chipNames()).toContain('not-loaded-yet')
  })

  it('opens the searchable list from the overflow control', () => {
    setup({ departments: many(12) })

    fireEvent.click(overflow() as HTMLElement)

    expect(search()).toBeTruthy()
  })

  it('changes scope from the overflow list', () => {
    const { onChange } = setup({ departments: many(12) })

    fireEvent.click(overflow() as HTMLElement)
    fireEvent.change(search(), { target: { value: 'dept-h' } })
    fireEvent.keyDown(search(), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('dept-h')
    expect(readRecentDepartments()).toEqual(['dept-h'])
  })

  it('closes the overflow list after a choice', () => {
    setup({ departments: many(12) })

    fireEvent.click(overflow() as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: /Dept H/ }))

    expect(screen.queryByRole('searchbox')).toBe(null)
  })

  it('does not re-select the active scope from the overflow list', () => {
    const { onChange } = setup({ departments: many(12), value: 'dept-a' })

    fireEvent.click(overflow() as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: /Dept A/ }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox')).toBe(null)
  })

  it('closes the overflow list on Escape without changing scope', () => {
    const { onChange } = setup({ departments: many(12) })

    fireEvent.click(overflow() as HTMLElement)
    fireEvent.keyDown(search(), { key: 'Escape' })

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox')).toBe(null)
  })

  it('shows that departments are still loading', () => {
    setup({ departments: [], loading: true })

    expect(screen.getByLabelText(/loading departments/i)).toBeTruthy()
  })

  it('says so when departments could not be loaded', () => {
    setup({ departments: [], error: 'Boom' })

    expect(screen.getByText(/departments unavailable/i)).toBeTruthy()
  })
})
