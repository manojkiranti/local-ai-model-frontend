import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, fetchDepartmentDocument: vi.fn() }
})

import { GatewayError, fetchDepartmentDocument, type Source } from '@/lib/api'
import { SourcesPanel } from '@/components/chat/SourcesPanel'

const mockFetchDocument = vi.mocked(fetchDepartmentDocument)

const VERIFY_NOTE =
  'machine-recovered — VERIFY figures, dates and names against the source'

function source(overrides: Partial<Source> = {}): Source {
  return {
    document_id: 'doc-1',
    title: 'Leave policy',
    department_code: 'hr',
    file_name: 'leave-policy.pdf',
    file_type: 'pdf',
    pages: [4, 5, 6],
    cited: true,
    download_url: '/v1/departments/hr/documents/doc-1/download',
    ...overrides,
  }
}

const recovered = (overrides: Partial<Source> = {}) =>
  source({
    document_id: 'doc-nrb',
    title: 'Monetary Policy 2081/82',
    department_code: 'finance',
    file_name: 'monetary-policy.pdf',
    pages: [12],
    origin: 'nrb',
    source_url: 'https://www.nrb.org.np/monetary-policy',
    published_at: '2024-07-12',
    routes: ['native', 'ocr'],
    machine_recovered: true,
    verify_note: VERIFY_NOTE,
    download_url: '/v1/departments/finance/documents/doc-nrb/download',
    ...overrides,
  })

/** Anchor clicks are intercepted: jsdom cannot navigate to a blob: URL. */
const clicked: Array<{ href: string; download: string; target: string }> = []

beforeEach(() => {
  mockFetchDocument.mockReset()
  clicked.length = 0
  mockFetchDocument.mockResolvedValue({
    headers: new Headers({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="stored.pdf"',
    }),
    blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
  } as Response)
  // jsdom implements neither object-URL method.
  URL.createObjectURL = vi.fn(() => 'blob:doc')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download, target: this.target })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// `null` means the turn searched no corpus at all — a general chat, always. An
// empty "Sources" heading would claim a search that never happened.
describe('the three states of sources', () => {
  it('renders nothing when no corpus was searched', () => {
    const { container } = render(<SourcesPanel sources={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the field is absent', () => {
    const { container } = render(<SourcesPanel sources={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('says so when a search surfaced no document', () => {
    render(<SourcesPanel sources={[]} />)
    expect(
      screen.getByText(
        'Department documents were searched, but none was returned for this answer.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Related documents')).toBeNull()
  })

  it('lists a cited document with its pages', () => {
    render(<SourcesPanel sources={[source()]} />)
    expect(screen.getByText('Leave policy')).toBeTruthy()
    expect(screen.getByText('pp. 4–6')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy()
  })
})

// The model did not mark which claim came from where, so the entry must not be
// presented as the source of a specific sentence.
describe('grounded-but-uncited documents', () => {
  it('groups them as related, with the reason', () => {
    render(<SourcesPanel sources={[source({ cited: false })]} />)
    expect(screen.getByText('Related documents')).toBeTruthy()
    expect(
      screen.getByText(
        'The answer drew on these, but did not mark which part came from which document.',
      ),
    ).toBeTruthy()
  })

  it('keeps cited and related documents in separate groups', () => {
    render(
      <SourcesPanel
        sources={[source(), source({ document_id: 'doc-2', title: 'Old policy', cited: false })]}
      />,
    )
    expect(screen.getByText('Leave policy')).toBeTruthy()
    expect(screen.getByText('Old policy')).toBeTruthy()
    expect(screen.getByText('Related documents')).toBeTruthy()
  })
})

// The one non-cosmetic rule: this document's text was OCR'd or converted from a
// legacy Nepali font and no human has verified it, so a figure taken from it may
// be wrong. Visible text, not a tooltip.
describe('machine-recovered provenance', () => {
  it('renders the gateway verify_note as visible text', () => {
    render(<SourcesPanel sources={[recovered()]} />)
    const note = screen.getByText(VERIFY_NOTE)
    expect(note).toBeTruthy()
    expect(note.getAttribute('title')).toBeNull()
  })

  it('names how each page was extracted', () => {
    render(<SourcesPanel sources={[recovered()]} />)
    expect(screen.getByText('Pages extracted by: native text layer, OCR')).toBeTruthy()
  })

  it('links the official page so the original can be checked', () => {
    render(<SourcesPanel sources={[recovered()]} />)
    const link = screen.getByRole('link', { name: /Official page on www\.nrb\.org\.np/ })
    expect(link.getAttribute('href')).toBe('https://www.nrb.org.np/monetary-policy')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('shows the NRB publication date', () => {
    render(<SourcesPanel sources={[recovered()]} />)
    expect(screen.getByText('Published 2024-07-12')).toBeTruthy()
  })

  // Absent NRB fields must not read as "recovered" on an ordinary upload.
  it('warns on nothing for a plain department upload', () => {
    render(<SourcesPanel sources={[source()]} />)
    expect(screen.queryByText(VERIFY_NOTE)).toBeNull()
  })

  it('falls back to the standard caveat if the note is missing but the flag is set', () => {
    render(<SourcesPanel sources={[recovered({ verify_note: null })]} />)
    expect(screen.getByText(VERIFY_NOTE)).toBeTruthy()
  })

  // A native text layer is not a warning, but it is worth stating.
  it('states the extraction route without a warning when nothing was recovered', () => {
    render(
      <SourcesPanel
        sources={[
          source({ origin: 'nrb', routes: ['native'], machine_recovered: false }),
        ]}
      />,
    )
    expect(screen.getByText('Text: native text layer')).toBeTruthy()
    expect(screen.queryByText(VERIFY_NOTE)).toBeNull()
  })

  it('never renders a javascript: source_url as a link', () => {
    render(<SourcesPanel sources={[recovered({ source_url: 'javascript:alert(1)' })]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

// The route is behind JWT: an <a href> to it sends no bearer token and 401s.
describe('downloading a cited document', () => {
  it('fetches the server-derived link with the api client and saves a blob', async () => {
    render(<SourcesPanel sources={[source()]} />)
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() =>
      expect(mockFetchDocument).toHaveBeenCalledWith(
        '/v1/departments/hr/documents/doc-1/download',
      ),
    )
    await waitFor(() => expect(clicked.length).toBe(1))
    expect(clicked[0].href).toBe('blob:doc')
    // The name the server announced wins over the document's own file_name.
    expect(clicked[0].download).toBe('stored.pdf')
  })

  it('exposes no anchor pointing at the authenticated endpoint', () => {
    render(<SourcesPanel sources={[recovered()]} />)
    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
    expect(hrefs.some((href) => href.includes('/v1/departments'))).toBe(false)
  })

  it('offers no download when the gateway sent no link', () => {
    render(<SourcesPanel sources={[source({ download_url: null })]} />)
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull()
    expect(screen.getByText('No file')).toBeTruthy()
  })

  it('explains a 403 as a missing department grant', async () => {
    mockFetchDocument.mockRejectedValue(new GatewayError(403, 'No access to department hr'))
    render(<SourcesPanel sources={[source()]} />)
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() =>
      expect(
        screen.getByText("You don't have access to this department's documents."),
      ).toBeTruthy(),
    )
  })

  it('explains a 404 as a document that is gone', async () => {
    mockFetchDocument.mockRejectedValue(new GatewayError(404, 'Unknown document'))
    render(<SourcesPanel sources={[source()]} />)
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() =>
      expect(screen.getByText('This document is no longer available.')).toBeTruthy(),
    )
  })
})

// A browser can render a PDF/text/CSV, so those get a "View" (new tab); the
// Office formats it cannot render get download only.
describe('viewing a cited document in the browser', () => {
  it('offers View for a PDF and opens the authed blob in a new tab', async () => {
    render(<SourcesPanel sources={[source({ file_type: 'pdf' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    await waitFor(() =>
      expect(mockFetchDocument).toHaveBeenCalledWith(
        '/v1/departments/hr/documents/doc-1/download',
      ),
    )
    await waitFor(() => expect(clicked.length).toBe(1))
    // Opened, not saved: a _blank target and no download attribute.
    expect(clicked[0].href).toBe('blob:doc')
    expect(clicked[0].target).toBe('_blank')
    expect(clicked[0].download).toBe('')
  })

  it('offers View for text and CSV', () => {
    cleanup()
    render(<SourcesPanel sources={[source({ file_type: 'text' })]} />)
    expect(screen.getByRole('button', { name: /View/ })).toBeTruthy()
    cleanup()
    render(<SourcesPanel sources={[source({ file_type: 'csv' })]} />)
    expect(screen.getByRole('button', { name: /View/ })).toBeTruthy()
  })

  it('offers no View for docx or xlsx — download only', () => {
    render(<SourcesPanel sources={[source({ file_type: 'docx' })]} />)
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy()
    cleanup()
    render(<SourcesPanel sources={[source({ file_type: 'xlsx' })]} />)
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy()
  })

  // The button appears from file_type, but the actual open is gated on the
  // RESPONSE Content-Type: an unexpected type is saved, never opened in-tab.
  it('falls back to saving when the response is not a viewable type', async () => {
    mockFetchDocument.mockResolvedValue({
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="stored.pdf"',
      }),
      blob: async () => new Blob(['x'], { type: 'application/octet-stream' }),
    } as Response)
    render(<SourcesPanel sources={[source({ file_type: 'pdf' })]} />)
    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    await waitFor(() => expect(clicked.length).toBe(1))
    expect(clicked[0].target).toBe('')
    expect(clicked[0].download).toBe('stored.pdf')
  })
})
