import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchFile: vi.fn(), fetchFilePreview: vi.fn() }
})

import { fetchFile, fetchFilePreview, GatewayError } from '@/lib/api'
import { FilePreviewPanel } from '@/components/chat/FilePreviewPanel'

const mockFetchFile = vi.mocked(fetchFile)
const mockFetchFilePreview = vi.mocked(fetchFilePreview)

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function response(contentType: string, disposition: string): Response {
  return {
    headers: new Headers({ 'Content-Type': contentType, 'Content-Disposition': disposition }),
    blob: async () => new Blob(['body'], { type: contentType }),
  } as Response
}

beforeEach(() => {
  mockFetchFile.mockReset()
  mockFetchFilePreview.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:generated')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('FilePreviewPanel', () => {
  it('renders nothing when no file is selected', () => {
    const { container } = render(<FilePreviewPanel file={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a deck as scrollable slide pages from its structured preview', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="review.pptx"'))
    mockFetchFilePreview.mockResolvedValue({
      title: 'Quarterly Review',
      subtitle: 'Q3 2026',
      slides: [
        { title: 'Highlights', bullets: ['Revenue up', 'New branch'] },
        { title: 'Numbers', table: { headers: ['Metric', 'Q3'], rows: [['Revenue', '134']] } },
      ],
    })

    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    expect(await screen.findByText('Quarterly Review')).not.toBeNull()
    expect(screen.getByText('Q3 2026')).not.toBeNull()
    expect(screen.getByText('Highlights')).not.toBeNull()
    expect(screen.getByText('Revenue up')).not.toBeNull()
    expect(screen.getByText('Numbers')).not.toBeNull()
    expect(screen.getByText('134')).not.toBeNull()
    // cover + 2 content slides
    expect(screen.getByText('Page 1 / 3')).not.toBeNull()
    expect(screen.getByText('Page 3 / 3')).not.toBeNull()
  })

  it('sets the deck preview in Arial, matching the downloaded deck', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="review.pptx"'))
    mockFetchFilePreview.mockResolvedValue({ title: 'Deck', subtitle: '', slides: [{ title: 'One', bullets: ['a'] }] })

    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    const pages = await screen.findByTestId('deck-pages')
    expect(pages.className).toContain('font-[Arial,sans-serif]')
    // Always the light slide palette, so no text turns white in dark mode.
    expect(pages.className).toContain('deck-light')
    expect(pages.contains(screen.getByText('One'))).toBe(true)
  })

  it('renders a stats slide as highlight-number cards', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="review.pptx"'))
    mockFetchFilePreview.mockResolvedValue({
      title: '',
      subtitle: '',
      slides: [
        {
          title: 'Institution at a Glance',
          stats: [
            { value: '1956', label: 'Year established' },
            { value: '18.4B', label: 'USD in reserves', note: 'As of Mar 2024' },
          ],
        },
      ],
    })

    render(<FilePreviewPanel file={{ id: 'f5' }} onClose={vi.fn()} />)

    expect(await screen.findByText('1956')).not.toBeNull()
    expect(screen.getByText('Year established')).not.toBeNull()
    expect(screen.getByText('18.4B')).not.toBeNull()
    expect(screen.getByText('USD in reserves')).not.toBeNull()
    expect(screen.getByText('As of Mar 2024')).not.toBeNull()
  })

  it('renders an embedded image slide via its own authed fetch, with its caption', async () => {
    mockFetchFile.mockImplementation(async (id: string) => {
      if (id === 'deck-1') return response(PPTX, 'attachment; filename="deck.pptx"')
      if (id === 'img-1') return response('image/png', 'attachment; filename="photo.png"')
      throw new Error(`unexpected file id: ${id}`)
    })
    mockFetchFilePreview.mockResolvedValue({
      title: '',
      subtitle: '',
      slides: [{ title: 'Our Office', image: { file_id: 'img-1', caption: 'HQ, Kathmandu' } }],
    })

    render(<FilePreviewPanel file={{ id: 'deck-1' }} onClose={vi.fn()} />)

    const img = await screen.findByAltText('HQ, Kathmandu')
    expect(img.getAttribute('src')).toBe('blob:generated')
    expect(screen.getByText('HQ, Kathmandu')).not.toBeNull()
  })

  it('renders a bar chart slide with a legend for multiple series', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="deck.pptx"'))
    mockFetchFilePreview.mockResolvedValue({
      title: '',
      subtitle: '',
      slides: [
        {
          title: 'Revenue',
          chart: {
            chart_type: 'bar',
            labels: ['Q1', 'Q2'],
            series: [
              { name: 'Actual', data: [100, 120] },
              { name: 'Target', data: [110, 115] },
            ],
          },
        },
      ],
    })

    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    expect(await screen.findByText('Q1')).not.toBeNull()
    expect(screen.getByText('Q2')).not.toBeNull()
    expect(screen.getByText('Actual')).not.toBeNull()
    expect(screen.getByText('Target')).not.toBeNull()
  })

  it('renders a donut chart slide as proportional segments with percentages', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="deck.pptx"'))
    mockFetchFilePreview.mockResolvedValue({
      title: '',
      subtitle: '',
      slides: [
        {
          title: 'Split',
          chart: {
            chart_type: 'donut',
            labels: ['Retail', 'Corporate'],
            series: [{ data: [25, 75] }],
          },
        },
      ],
    })

    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    expect(await screen.findByText('Retail')).not.toBeNull()
    expect(screen.getByText('Corporate')).not.toBeNull()
    expect(screen.getByText('25%')).not.toBeNull()
    expect(screen.getByText('75%')).not.toBeNull()
  })

  it('falls back to a download message when a deck has no recorded preview', async () => {
    mockFetchFile.mockResolvedValue(response(PPTX, 'attachment; filename="old-deck.pptx"'))
    mockFetchFilePreview.mockRejectedValue(new GatewayError(404, 'no preview available for this file'))

    render(<FilePreviewPanel file={{ id: 'f2' }} onClose={vi.fn()} />)

    expect(await screen.findByText('No visual preview available for this file type yet.')).not.toBeNull()
    const link = screen.getByText('Download old-deck.pptx').closest('a')
    expect(link?.getAttribute('href')).toBe('blob:generated')
    // fetchFilePreview is only ever tried for decks — never for other formats.
    expect(mockFetchFilePreview).toHaveBeenCalledTimes(1)
  })

  it('never attempts a structured preview for a non-deck file', async () => {
    mockFetchFile.mockResolvedValue(response(XLSX, 'attachment; filename="sheet.xlsx"'))

    render(<FilePreviewPanel file={{ id: 'f3' }} onClose={vi.fn()} />)

    await screen.findByText('No visual preview available for this file type yet.')
    expect(mockFetchFilePreview).not.toHaveBeenCalled()
  })

  it('closes on the close button', async () => {
    mockFetchFile.mockResolvedValue(response(XLSX, 'attachment; filename="sheet.xlsx"'))
    const onClose = vi.fn()

    render(<FilePreviewPanel file={{ id: 'f4' }} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('sheet.xlsx')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
