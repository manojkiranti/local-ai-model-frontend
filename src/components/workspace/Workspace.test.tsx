import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Department, DepartmentRole, SessionSummary } from '@/lib/api'
import type { ChatPanel } from '@/components/chat/ChatPanel'

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
const sessionState = {
  sessions: [] as SessionSummary[],
  activeId: null as string | null,
}
const chat = {
  send: vi.fn(),
  newChat: vi.fn(),
  // Stands in for the real hook's synchronous `setActiveId`, which lands in
  // the same render as the scope pin that precedes it.
  selectSession: vi.fn((id: string) => {
    sessionState.activeId = id
  }),
}
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({
    ...sessionState, messages: [], sending: false, loadingThread: false,
    retry: vi.fn(), stop: vi.fn(), removeSession: vi.fn(), ...chat,
  }),
}))
vi.mock('@/components/layout/Header', () => ({ Header: () => <div /> }))
type ChatPanelProps = React.ComponentProps<typeof ChatPanel>
const chatPanel = vi.fn<(props: ChatPanelProps) => void>()
vi.mock('@/components/chat/ChatPanel', () => ({
  ChatPanel: (props: ChatPanelProps) => {
    chatPanel(props)
    return <div>chat-panel</div>
  },
}))
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

function named(code: string, name: string): Department {
  return { id: 1, code, name, is_active: true, created_at: '2026-08-01T00:00:00Z', role: 'viewer' }
}

const PROD = [named('it', 'IT'), named('nrb', 'Nepal Rastra Bank'), named('policy', 'Policy')]

function row(id: string, title: string, department?: string | null): SessionSummary {
  return {
    id,
    title,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    message_count: 2,
    ...(department === undefined ? {} : { department }),
  }
}

/** What the chat panel was last told the scope is. */
const shownScope = () => chatPanel.mock.lastCall?.[0].activeDepartment
const panel = () => chatPanel.mock.lastCall![0]

describe('Workspace chat scope', () => {
  const renderChat = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <Workspace />
      </MemoryRouter>,
    )

  beforeEach(() => {
    // Desktop width, so the sidebar and its conversation list are mounted.
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    window.localStorage.clear()
    Object.assign(departmentState, { departments: PROD, loading: false, error: null })
    Object.assign(sessionState, { sessions: [], activeId: null })
    isAdmin = false
    chatPanel.mockClear()
    chat.send.mockClear()
    chat.newChat.mockClear()
    chat.selectSession.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('opens the chat in NRB rather than General', () => {
    renderChat()

    expect(shownScope()).toBe('nrb')
  })

  it('opens in General for a user who holds no department', () => {
    departmentState.departments = []

    renderChat()

    expect(shownScope()).toBeNull()
  })

  it('shows the department a reopened chat belongs to', () => {
    sessionState.sessions = [row('s-it', 'Backup policy question', 'it')]
    renderChat()

    fireEvent.click(screen.getByText('Backup policy question'))

    expect(chat.selectSession).toHaveBeenCalledWith('s-it')
    expect(shownScope()).toBe('it')
  })

  it('shows General for a reopened general chat', () => {
    sessionState.sessions = [row('s-gen', 'Draft an email', null)]
    renderChat()

    fireEvent.click(screen.getByText('Draft an email'))

    expect(shownScope()).toBeNull()
  })

  // The bug this replaces: every reopened chat read as General, NRB ones too.
  it('shows no scope for a reopened chat when the gateway does not say its department', () => {
    sessionState.sessions = [row('s-old', 'Capital requirements')]
    renderChat()

    fireEvent.click(screen.getByText('Capital requirements'))

    expect(shownScope()).toBeUndefined()
  })

  // The chat started here in NRB; its row is from a gateway that sends no
  // `department`. Clicking the already-open chat must not forget what we know.
  it('keeps the known scope when the open chat is clicked again', () => {
    const view = renderChat()
    act(() => panel().onDepartmentChange('policy'))
    act(() => panel().onSend('first question', undefined, 'policy'))
    Object.assign(sessionState, { activeId: 's-new', sessions: [row('s-new', 'First question')] })
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Workspace />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('First question'))

    expect(shownScope()).toBe('policy')
  })

  it('starts a new chat in the department picked', () => {
    renderChat()

    act(() => panel().onDepartmentChange('policy'))

    expect(chat.newChat).toHaveBeenCalledTimes(1)
    expect(shownScope()).toBe('policy')
  })

  // A first turn sent before the list landed went to the gateway as General;
  // the list arriving afterwards must not relabel that chat as NRB.
  it('keeps General for a first turn sent while the departments were loading', () => {
    Object.assign(departmentState, { departments: [], loading: true })
    const view = renderChat()
    expect(shownScope()).toBeUndefined()

    act(() => panel().onSend('quick question', undefined, undefined))
    Object.assign(departmentState, { departments: PROD, loading: false })
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Workspace />
      </MemoryRouter>,
    )

    expect(chat.send).toHaveBeenCalledWith('quick question', undefined, undefined)
    expect(shownScope()).toBeNull()
  })
})
