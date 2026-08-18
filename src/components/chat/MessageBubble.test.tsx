import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchFile: vi.fn() }
})

import { fetchFile } from '@/lib/api'
import { MessageBubble } from '@/components/chat/MessageBubble'
import type { UIMessage } from '@/hooks/useSessions'

const mockFetchFile = vi.mocked(fetchFile)

const OCR_CAVEAT =
  'Text read from image by OCR — check figures, dates and account numbers against the original.'
const SUPERSEDED = 'Superseded by a newer attachment — name this file to use it again.'

function assistant(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'Net pay is 6,518.00',
    status: 'done',
    ...overrides,
  }
}

function userWithImage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'u1',
    role: 'user',
    content: 'what does this say?',
    status: 'done',
    attachment: {
      fileId: 'img-1',
      filename: 'payslip.png',
      summaryLine: 'PNG image · 900 × 420',
      isImage: true,
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockFetchFile.mockReset()
  // A minimal stand-in: jsdom's Blob has no .stream(), so a real Response
  // cannot be constructed from one here.
  mockFetchFile.mockResolvedValue({
    blob: async () => new Blob(['x'], { type: 'image/png' }),
  } as Response)
  // jsdom implements neither object-URL method.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

// The model does not reliably relay read_image's own caveat (it has answered
// "NPR 6,518.00" off correctly-read text), so the UI must state it.
describe('OCR provenance note', () => {
  it('states the OCR caveat when the turn read an image', () => {
    render(<MessageBubble message={assistant({ ocr: { imageIds: ['img-1'] } })} />)
    expect(screen.getByText(OCR_CAVEAT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View image' })).toBeTruthy()
  })

  it('omits the caveat on a turn that read no image', () => {
    render(<MessageBubble message={assistant()} />)
    expect(screen.queryByText(OCR_CAVEAT)).toBeNull()
  })

  it('omits the caveat on a failed turn', () => {
    render(
      <MessageBubble
        message={assistant({ status: 'error', error: 'boom', ocr: { imageIds: ['img-1'] } })}
      />,
    )
    expect(screen.queryByText(OCR_CAVEAT)).toBeNull()
  })

  // Trace exposure can be off, so provenance may arrive with no recoverable id.
  it('still states the caveat when no image id is known', () => {
    render(<MessageBubble message={assistant({ ocr: { imageIds: [] } })} />)
    expect(screen.getByText(OCR_CAVEAT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View image' })).toBeNull()
  })

  it('numbers the buttons when several images were read', () => {
    render(<MessageBubble message={assistant({ ocr: { imageIds: ['a', 'b'] } })} />)
    expect(screen.getByRole('button', { name: 'View image 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View image 2' })).toBeTruthy()
  })

  it('opens the image in a dialog, fetched with the authenticated client', async () => {
    render(<MessageBubble message={assistant({ ocr: { imageIds: ['img-1'] } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'View image' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('img-1'))
    await waitFor(() => expect(screen.getByAltText('Attached image').getAttribute('src')).toBe('blob:preview'))
  })
})

describe('user attachment bubble', () => {
  it('offers a full-size view of an attached image', async () => {
    render(<MessageBubble message={userWithImage()} />)
    fireEvent.click(screen.getByRole('button', { name: 'View payslip.png full size' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(mockFetchFile).toHaveBeenCalledWith('img-1'))
  })

  // Only the newest attachment set is active server-side.
  it('marks a superseded attachment', () => {
    render(<MessageBubble message={userWithImage()} attachmentSuperseded />)
    expect(screen.getByText(SUPERSEDED)).toBeTruthy()
  })

  it('does not mark the newest attachment as superseded', () => {
    render(<MessageBubble message={userWithImage()} />)
    expect(screen.queryByText(SUPERSEDED)).toBeNull()
  })
})
