import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Its own file because the template artwork is cached at module level: the
// main FilePreviewPanel suite never loads it, so the header band is only
// reachable in a fresh module graph where the branding fetch succeeds.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const art = () => Promise.resolve({ blob: async () => new Blob(['img']) } as Response)
  return {
    ...actual,
    fetchFile: vi.fn(),
    fetchFilePreview: vi.fn(),
    fetchPptxCoverBackground: vi.fn(art),
    fetchPptxHeaderBackground: vi.fn(art),
  }
})

import { fetchFile, fetchFilePreview } from '@/lib/api'
import { FilePreviewPanel } from '@/components/chat/FilePreviewPanel'

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

beforeEach(() => {
  vi.mocked(fetchFile).mockResolvedValue({
    headers: new Headers({ 'Content-Type': PPTX, 'Content-Disposition': 'attachment; filename="d.pptx"' }),
    blob: async () => new Blob(['body'], { type: PPTX }),
  } as Response)
  vi.mocked(fetchFilePreview).mockResolvedValue({
    title: '',
    subtitle: '',
    slides: [{ title: 'Hello', bullets: ['point one'] }],
  })
  URL.createObjectURL = vi.fn(() => 'blob:art')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('FilePreviewPanel slide header', () => {
  it('puts a content slide title inside the branded header band, above the divider', async () => {
    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    const header = await screen.findByTestId('slide-header')
    const title = screen.getByRole('heading', { name: 'Hello' })
    expect(header.contains(title)).toBe(true)
    // Rendered once — not repeated below the band as the plain fallback does.
    expect(screen.getAllByText('Hello')).toHaveLength(1)
    expect(screen.getByText('point one')).not.toBeNull()
  })
})
