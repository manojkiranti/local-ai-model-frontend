import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, getToolAccess: vi.fn(), setToolGroupAccess: vi.fn(), resetToolGroupAccess: vi.fn() }
})

import {
  GatewayError,
  getToolAccess,
  resetToolGroupAccess,
  setToolGroupAccess,
  type ToolAccessGroup,
  type ToolAccessList,
} from '@/lib/api'
import { ToolAccessPanel } from '@/components/admin/ToolAccessPanel'
import { useToolAccess } from '@/hooks/useToolAccess'

const group = (over: Partial<ToolAccessGroup> & { id: string; label: string; tools: string[] }): ToolAccessGroup => ({
  allowed: true,
  default_allowed: true,
  state: 'default',
  updated_at: null,
  updated_by: null,
  ...over,
})

const LIST: ToolAccessList = {
  user_id: 7,
  groups: [
    group({ id: 'everyday', label: 'Everyday helpers', tools: ['calculator', 'date_math'] }),
    group({
      id: 'create',
      label: 'Create files',
      tools: ['create_pptx', 'create_memo'],
      allowed: false,
      state: 'blocked',
      updated_at: '2026-10-02T10:00:00Z',
      updated_by: 1,
    }),
    group({ id: 'read', label: 'Read uploaded files', tools: ['read_document', 'read_excel'], allowed: null, state: 'mixed' }),
    group({ id: 'external', label: 'External sources', tools: ['fetch_url'], allowed: false, default_allowed: false }),
  ],
  items: [],
}

function renderPanel(props: Partial<React.ComponentProps<typeof ToolAccessPanel>> = {}) {
  const onSetGroupAllowed = vi.fn()
  const onResetGroup = vi.fn()
  render(
    <ToolAccessPanel
      list={LIST}
      loading={false}
      error={null}
      busy={null}
      onSetGroupAllowed={onSetGroupAllowed}
      onResetGroup={onResetGroup}
      resolveAdmin={(id) => (id === 1 ? 'you' : null)}
      {...props}
    />,
  )
  return { onSetGroupAllowed, onResetGroup }
}

afterEach(cleanup)

describe('ToolAccessPanel', () => {
  it('shows one switch per group, never one per tool', () => {
    renderPanel()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByRole('checkbox', { name: 'create_pptx' })).toBeNull()
    // The tools are listed as text under their group.
    expect(screen.getByTestId('tool-group-create').textContent).toContain('create_pptx · create_memo')
    expect(screen.getByText('1 of 4 groups allowed')).not.toBeNull()
  })

  it('reflects each group’s state, including a mixed group', () => {
    renderPanel()
    const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement
    expect(box('Everyday helpers').checked).toBe(true)
    expect(box('Create files').checked).toBe(false)
    expect(box('Read uploaded files').indeterminate).toBe(true)
    expect(screen.getByTestId('tool-group-create').textContent).toContain('blocked')
    expect(screen.getByTestId('tool-group-create').textContent).toContain('by you')
    expect(screen.getByTestId('tool-group-external').textContent).toContain('Default · off')
  })

  it('switches and resets whole groups', () => {
    const { onSetGroupAllowed, onResetGroup } = renderPanel()
    fireEvent.click(screen.getByLabelText('External sources'))
    expect(onSetGroupAllowed).toHaveBeenCalledWith('external', true)
    fireEvent.click(screen.getByLabelText('Everyday helpers'))
    expect(onSetGroupAllowed).toHaveBeenCalledWith('everyday', false)
    // A mixed group turns fully on.
    fireEvent.click(screen.getByLabelText('Read uploaded files'))
    expect(onSetGroupAllowed).toHaveBeenCalledWith('read', true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset Create files to default' }))
    expect(onResetGroup).toHaveBeenCalledWith('create')
    expect(screen.queryByRole('button', { name: 'Reset Everyday helpers to default' })).toBeNull()
  })

  it('locks every switch while a change is in flight', () => {
    renderPanel({ busy: 'create' })
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true)
  })
})

describe('useToolAccess', () => {
  beforeEach(() => {
    vi.mocked(getToolAccess).mockReset().mockResolvedValue(LIST)
    vi.mocked(setToolGroupAccess).mockReset()
    vi.mocked(resetToolGroupAccess).mockReset()
  })

  it('takes the server’s list after switching or resetting a group', async () => {
    const after = { ...LIST, groups: LIST.groups.map((g) => (g.id === 'external' ? { ...g, allowed: true, state: 'granted' as const } : g)) }
    vi.mocked(setToolGroupAccess).mockResolvedValue(after)
    vi.mocked(resetToolGroupAccess).mockResolvedValue(LIST)
    const { result } = renderHook(() => useToolAccess(7))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.setGroupAllowed('external', true))
    expect(setToolGroupAccess).toHaveBeenCalledWith(7, 'external', true)
    expect(result.current.list?.groups.find((g) => g.id === 'external')?.allowed).toBe(true)

    await act(() => result.current.resetGroup('external'))
    expect(resetToolGroupAccess).toHaveBeenCalledWith(7, 'external')
    expect(result.current.list).toEqual(LIST)
  })

  it('runs one write at a time: a second click while busy is ignored', async () => {
    let release!: (l: ToolAccessList) => void
    vi.mocked(setToolGroupAccess).mockImplementation(() => new Promise((r) => (release = r)))
    const { result } = renderHook(() => useToolAccess(7))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first!: Promise<void>
    act(() => {
      first = result.current.setGroupAllowed('create', true)
    })
    await act(() => result.current.setGroupAllowed('external', true))
    expect(setToolGroupAccess).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(LIST)
      await first
    })
  })

  it('renders a refusal verbatim and keeps the list it had', async () => {
    vi.mocked(setToolGroupAccess).mockRejectedValue(new GatewayError(403, 'Admin privileges required'))
    const { result } = renderHook(() => useToolAccess(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.setGroupAllowed('external', true))
    expect(result.current.error).toBe('Admin privileges required')
    expect(result.current.list).toEqual(LIST)
  })
})
