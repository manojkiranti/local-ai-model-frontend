import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpAccessPanel, type McpAccessPanelProps } from '@/components/admin/McpAccessPanel'
import type { McpAccessList } from '@/lib/api'

afterEach(() => {
  cleanup()
})

const LIST: McpAccessList = {
  user_id: 7,
  tool_mode: 'read_only',
  mcp_reachable: true,
  systems: [
    {
      id: 'hrms',
      label: 'HRMS (employees, attendance, leave)',
      level: 'none',
      default_level: 'read',
      overridden: true,
      updated_at: '2026-10-05T08:00:00Z',
      updated_by: 2,
    },
    {
      id: 'izone',
      label: 'iZone (documents, circulars)',
      level: 'read',
      default_level: 'read',
      overridden: false,
      updated_at: null,
      updated_by: null,
    },
  ],
  tools: [
    {
      name: 'get_hrms_employee_remaining_leave',
      summary: 'Remaining leave balances.',
      system: 'hrms',
      kind: 'read',
      server_enabled: true,
      override: true,
      allowed: true,
      updated_at: null,
      updated_by: null,
    },
    {
      name: 'list_hrms_employees',
      summary: '',
      system: 'hrms',
      kind: 'read',
      server_enabled: true,
      override: null,
      allowed: false,
      updated_at: null,
      updated_by: null,
    },
    {
      name: 'create_hrms_leave',
      summary: '',
      system: 'hrms',
      kind: 'write',
      server_enabled: false,
      override: null,
      allowed: false,
      updated_at: null,
      updated_by: null,
    },
  ],
}

function renderPanel(overrides: Partial<McpAccessPanelProps> = {}) {
  const props: McpAccessPanelProps = {
    list: LIST,
    loading: false,
    error: null,
    busy: null,
    onSetLevel: vi.fn(),
    onResetLevel: vi.fn(),
    onSetToolAllowed: vi.fn(),
    onResetTool: vi.fn(),
    resolveAdmin: (id) => (id === 2 ? 'admin@nicasiabank.com' : null),
    ...overrides,
  }
  render(<McpAccessPanel {...props} />)
  return props
}

describe('McpAccessPanel', () => {
  it('shows each system with its level pressed and who changed it', () => {
    renderPanel()
    const hrms = screen.getByTestId('mcp-system-hrms')
    expect(within(hrms).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(hrms).getByText(/by admin@nicasiabank.com/)).not.toBeNull()
    const izone = screen.getByTestId('mcp-system-izone')
    expect(within(izone).getByText('Default · Read')).not.toBeNull()
    expect(within(izone).queryByRole('button', { name: /Reset/ })).toBeNull()
  })

  it('sets and resets a level', () => {
    const props = renderPanel()
    const hrms = screen.getByTestId('mcp-system-hrms')
    fireEvent.click(within(hrms).getByRole('button', { name: 'Full' }))
    expect(props.onSetLevel).toHaveBeenCalledWith('hrms', 'full')
    fireEvent.click(within(hrms).getByRole('button', { name: /Reset HRMS/ }))
    expect(props.onResetLevel).toHaveBeenCalledWith('hrms')
  })

  it('does not re-send the level that is already set', () => {
    const props = renderPanel()
    fireEvent.click(within(screen.getByTestId('mcp-system-hrms')).getByRole('button', { name: 'None' }))
    expect(props.onSetLevel).not.toHaveBeenCalled()
  })

  it('overrides a single tool, and "Follow level" removes the override', () => {
    const props = renderPanel()
    const select = screen.getByRole('combobox', { name: 'Access to list_hrms_employees' })
    fireEvent.change(select, { target: { value: 'allow' } })
    expect(props.onSetToolAllowed).toHaveBeenCalledWith('list_hrms_employees', true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Access to get_hrms_employee_remaining_leave' }), {
      target: { value: 'level' },
    })
    expect(props.onResetTool).toHaveBeenCalledWith('get_hrms_employee_remaining_leave')
  })

  it('marks a server-wide-disabled tool and does not let it be overridden', () => {
    renderPanel()
    const row = screen.getByTestId('mcp-tool-create_hrms_leave')
    expect(within(row).getByText('Off server-wide')).not.toBeNull()
    expect((within(row).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  })

  it('disables every control while a change is in flight', () => {
    renderPanel({ busy: 'system:hrms' })
    for (const button of within(screen.getByTestId('mcp-system-izone')).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('says so when the MCP server is unreachable, but keeps levels editable', () => {
    renderPanel({ list: { ...LIST, mcp_reachable: false, tools: [] } })
    expect(screen.getByText(/MCP server is unreachable/)).not.toBeNull()
    expect(
      (within(screen.getByTestId('mcp-system-izone')).getByRole('button', { name: 'Full' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})
