import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '@/components/chat/Composer'
import { CHAT_MESSAGE_MAX_LENGTH } from '@/lib/api'

function renderComposer(onSend = vi.fn()) {
  const view = render(
    <Composer
      onSend={onSend}
      onStop={vi.fn()}
      streaming={false}
      disabled={false}
      attachment={null}
      onPickFile={vi.fn()}
      onClearAttachment={vi.fn()}
    />,
  )
  return { ...view, onSend, box: screen.getByRole('textbox') }
}

// The gateway caps `message` at 8000 characters and answers a longer one with a
// 422. Blocking the send keeps the user's text instead of losing it to a
// round trip that was never going to succeed.
describe('Composer message length limit', () => {
  afterEach(cleanup)

  it('sends a message at exactly the limit', () => {
    const { box, onSend } = renderComposer()
    fireEvent.change(box, { target: { value: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH) } })
    const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('blocks the send one character over the limit', () => {
    const { box, onSend } = renderComposer()
    fireEvent.change(box, { target: { value: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) } })
    const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not submit an over-limit message on Enter either', () => {
    const { box, onSend } = renderComposer()
    fireEvent.change(box, { target: { value: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 5) } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('says by how much the message is too long', () => {
    const { box } = renderComposer()
    fireEvent.change(box, { target: { value: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 12) } })
    expect(screen.getByText(/Too long by 12 characters/i)).not.toBeNull()
    expect(box.getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps the ordinary hint until the limit is close', () => {
    const { box } = renderComposer()
    fireEvent.change(box, { target: { value: 'hello' } })
    expect(screen.getByText(/Enter to send/i)).not.toBeNull()
  })
})
