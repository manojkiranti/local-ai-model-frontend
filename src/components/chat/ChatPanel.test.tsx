import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Department } from '@/lib/api'
import type { UIMessage } from '@/hooks/useSessions'
import { ChatPanel } from '@/components/chat/ChatPanel'

function named(code: string, name: string): Department {
  return { id: 1, code, name, is_active: true, created_at: '2026-08-01T00:00:00Z', role: 'viewer' }
}

const PROD = [named('it', 'IT'), named('nrb', 'Nepal Rastra Bank'), named('policy', 'Policy')]

type Props = React.ComponentProps<typeof ChatPanel>

function props(overrides: Partial<Props> = {}): Props {
  return {
    messages: [],
    sending: false,
    loadingThread: false,
    reachable: true,
    onSend: vi.fn(),
    onRetry: vi.fn(),
    onStop: vi.fn(),
    departments: PROD,
    departmentsLoading: false,
    departmentsError: null,
    activeDepartment: null,
    onDepartmentChange: vi.fn(),
    hasOlderMessages: false,
    loadingOlder: false,
    onLoadOlder: vi.fn(),
    ...overrides,
  }
}

const notice = () => screen.queryByRole('note')

// jsdom implements no scrolling; the thread scrolls its last message into view.
Element.prototype.scrollIntoView ??= () => {}

describe('ChatPanel General notice', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('tells a General chat that no documents are searched', () => {
    render(<ChatPanel {...props()} />)

    expect(notice()?.textContent).toMatch(/General chat doesn't search department documents/)
  })

  it('says nothing about General in a department chat', () => {
    render(<ChatPanel {...props({ activeDepartment: 'nrb' })} />)

    expect(notice()).toBeNull()
  })

  // Unknown is not General: telling an NRB chat that it searches nothing would
  // be the same false label the unknown state exists to avoid.
  it('says nothing about General while the scope is unknown', () => {
    render(<ChatPanel {...props({ activeDepartment: undefined })} />)

    expect(notice()).toBeNull()
  })

  it('warns that switching leaves a General chat that already has turns', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', content: 'what is the leave policy', status: 'done' },
      { id: 'a1', role: 'assistant', content: 'I cannot search documents here.', status: 'done' },
    ]

    render(<ChatPanel {...props({ messages })} />)

    expect(
      within(notice()!).getByRole('button', { name: 'Start a new chat in Nepal Rastra Bank' }),
    ).not.toBeNull()
  })

  // The switch starts a new chat; the question the user was typing must survive
  // it so they can send it where the documents are.
  it('keeps the draft when a department is chosen from the notice', () => {
    const onDepartmentChange = vi.fn()
    const view = render(<ChatPanel {...props({ onDepartmentChange })} />)
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'What is the minimum capital requirement?' },
    })

    // The bar has a chip of the same name; this is the notice's own button.
    fireEvent.click(within(notice()!).getByRole('button', { name: 'Nepal Rastra Bank' }))
    expect(onDepartmentChange).toHaveBeenCalledWith('nrb')
    view.rerender(<ChatPanel {...props({ onDepartmentChange, activeDepartment: 'nrb' })} />)

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'What is the minimum capital requirement?',
    )
    expect(notice()).toBeNull()
  })
})
