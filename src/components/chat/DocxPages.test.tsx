import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchFile: vi.fn(), fetchFilePdf: vi.fn(), fetchFilePreview: vi.fn() }
})

const renderAsync = vi.fn()
vi.mock('docx-preview', () => ({ renderAsync: (...args: unknown[]) => renderAsync(...args) }))

import { fetchFile, fetchFilePdf, fetchFilePreview, GatewayError } from '@/lib/api'
import { FilePreviewPanel } from '@/components/chat/FilePreviewPanel'
import { neutralizeLinks } from '@/lib/docx-links'

const mockFetchFile = vi.mocked(fetchFile)
const mockFetchFilePdf = vi.mocked(fetchFilePdf)
const mockFetchFilePreview = vi.mocked(fetchFilePreview)

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function response(contentType: string, disposition: string): Response {
  return {
    headers: new Headers({ 'Content-Type': contentType, 'Content-Disposition': disposition }),
    blob: async () => new Blob(['body'], { type: contentType }),
  } as Response
}

beforeEach(() => {
  mockFetchFile.mockReset()
  mockFetchFilePdf.mockReset()
  mockFetchFilePreview.mockReset()
  renderAsync.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:generated')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

/** Resizes the document viewport only: the zoom menu (Radix) observes its own elements too. */
function stubResizeObserver() {
  const observers: { cb: ResizeObserverCallback; target: Element | null }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      entry: { cb: ResizeObserverCallback; target: Element | null }
      constructor(cb: ResizeObserverCallback) {
        this.entry = { cb, target: null }
        observers.push(this.entry)
      }
      observe(target: Element) {
        this.entry.target = target
      }
      unobserve() {}
      disconnect() {}
    },
  )
  const fit: { current: ((width: number) => void) | null } = {
    current: (width) => {
      for (const { cb, target } of observers) {
        if (target?.querySelector('[data-testid="docx-pages"]')) {
          cb([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
        }
      }
    },
  }
  return fit
}

/** A Letter page (816 px at 96 dpi). */
function renderLetterPage() {
  renderAsync.mockImplementation(async (_blob: Blob, el: HTMLElement) => {
    el.innerHTML = '<section class="docx"><p>MEMO</p></section>'
    Object.defineProperty(el.querySelector('section'), 'offsetWidth', { value: 816 })
  })
}

/** Radix opens its menu from the keyboard; jsdom has no real pointer events. */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

describe('Word preview fallback', () => {
  it('renders the .docx in the browser when the gateway has no PDF converter and no memo', async () => {
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="letter.docx"'))
    mockFetchFilePdf.mockRejectedValue(new GatewayError(503, 'Office to PDF conversion is not installed'))
    mockFetchFilePreview.mockRejectedValue(new GatewayError(404, 'no preview available for this file'))
    renderAsync.mockImplementation(async (_blob: Blob, el: HTMLElement) => {
      el.innerHTML = '<section class="docx"><p>Dear customer</p></section>'
    })

    render(<FilePreviewPanel file={{ id: 'd1' }} onClose={vi.fn()} />)

    expect(await screen.findByText('Dear customer')).not.toBeNull()
    const pages = screen.getByTestId('docx-pages')
    expect(pages.hidden).toBe(false)
    const [blob, , , options] = renderAsync.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    // Embedded HTML chunks stay unrendered; images are data URLs, not leaked blob URLs.
    expect(options).toMatchObject({ renderAltChunks: false, useBase64URL: true })
    expect(screen.queryByText('No visual preview available for this file type yet.')).toBeNull()
  })

  it('keeps the page geometry, lays out tabs, then zooms the page to the panel width', async () => {
    const fit = stubResizeObserver()
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="memo.docx"'))
    mockFetchFilePdf.mockRejectedValue(new GatewayError(503, 'unavailable'))
    mockFetchFilePreview.mockRejectedValue(new GatewayError(404, 'none'))
    renderLetterPage()

    try {
      render(<FilePreviewPanel file={{ id: 'd4' }} onClose={vi.fn()} />)
      await screen.findByText('MEMO')
      const pages = screen.getByTestId('docx-pages')

      // Floating rules and logos sit at fixed offsets: never reflow the page.
      // Real tab stops on, for the memo's To/From colons and its right-hand logo.
      const options = renderAsync.mock.calls[0][3]
      expect(options.ignoreWidth).toBeUndefined()
      expect(options.ignoreHeight).toBeUndefined()
      expect(options.experimental).toBe(true)

      act(() => fit.current!(408))
      // Unzoomed until the library's tab-stop timer has measured the page.
      expect(pages.dataset.scale).toBe('1.000')
      await waitFor(() => expect(pages.dataset.scale).toBe('0.500'))
      // Expanded to full screen: grows, but capped so text is not blown up.
      act(() => fit.current!(2000))
      expect(pages.dataset.scale).toBe('1.500')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('zooms to a chosen level from the header menu, and back to fit', async () => {
    const fit = stubResizeObserver()
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="memo.docx"'))
    mockFetchFilePdf.mockRejectedValue(new GatewayError(503, 'unavailable'))
    mockFetchFilePreview.mockRejectedValue(new GatewayError(404, 'none'))
    renderLetterPage()

    try {
      render(<FilePreviewPanel file={{ id: 'd5' }} onClose={vi.fn()} />)
      await screen.findByText('MEMO')
      const pages = screen.getByTestId('docx-pages')
      act(() => fit.current!(408))
      await waitFor(() => expect(pages.dataset.scale).toBe('0.500'))

      // The trigger shows the percentage "fit" resolved to.
      const trigger = screen.getByRole('button', { name: 'Zoom: fit to width' })
      // Reported up from the page in an effect, one commit after it scales.
      await waitFor(() => expect(trigger.textContent).toBe('50%'))

      openMenu(trigger)
      fireEvent.click(screen.getByRole('menuitem', { name: '200%' }))
      expect(pages.dataset.scale).toBe('2.000')
      const zoomed = screen.getByRole('button', { name: 'Zoom: 200%' })
      expect(zoomed.textContent).toBe('200%')
      // A fixed level ignores panel resizes.
      act(() => fit.current!(600))
      expect(pages.dataset.scale).toBe('2.000')

      openMenu(zoomed)
      fireEvent.click(screen.getByRole('menuitem', { name: /Zoom to fit/ }))
      expect(pages.dataset.scale).toBe((600 / 816).toFixed(3))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows no zoom control when the gateway supplies the PDF', async () => {
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="letter.docx"'))
    mockFetchFilePdf.mockResolvedValue(response('application/pdf', ''))

    render(<FilePreviewPanel file={{ id: 'd6' }} onClose={vi.fn()} />)

    await screen.findByTitle('Preview of letter.docx')
    expect(screen.queryByRole('button', { name: /^Zoom:/ })).toBeNull()
  })

  it('prefers the gateway PDF rendering and never loads the browser renderer', async () => {
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="letter.docx"'))
    mockFetchFilePdf.mockResolvedValue(response('application/pdf', ''))

    render(<FilePreviewPanel file={{ id: 'd2' }} onClose={vi.fn()} />)

    expect(await screen.findByTitle('Preview of letter.docx')).not.toBeNull()
    expect(renderAsync).not.toHaveBeenCalled()
  })

  it('offers the download when the document cannot be parsed', async () => {
    mockFetchFile.mockResolvedValue(response(DOCX, 'attachment; filename="broken.docx"'))
    mockFetchFilePdf.mockRejectedValue(new GatewayError(503, 'unavailable'))
    mockFetchFilePreview.mockRejectedValue(new GatewayError(404, 'none'))
    renderAsync.mockRejectedValue(new Error('end of central directory not found'))

    render(<FilePreviewPanel file={{ id: 'd3' }} onClose={vi.fn()} />)

    expect(await screen.findByText('This Word document could not be previewed.')).not.toBeNull()
    const link = screen.getByText('Download broken.docx').closest('a')
    expect(link?.getAttribute('href')).toBe('blob:generated')
    await waitFor(() => expect(screen.getByTestId('docx-pages').hidden).toBe(true))
  })
})

describe('neutralizeLinks', () => {
  it('strips script and data links, keeps web, mail and in-document links', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<a href="javascript:alert(1)">js</a>',
      '<a href=" JavaScript:alert(1)">js2</a>',
      '<a href="data:text/html,x">data</a>',
      '<a href="https://example.com">web</a>',
      '<a href="mailto:a@b.c">mail</a>',
      '<a href="#_Toc1">toc</a>',
    ].join('')

    neutralizeLinks(root)

    const link = (text: string) => Array.from(root.querySelectorAll('a')).find((a) => a.textContent === text)!
    expect(link('js').hasAttribute('href')).toBe(false)
    expect(link('js2').hasAttribute('href')).toBe(false)
    expect(link('data').hasAttribute('href')).toBe(false)
    expect(link('web').getAttribute('target')).toBe('_blank')
    expect(link('web').getAttribute('rel')).toBe('noopener noreferrer')
    expect(link('mail').getAttribute('href')).toBe('mailto:a@b.c')
    expect(link('toc').getAttribute('href')).toBe('#_Toc1')
    expect(link('toc').hasAttribute('target')).toBe(false)
  })
})
