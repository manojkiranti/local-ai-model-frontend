import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchDocumentPageCount: vi.fn(), fetchDocumentPage: vi.fn() }
})

import { GatewayError, fetchDocumentPage, fetchDocumentPageCount } from '@/lib/api'
import { ProtectedDocumentViewer } from '@/components/chat/ProtectedDocumentViewer'

const PAGES = '/v1/departments/nrb/documents/d1/pages'

beforeEach(() => {
  vi.mocked(fetchDocumentPageCount).mockReset().mockResolvedValue(3)
  vi.mocked(fetchDocumentPage)
    .mockReset()
    .mockResolvedValue({ blob: async () => new Blob(['png'], { type: 'image/png' }) } as Response)
  URL.createObjectURL = vi.fn(() => 'blob:page')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

function open(onClose = vi.fn()) {
  render(<ProtectedDocumentViewer title="Circular" pagesUrl={PAGES} onClose={onClose} />)
  return onClose
}

describe('ProtectedDocumentViewer', () => {
  it('renders every page as a non-draggable image fetched from pages_url', async () => {
    open()
    expect(await screen.findByAltText('Page 3')).toBeTruthy()
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(3)
    expect(images.every((img) => img.getAttribute('draggable') === 'false')).toBe(true)
    expect(vi.mocked(fetchDocumentPage)).toHaveBeenCalledWith(PAGES, 1, expect.anything())
    expect(screen.getByText(/View only — downloading, copying and printing are restricted\./)).toBeTruthy()
  })

  it('blocks print, save, copy and select-all shortcuts', async () => {
    open()
    await screen.findByAltText('Page 1')
    for (const key of ['p', 's', 'c', 'a']) {
      const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    const plain = new KeyboardEvent('keydown', { key: 'p', cancelable: true })
    window.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })

  it('blocks the context menu and copying inside the viewer', async () => {
    open()
    const dialog = await screen.findByRole('dialog')
    expect(fireEvent.contextMenu(dialog)).toBe(false)
    expect(fireEvent.copy(dialog)).toBe(false)
    expect(dialog.className).toContain('select-none')
  })

  it('blanks printing while open, and restores it on close', async () => {
    open()
    await screen.findByRole('dialog')
    expect(document.documentElement.classList.contains('protected-view-open')).toBe(true)
    cleanup()
    expect(document.documentElement.classList.contains('protected-view-open')).toBe(false)
  })

  it('closes on Escape and on the close button', async () => {
    const onClose = open()
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close document' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows the gateway error when the document cannot be opened', async () => {
    vi.mocked(fetchDocumentPageCount).mockRejectedValue(new GatewayError(404, 'Unknown document'))
    open()
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
    expect(await screen.findByText(/./, { selector: 'p.text-destructive' })).toBeTruthy()
  })
})
