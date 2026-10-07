import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  it('draws a content slide as a 16:9 slide on the template artwork, title 20 pt bold in the header box as in the .pptx', async () => {
    render(<FilePreviewPanel file={{ id: 'f1' }} onClose={vi.fn()} />)

    const box = await screen.findByTestId('slide-title-box')
    const title = screen.getByRole('heading', { name: 'Hello' })
    expect(box.contains(title)).toBe(true)
    // create_pptx's _HEADER_TITLE_BOX: left of the logo, above the divider.
    expect(box.style.left).toBe('2.5%')
    expect(box.style.top).toBe('2%')
    expect(box.style.width).toBe('80%')
    expect(box.style.height).toBe('13%')
    // The deck's own CONTENT_TITLE_PT: 20 pt on a 96 dpi slide is 26.67 px.
    expect(parseFloat(title.style.fontSize)).toBeCloseTo(26.667, 2)
    expect(title.className).toContain('font-bold')
    // Rendered once — the title is never repeated in the body.
    expect(screen.getAllByText('Hello')).toHaveLength(1)
    expect(screen.getByText('point one')).not.toBeNull()

    // The whole slide is the template's full-bleed master artwork, at 1280 x 720.
    await waitFor(() => {
      const slide = box.parentElement!
      expect(slide.style.backgroundImage).toContain('blob:art')
      expect(slide.style.width).toBe('1280px')
      expect(slide.style.height).toBe('720px')
    })
  })
})
