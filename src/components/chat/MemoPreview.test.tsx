import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchFile: vi.fn(),
    fetchFilePreview: vi.fn(),
    fetchFilePdf: vi.fn(),
    fetchMemoLogo: vi.fn(() => Promise.resolve({ blob: async () => new Blob(['png']) } as Response)),
  }
})

import { GatewayError, fetchFile, fetchFilePdf, fetchFilePreview, type MemoPreview } from '@/lib/api'
import { FilePreviewPanel } from '@/components/chat/FilePreviewPanel'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const MEMO: MemoPreview = {
  kind: 'memo',
  to: 'Chief Executive Officer',
  from: 'Compliance Department',
  subject: 'Approval for Fonepay V2 API Implementation',
  date: '5th August, 2025',
  sections: [
    { heading: 'Objective:', content: ['This memo seeks **approval** for X.'] },
    {
      heading: 'Risk and Mitigation:',
      content: [
        { heading: 'Unauthorized Access' },
        { bullets: ['**Risk**: leakage.', { text: 'Mitigation:', bullets: ['Encrypt.'] }] },
      ],
    },
  ],
  signatories: [
    { role: 'Prepared By', name: 'Shristi Bajracharya', designation: 'Assistant Compliance' },
    { role: 'Supported By', name: 'Dipendra Sharma', designation: 'Head Compliance' },
    { role: 'Supported By', name: 'Ranjeet Thakur', designation: 'Officer-DTE' },
    { role: 'Approved By', name: 'Roshan Kumar Neupane', designation: 'Chief Executive Officer' },
  ],
}

function docxResponse(): Response {
  return {
    headers: new Headers({ 'Content-Type': DOCX, 'Content-Disposition': 'attachment; filename="memo.docx"' }),
    blob: async () => new Blob(['docx'], { type: DOCX }),
  } as Response
}

beforeEach(() => {
  vi.mocked(fetchFile).mockReset().mockResolvedValue(docxResponse())
  vi.mocked(fetchFilePreview).mockReset().mockResolvedValue(MEMO)
  // No converter on this deployment: the panel falls back to drawing the memo.
  vi.mocked(fetchFilePdf).mockReset().mockRejectedValue(new GatewayError(503, 'not enabled'))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('Word file shown as PDF', () => {
  it('shows the gateway-rendered PDF in the panel, like a PDF', async () => {
    vi.mocked(fetchFilePdf).mockResolvedValue({
      blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
    } as Response)
    render(<FilePreviewPanel file={{ id: 'm1' }} onClose={vi.fn()} />)

    const frame = await screen.findByTitle('Preview of memo.docx')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('src')).toBe('blob:x')
    expect(fetchFilePdf).toHaveBeenCalledWith('m1')
    // The drawn memo is only the fallback.
    expect(screen.queryByTestId('memo-page')).toBeNull()
    expect(fetchFilePreview).not.toHaveBeenCalled()
  })
})

describe('memo preview when PDF conversion is unavailable', () => {
  it('draws a generated memo in the fixed format from its structured preview', async () => {
    render(<FilePreviewPanel file={{ id: 'm1' }} onClose={vi.fn()} />)

    const page = await screen.findByTestId('memo-page')
    const inPage = within(page)
    expect(inPage.getByRole('heading', { name: 'MEMO' })).toBeTruthy()
    expect(inPage.getByText('Chief Executive Officer', { selector: 'td' })).toBeTruthy()
    expect(inPage.getByText('Compliance Department')).toBeTruthy()
    // Sections lettered, sub-headings numbered, **bold** rendered as bold.
    const objective = inPage.getByRole('heading', { name: 'A. Objective:' })
    expect(objective.className).not.toContain('underline')
    expect(inPage.getByRole('heading', { name: 'B. Risk and Mitigation:' })).toBeTruthy()
    expect(inPage.getByText('Unauthorized Access', { exact: false }).textContent).toBe('1. Unauthorized Access')
    expect(inPage.getByText('approval').tagName).toBe('STRONG')
    expect(inPage.getByText('Encrypt.')).toBeTruthy()
    expect(fetchFilePreview).toHaveBeenCalledWith('m1')
  })

  it('lays signatories out three per row under the fixed approval heading', async () => {
    render(<FilePreviewPanel file={{ id: 'm1' }} onClose={vi.fn()} />)
    const page = await screen.findByTestId('memo-page')

    expect(within(page).getByText('Submitted for review/ support/ approval as proposed')).toBeTruthy()
    const grid = page.querySelectorAll('table')[1]
    const rows = grid.querySelectorAll('tr')
    expect(rows).toHaveLength(6) // two groups of role / signing space / name rows
    expect([...rows[0].querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'Prepared By',
      'Supported By',
      'Supported By',
    ])
    expect(rows[3].querySelectorAll('td')[0].textContent).toBe('Approved By')
    expect(rows[5].querySelectorAll('td')[0].textContent).toBe('Roshan Kumar NeupaneChief Executive Officer')
  })

  it('shows the ordinal suffix of the date raised', async () => {
    render(<FilePreviewPanel file={{ id: 'm1' }} onClose={vi.fn()} />)
    const page = await screen.findByTestId('memo-page')
    expect(within(page).getByText('th').tagName).toBe('SUP')
  })

  it('draws a table block with its header row', async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      ...MEMO,
      sections: [
        {
          heading: 'Cost',
          content: [{ table: { headers: ['Item', 'Cost'], rows: [['VPN', 'NPR 3,390']] } }],
        },
      ],
    })
    render(<FilePreviewPanel file={{ id: 'm1' }} onClose={vi.fn()} />)
    const page = await screen.findByTestId('memo-page')

    const table = page.querySelectorAll('table')[1] // [0] is To/From/Subject/Date
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Item', 'Cost'])
    expect([...table.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['VPN', 'NPR 3,390'])
  })

  it('falls back to the download message for a plain Word file with no preview', async () => {
    vi.mocked(fetchFilePreview).mockRejectedValue(new Error('404'))
    render(<FilePreviewPanel file={{ id: 'd1' }} onClose={vi.fn()} />)
    expect(await screen.findByText('No visual preview available for this file type yet.')).toBeTruthy()
    expect(screen.queryByTestId('memo-page')).toBeNull()
  })
})
