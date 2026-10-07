import { describe, expect, it } from 'vitest'
import {
  boxStyle,
  cardsLayout,
  comparisonLayout,
  COVER_TITLE_BOX,
  fitPt,
  percent,
  progressLayout,
  pt,
  slideZones,
  stepsLayout,
  zoneBottom,
} from '@/lib/deck-layout'

const close = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 4)

describe('slideZones (mirrors create_pptx)', () => {
  it('gives bullets alone the tall body box under the header', () => {
    const z = slideZones({ title: 'T', bullets: ['a'] })
    close(z.bullets?.top, 0.2)
    close(z.bullets?.height, 0.66)
    close(z.bullets?.left, 838200 / 12192000)
    expect(z.table).toBeUndefined()
  })

  it('splits bullets above a table', () => {
    const z = slideZones({ title: 'T', bullets: ['a'], table: { rows: [['1']] } })
    close(z.bullets?.height, 0.22)
    close(z.table?.top, 0.45)
    close(z.table?.left, 0.05)
    close(z.table?.width, 0.9)
  })

  it('lifts a table alone to just under the header', () => {
    close(slideZones({ title: 'T', table: { rows: [['1']] } }).table?.top, 0.22)
  })

  it('puts stats first, then bullets and the table below them', () => {
    const z = slideZones({ title: 'T', stats: [{ value: '1', label: 'x' }], bullets: ['a'], table: { rows: [['1']] } })
    close(z.stats?.top, 0.2)
    close(z.stats?.height, 0.22)
    close(z.bullets?.top, 0.45)
    close(z.bullets?.height, 0.33)
    close(z.table?.top, 0.7)
  })

  it('gives an image or chart the whole content area and nothing else', () => {
    const z = slideZones({ title: 'T', chart: { chart_type: 'bar', labels: [], series: [] } })
    expect(Object.keys(z)).toEqual(['media'])
    close(z.media?.top, 0.2)
    close(z.media?.height, 0.58)
  })
})

describe('units', () => {
  it('converts points to pixels on the 96 dpi slide', () => {
    expect(pt(48)).toBe(64)
    expect(pt(60)).toBe(80)
  })

  it("places the cover title in the template's own text box", () => {
    expect(boxStyle(COVER_TITLE_BOX).left).toBe('12.5%')
    expect(boxStyle(COVER_TITLE_BOX).width).toBe('75%')
  })
})

// Reference numbers below were computed by the gateway's own arithmetic
// (app/tools/local/pptx.py, branded top 0.20) — if one fails, the preview and
// the downloaded deck have drifted apart.
describe('infographic layouts (mirror create_pptx)', () => {
  it('lays 5 cards out 3 + 2 with the last row centred', () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ title: `c${i}`, icon: i === 3 ? 'target' : null }))
    const l = cardsLayout(cards, zoneBottom({}))
    close(l[3].card.left, 0.203333)
    close(l[3].card.top, 0.545)
    close(l[3].card.width, 0.286667)
    close(l[3].card.height, 0.315)
    expect(l[3].icon).toBeDefined()
    expect(l[0].icon).toBeUndefined()
    close(l[3].icon?.width, 0.050625) // a round icon: height fraction 0.09 as width
  })

  it('centres a 4-step process with icons and text', () => {
    const steps = Array.from({ length: 4 }, () => ({ title: 's', text: 't', icon: 'target' }))
    const l = stepsLayout(steps, zoneBottom({}))
    close(l[0].band.top, 0.3375)
    expect(l[0].color).toBe('#e60012')
    expect(l[3].color).toBe('#7a000a')
  })

  it('sizes comparison panels to the longest column and honours the takeaway', () => {
    const cols = [
      { heading: 'a', points: ['1', '2', '3'] },
      { heading: 'b', points: ['1'] },
    ]
    const l = comparisonLayout(cols, zoneBottom({ takeaway: 'msg' }))
    close(l[0].head.top, 0.295)
    close(l[0].body.top + l[0].body.height - l[0].head.top, 0.365)
  })

  it('centres progress rows at their maximum height', () => {
    const bars = [72, 55, 38.5, 64].map((value) => ({ label: 'x', value }))
    const l = progressLayout(bars, zoneBottom({}))
    close(l[0].label.top, 0.31)
    close(l[1].label.top - l[0].label.top, 0.11)
    close(l[0].fill?.width, 0.5 * 0.72)
  })

  it('splits a chart slide with side content, and shortens media under a takeaway', () => {
    const chart = { chart_type: 'bar' as const, labels: [], series: [] }
    const split = slideZones({ chart, bullets: ['a'] })
    close(split.media?.width, 0.55)
    close(split.side?.left, 0.62)
    close(slideZones({ chart, takeaway: 'm' }).media?.height, 0.555)
  })

  it("formats values like Python's {v:g}%", () => {
    expect(percent(72)).toBe('72%')
    expect(percent(38.5)).toBe('38.5%')
  })
})

describe('takeaway with bullets', () => {
  it('stops a bullet box above the takeaway banner', () => {
    close(slideZones({ bullets: ['a'], takeaway: 'm' }).bullets?.height, 0.555)
    close(slideZones({ bullets: ['a'] }).bullets?.height, 0.66)
  })
})

describe('fitPt (mirrors _fit)', () => {
  it('shrinks long copy in 2 pt steps and never below 8 pt', () => {
    expect(fitPt('x'.repeat(110), 12, 'card.text')).toBe(pt(12))
    expect(fitPt('x'.repeat(111), 12, 'card.text')).toBe(pt(10))
    expect(fitPt('x'.repeat(166), 12, 'card.text')).toBe(pt(8))
    expect(fitPt('x'.repeat(60), 10, 'progress.note')).toBe(pt(8))
  })
})
