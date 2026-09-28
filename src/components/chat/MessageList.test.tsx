import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MessageList } from '@/components/chat/MessageList'
import type { UIMessage } from '@/hooks/useSessions'

// jsdom implements no scrolling; the auto-scroll effect only needs to not throw.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function message(id: string, role: 'user' | 'assistant'): UIMessage {
  return { id, role, content: `body ${id}`, status: 'done' }
}

function renderList(
  props: Partial<React.ComponentProps<typeof MessageList>> = {},
) {
  return render(
    <MessageList
      messages={props.messages ?? [message('m1', 'user'), message('m2', 'assistant')]}
      onExample={props.onExample ?? vi.fn()}
      canSend={props.canSend ?? true}
      scope={'scope' in props ? props.scope : null}
      departmentName={props.departmentName}
      hasOlder={props.hasOlder}
      loadingOlder={props.loadingOlder}
      onLoadOlder={props.onLoadOlder}
    />,
  )
}

// A thread arrives one page at a time, newest page first, so the control that
// walks backwards through history appears only when an older page exists.
describe('MessageList older-page control', () => {
  afterEach(cleanup)

  it('offers nothing when the thread is fully loaded', () => {
    renderList({ hasOlder: false })
    expect(screen.queryByRole('button', { name: /load older messages/i })).toBeNull()
  })

  it('requests the older page when used', () => {
    const onLoadOlder = vi.fn()
    renderList({ hasOlder: true, onLoadOlder })
    fireEvent.click(screen.getByRole('button', { name: /load older messages/i }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('disables the control while the older page is in flight', () => {
    renderList({ hasOlder: true, loadingOlder: true })
    const button = screen.getByRole('button', {
      name: /loading older messages/i,
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  // The regression this whole feature could quietly cause: prepending an older
  // page changes `messages.length`, and auto-scrolling on that would throw the
  // reader to the newest message the moment they asked to see the oldest.
  it('does not scroll to the bottom when an older page is prepended', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const newest = [message('m3', 'user'), message('m4', 'assistant')]
    const { rerender } = renderList({ messages: newest, hasOlder: true })
    scrollIntoView.mockClear()

    rerender(
      <MessageList
        messages={[message('m1', 'user'), message('m2', 'assistant'), ...newest]}
        onExample={vi.fn()}
        canSend
        scope={null}
        hasOlder={false}
      />,
    )
    expect(scrollIntoView).not.toHaveBeenCalled()

    // A NEW message at the end still scrolls, which is the behaviour we keep.
    rerender(
      <MessageList
        messages={[...newest, message('m5', 'assistant')]}
        onExample={vi.fn()}
        canSend
        scope={null}
        hasOlder={false}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('keeps the empty state free of paging chrome', () => {
    renderList({ messages: [], hasOlder: true })
    expect(screen.queryByRole('button', { name: /load older messages/i })).toBeNull()
  })
})

// The starter cards used to be one list for every tab, so the NRB tab offered
// HR-system cards that fail on a deployment without HRMS.
describe('MessageList starter cards', () => {
  afterEach(cleanup)

  it('sends a tested NRB question from the NRB tab', () => {
    const onExample = vi.fn()
    renderList({ messages: [], scope: 'nrb', departmentName: 'Nepal Rastra Bank', onExample })

    fireEvent.click(screen.getByRole('button', { name: /Interest rates/i }))

    expect(onExample).toHaveBeenCalledWith("What is NRB's interest rate corridor and how does it work?")
    expect(screen.queryByRole('button', { name: /HR system/i })).toBeNull()
  })

  it('offers General no HR-system card', () => {
    renderList({ messages: [], scope: null })

    expect(screen.getByRole('button', { name: /Web research/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /HR system/i })).toBeNull()
  })

  it('offers no cards while the scope is unknown', () => {
    renderList({ messages: [], scope: undefined })

    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
