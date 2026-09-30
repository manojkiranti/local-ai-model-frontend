import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchFile: vi.fn() }
})

import { fetchFile } from '@/lib/api'
import { FileCard } from '@/components/agent/FileCard'

const mockFetchFile = vi.mocked(fetchFile)

/** A gateway download response with the given headers and body type. */
function response(contentType: string, disposition: string): Response {
  return {
    headers: new Headers({
      'Content-Type': contentType,
      'Content-Disposition': disposition,
    }),
    blob: async () => new Blob(['body'], { type: contentType }),
  } as Response
}

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

beforeEach(() => {
  mockFetchFile.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:generated')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('FileCard', () => {
  // A generated deck is download-only: no browser-renderable preview exists for
  // it, so it must fall through the image/HTML branches to the chip.
  it('offers a PowerPoint deck as a download chip named by Content-Disposition', async () => {
    mockFetchFile.mockResolvedValue(
      response(PPTX, 'attachment; filename="quarterly-review.pptx"'),
    )

    render(<FileCard file={{ id: 'file-1', filename: 'ignored.bin' }} />)

    const link = await waitFor(() =>
      screen.getByText('quarterly-review.pptx').closest('a'),
    )
    expect(link).not.toBeNull()
    expect(link?.getAttribute('download')).toBe('quarterly-review.pptx')
    expect(link?.getAttribute('href')).toBe('blob:generated')
    // No inline preview for a deck.
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  // The chip's icon is the only thing distinguishing one download from another
  // at a glance, so a deck must not fall back to the generic file icon.
  // `lucide-<name>` is lucide-react's own class on every icon it renders.
  it('marks a deck with the presentation icon, not the generic file icon', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="deck.pptx"'))

    render(<FileCard file={{ id: 'file-4' }} />)

    await screen.findByText('deck.pptx')
    expect(document.querySelector('svg.lucide-presentation')).not.toBeNull()
    expect(document.querySelector('svg.lucide-file')).toBeNull()
  })

  it('previews a generated chart image inline', async () => {
    mockFetchFile.mockResolvedValue(
      response('image/svg+xml', 'attachment; filename="chart.svg"'),
    )

    render(<FileCard file={{ id: 'file-2' }} />)

    const img = await screen.findByAltText('chart.svg')
    expect(img.getAttribute('src')).toBe('blob:generated')
  })

  it('offers a Preview button that opens the file in the side panel, separate from downloading', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="deck.pptx"'))
    const onPreview = vi.fn()

    render(<FileCard file={{ id: 'file-5' }} onPreview={onPreview} />)

    const previewButton = await screen.findByRole('button', { name: 'Preview' })
    fireEvent.click(previewButton)
    expect(onPreview).toHaveBeenCalledWith({ id: 'file-5' })
  })

  it('omits the Preview button when no onPreview handler is given', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="deck.pptx"'))

    render(<FileCard file={{ id: 'file-6' }} />)

    await screen.findByText('deck.pptx')
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('falls back to the tool-reported filename when the header carries none', async () => {
    mockFetchFile.mockResolvedValue({
      headers: new Headers({ 'Content-Type': PPTX }),
      blob: async () => new Blob(['body'], { type: PPTX }),
    } as Response)

    render(<FileCard file={{ id: 'file-3', filename: 'deck.pptx' }} />)

    const link = await waitFor(() => screen.getByText('deck.pptx').closest('a'))
    expect(link?.getAttribute('download')).toBe('deck.pptx')
  })
})
