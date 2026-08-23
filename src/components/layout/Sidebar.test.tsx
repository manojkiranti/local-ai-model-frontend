import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'

interface RenderProps {
  isAdmin?: boolean
  canManageRag?: boolean
  sessions?: React.ComponentProps<typeof Sidebar>['sessions']
  hasMoreSessions?: boolean
  loadingMoreSessions?: boolean
  onLoadMoreSessions?: () => void
}

function renderSidebar(props: RenderProps = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        sessions={props.sessions ?? []}
        activeId={null}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onDelete={vi.fn()}
        onCollapse={vi.fn()}
        onNavigate={vi.fn()}
        isAdmin={props.isAdmin ?? false}
        canManageRag={props.canManageRag ?? false}
        email="nina@odin.test"
        role={props.isAdmin ? 'admin' : 'member'}
        onLogout={vi.fn()}
        hasMoreSessions={props.hasMoreSessions ?? false}
        loadingMoreSessions={props.loadingMoreSessions ?? false}
        onLoadMoreSessions={props.onLoadMoreSessions ?? vi.fn()}
      />
    </MemoryRouter>,
  )
}

function session(id: string, title: string) {
  return {
    id,
    title,
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
    message_count: 2,
  }
}

describe('Sidebar navigation', () => {
  afterEach(cleanup)

  it('hides the RAG screen from someone who curates nothing', () => {
    renderSidebar({ canManageRag: false })
    expect(screen.queryByRole('button', { name: 'RAG Admin' })).toBeNull()
  })

  // An editor or owner in ANY department needs the entry point, even though they
  // are not a global admin.
  it('offers the RAG screen to a non-admin who curates a department', () => {
    renderSidebar({ canManageRag: true })
    expect(screen.getByRole('button', { name: 'RAG Admin' })).not.toBeNull()
  })

  // `/v1/nrb/*` is still gated on the global role, so a department curator does
  // not get it.
  it('keeps NRB updates for global admins only', () => {
    renderSidebar({ canManageRag: true, isAdmin: false })
    expect(screen.queryByRole('button', { name: 'NRB Updates' })).toBeNull()
    cleanup()
    renderSidebar({ canManageRag: true, isAdmin: true })
    expect(screen.getByRole('button', { name: 'NRB Updates' })).not.toBeNull()
  })

  // `GET /users` and `PATCH /users/{id}` are global-admin routes, so the Users
  // directory is offered to admins alone — a department curator does not get it.
  it('keeps the Users directory for global admins only', () => {
    renderSidebar({ canManageRag: true, isAdmin: false })
    expect(screen.queryByRole('button', { name: 'Users' })).toBeNull()
    cleanup()
    renderSidebar({ isAdmin: true })
    expect(screen.getByRole('button', { name: 'Users' })).not.toBeNull()
  })
})

// The sidebar holds one page at a time, so the control that fetches the next
// one has to appear exactly when the server says another page exists.
describe('Sidebar conversation paging', () => {
  afterEach(cleanup)

  it('offers no paging control once the cursor is exhausted', () => {
    renderSidebar({ sessions: [session('s1', 'First')], hasMoreSessions: false })
    expect(screen.queryByRole('button', { name: /load older conversations/i })).toBeNull()
  })

  it('loads the next page when the control is used', () => {
    const onLoadMoreSessions = vi.fn()
    renderSidebar({
      sessions: [session('s1', 'First')],
      hasMoreSessions: true,
      onLoadMoreSessions,
    })
    fireEvent.click(screen.getByRole('button', { name: /load older conversations/i }))
    expect(onLoadMoreSessions).toHaveBeenCalledTimes(1)
  })

  it('disables the control while a page is in flight', () => {
    renderSidebar({
      sessions: [session('s1', 'First')],
      hasMoreSessions: true,
      loadingMoreSessions: true,
    })
    const button = screen.getByRole('button', { name: /loading/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  // The gateway has no search parameter on this route, so the filter only ever
  // sees rows already loaded. The empty state must not claim more than that.
  it('says a search covered only the loaded conversations', () => {
    renderSidebar({ sessions: [session('s1', 'Payroll')], hasMoreSessions: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No loaded chats match/i)).not.toBeNull()
    expect(screen.getByText(/Load more to search further back/i)).not.toBeNull()
  })
})
