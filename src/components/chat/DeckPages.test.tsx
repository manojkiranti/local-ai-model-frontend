import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  // No template artwork in tests: the slides fall back to plain backgrounds.
  return {
    ...actual,
    fetchPptxCoverBackground: vi.fn(() => Promise.reject(new Error('none'))),
    fetchPptxHeaderBackground: vi.fn(() => Promise.reject(new Error('none'))),
  }
})

import type { DeckPreview } from '@/lib/api'
import { DeckPages } from '@/components/chat/DeckPages'

afterEach(() => {
  cleanup()
})

const DECK: DeckPreview = {
  title: '',
  subtitle: '',
  closing: true,
  slides: [
    {
      title: 'Pillars',
      cards: [
        { icon: 'shield-check', title: 'Secure', text: 'Zero findings' },
        { icon: null, title: 'Talent', text: null },
      ],
      takeaway: 'One key message',
    },
    { title: 'Process', steps: [{ title: 'Apply', text: 'Online', icon: 'smartphone' }, { title: 'Approve' }] },
    { title: 'Roadmap', timeline: [{ date: 'Q1 2026', title: 'Relaunch' }, { date: 'Q2 2026', title: 'Loans' }] },
    {
      title: 'Branch vs digital',
      comparison: [
        { heading: 'Branch', icon: 'building-2', points: ['Slow'] },
        { heading: 'Digital', points: ['Fast'] },
      ],
    },
    { title: 'Targets', progress: [{ label: 'Adoption', value: 72, note: 'Target 80%' }, { label: 'NPS', value: 38.5 }] },
    {
      title: 'Deposits',
      chart: { chart_type: 'bar', labels: ['Q1', 'Q2'], series: [{ data: [1, 2] }] },
      bullets: ['Up every quarter'],
    },
  ],
}

describe('DeckPages infographic layouts', () => {
  it('renders every layout, the takeaway and the closing slide', () => {
    render(<DeckPages deck={DECK} />)
    for (const text of ['Secure', 'Zero findings', 'Talent', 'One key message', 'Apply', 'Online', 'Approve']) {
      expect(screen.getByText(text)).not.toBeNull()
    }
    for (const text of ['Q1 2026', 'Relaunch', 'Branch', 'Slow', 'Digital', 'Fast', 'Adoption', 'Target 80%']) {
      expect(screen.getByText(text)).not.toBeNull()
    }
    expect(screen.getByText('72%')).not.toBeNull()
    expect(screen.getByText('38.5%')).not.toBeNull()
    expect(screen.getByText('Up every quarter')).not.toBeNull()
    expect(screen.getByText('Thank You')).not.toBeNull()
    // 6 content slides + the closing slide (no cover: the deck has no title)
    expect(screen.getByText('Page 7 / 7')).not.toBeNull()
  })

  it('draws the icons the gateway resolved, and none for a null icon', () => {
    const { container } = render(<DeckPages deck={DECK} />)
    const icons = [...container.querySelectorAll('[data-icon]')].map((el) => el.getAttribute('data-icon'))
    expect(icons).toEqual(['shield-check', 'smartphone', 'building-2'])
  })

  it('exposes progress bars as meters', () => {
    render(<DeckPages deck={DECK} />)
    const meter = screen.getByRole('meter', { name: 'Adoption' })
    expect(meter.getAttribute('aria-valuenow')).toBe('72')
  })

  it('omits the closing slide for decks saved before it existed', () => {
    render(<DeckPages deck={{ ...DECK, closing: undefined }} />)
    expect(screen.queryByText('Thank You')).toBeNull()
    expect(screen.getByText('Page 6 / 6')).not.toBeNull()
  })
})
