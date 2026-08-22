import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'

function renderSidebar(props: { isAdmin?: boolean; canManageRag?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        sessions={[]}
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
      />
    </MemoryRouter>,
  )
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
