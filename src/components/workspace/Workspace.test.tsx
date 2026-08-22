import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Department, DepartmentRole } from '@/lib/api'

const departmentState = {
  departments: [] as Department[],
  loading: false,
  error: null as string | null,
  reload: async () => {},
  roleFor: () => null,
}
let isAdmin = false

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'nina@odin.test', role: 'member' }, logout: vi.fn(), isAdmin }),
}))
vi.mock('@/hooks/useDepartments', () => ({ useDepartments: () => departmentState }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }))
vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({ health: null, reachable: true, loading: false, error: null }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: [], activeId: null, messages: [], sending: false, loadingThread: false,
    send: vi.fn(), retry: vi.fn(), stop: vi.fn(), newChat: vi.fn(),
    selectSession: vi.fn(), removeSession: vi.fn(),
  }),
}))
vi.mock('@/components/layout/Header', () => ({ Header: () => <div /> }))
vi.mock('@/components/chat/ChatPanel', () => ({ ChatPanel: () => <div>chat-panel</div> }))
vi.mock('@/components/files/FilesPage', () => ({ FilesPage: () => <div /> }))
vi.mock('@/components/admin/NrbOpsPage', () => ({ NrbOpsPage: () => <div /> }))
vi.mock('@/components/admin/AdminRagPage', () => ({
  AdminRagPage: ({ isAdmin: admin }: { isAdmin: boolean }) => (
    <div>rag-screen admin:{String(admin)}</div>
  ),
}))

import { Workspace } from '@/components/workspace/Workspace'

function dept(role: DepartmentRole): Department {
  return { id: 1, code: 'finance', name: 'Finance', is_active: true, created_at: '2026-08-01T00:00:00Z', role }
}

function renderAdminRoute(state: Partial<typeof departmentState>, admin = false) {
  Object.assign(departmentState, { departments: [], loading: false, error: null }, state)
  isAdmin = admin
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Workspace />
    </MemoryRouter>,
  )
}

describe('Workspace /admin access', () => {
  // jsdom ships no matchMedia, and the shell reads it to decide the sidebar.
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('turns away someone who only views departments', async () => {
    renderAdminRoute({ departments: [dept('viewer')] })
    await waitFor(() => expect(screen.getByText('chat-panel')).not.toBeNull())
    expect(screen.queryByText(/rag-screen/)).toBeNull()
  })

  it('lets a non-admin editor in, without the global admin controls', async () => {
    renderAdminRoute({ departments: [dept('editor')] })
    await waitFor(() => expect(screen.getByText(/rag-screen/)).not.toBeNull())
    expect(screen.getByText(/admin:false/)).not.toBeNull()
  })

  it('lets a global admin in with no grants at all', async () => {
    renderAdminRoute({ departments: [] }, true)
    await waitFor(() => expect(screen.getByText(/admin:true/)).not.toBeNull())
  })

  // The department list arrives after the first paint, so deciding on an empty
  // list would bounce every editor to the chat before their grants load.
  it('waits for the department list instead of redirecting mid-load', () => {
    renderAdminRoute({ departments: [], loading: true })
    expect(screen.queryByText('chat-panel')).toBeNull()
    expect(screen.queryByText(/rag-screen/)).toBeNull()
  })
})
