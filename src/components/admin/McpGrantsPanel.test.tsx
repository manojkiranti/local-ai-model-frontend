import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpGrant } from '@/lib/api'
import { McpGrantsPanel, type McpGrantsPanelProps } from '@/components/admin/McpGrantsPanel'

function grant(key: string, granted_at = '2026-08-25T12:00:00Z'): McpGrant {
  return { grant_key: key, granted_at, granted_by: 661 }
}

function renderPanel(overrides: Partial<McpGrantsPanelProps> = {}) {
  const props: McpGrantsPanelProps = {
    items: [],
    loading: false,
    error: null,
    busy: null,
    onGrant: vi.fn(),
    onRevoke: vi.fn(),
    resolveGranter: () => 'ops@odin.test',
    isSelf: false,
    ...overrides,
  }
  render(<McpGrantsPanel {...props} />)
  return props
}

afterEach(() => cleanup())

describe('McpGrantsPanel', () => {
  it('renders every grant with its raw key, so an admin can cross-reference', () => {
    renderPanel()
    for (const key of [
      'mcp-hrms',
      'mcp-izone',
      'mcp-ems',
      'mcp.hrms.full',
      'mcp.hrms.tasks',
      'mcp.ems.query',
    ]) {
      expect(screen.getByText(key)).not.toBeNull()
    }
  })

  it('grants a key by ticking its box', () => {
    const props = renderPanel()
    fireEvent.click(screen.getByLabelText('Staff directory'))
    expect(props.onGrant).toHaveBeenCalledWith('mcp-hrms')
  })

  it('revokes a held key by unticking its box', () => {
    const props = renderPanel({ items: [grant('mcp-hrms')] })
    fireEvent.click(screen.getByLabelText('Staff directory'))
    expect(props.onRevoke).toHaveBeenCalledWith('mcp-hrms')
  })

  // The POST deliberately does not rewrite granted_at — the original insert is
  // the audit fact — so a re-grant must never read as "just now".
  it('renders the timestamp it was given, absolutely', () => {
    renderPanel({ items: [grant('mcp-hrms', '2026-08-01T12:00:00Z')] })
    expect(screen.getByText(/1 Aug 2026/)).not.toBeNull()
    expect(screen.queryByText(/just now/i)).toBeNull()
    expect(screen.queryByText(/ago/i)).toBeNull()
  })

  it('names who granted it', () => {
    renderPanel({ items: [grant('mcp-hrms')] })
    expect(screen.getByText(/ops@odin.test/)).not.toBeNull()
  })

  it('falls back to the admin id when the granter cannot be resolved', () => {
    renderPanel({ items: [grant('mcp-hrms')], resolveGranter: () => null })
    expect(screen.getByText(/admin #661/)).not.toBeNull()
  })

  // The hint is copy. It must never take a control away.
  it('warns about a permission held without its role, and keeps the toggle usable', () => {
    const props = renderPanel({ items: [grant('mcp.ems.query')] })
    expect(screen.getByText(/No effect on its own/i)).not.toBeNull()
    const box = screen.getByLabelText('SQL console') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(props.onRevoke).toHaveBeenCalledWith('mcp.ems.query')
  })

  it('offers to grant the missing role in one explicit click', () => {
    const props = renderPanel({ items: [grant('mcp.ems.query')] })
    fireEvent.click(screen.getByRole('button', { name: /Also grant mcp-ems/ }))
    expect(props.onGrant).toHaveBeenCalledWith('mcp-ems')
  })

  // A role without its permission is complete and common. Silence.
  it('says nothing about a role held without its permissions', () => {
    renderPanel({ items: [grant('mcp-ems')] })
    expect(screen.queryByText(/No effect on its own/i)).toBeNull()
  })

  it('keeps an unrecognised key visible and revocable', () => {
    const props = renderPanel({ items: [grant('mcp-future-thing')] })
    expect(screen.getByText('mcp-future-thing')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Revoke mcp-future-thing/ }))
    expect(props.onRevoke).toHaveBeenCalledWith('mcp-future-thing')
  })

  it('disables every control while a write is in flight', () => {
    renderPanel({ busy: 'mcp-hrms' })
    const box = screen.getByLabelText('iZone access') as HTMLInputElement
    expect(box.disabled).toBe(true)
  })

  it('renders an error verbatim', () => {
    renderPanel({ error: 'Admin privileges required' })
    expect(screen.getByText('Admin privileges required')).not.toBeNull()
  })

  // Rule 1: a global admin holds nothing implicitly, and the controls must not
  // be hidden on their own row — they grant themselves, which is the audit row.
  it('tells an admin viewing themselves that admin confers nothing, with controls live', () => {
    renderPanel({ isSelf: true, items: [] })
    expect(screen.getByText(/does not confer tool access/i)).not.toBeNull()
    const box = screen.getByLabelText('Staff directory') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(false)
  })

  it('disclaims the tool mapping', () => {
    renderPanel()
    expect(screen.getByText(/decided by the MCP server/i)).not.toBeNull()
  })
})
