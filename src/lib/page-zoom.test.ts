import { describe, expect, it } from 'vitest'
import { fitScale, MAX_FIT_SCALE, zoomPercent } from '@/lib/page-zoom'

describe('fitScale', () => {
  it('fits the page to the available width', () => {
    expect(fitScale(816, 408)).toBe(0.5)
  })

  it('caps the enlargement in a wide panel', () => {
    expect(fitScale(816, 4000)).toBe(MAX_FIT_SCALE)
  })

  it('is 1 until both widths are known', () => {
    expect(fitScale(0, 400)).toBe(1)
    expect(fitScale(816, 0)).toBe(1)
  })
})

describe('zoomPercent', () => {
  it('rounds to a whole percentage', () => {
    expect(zoomPercent(0.25)).toBe('25%')
    expect(zoomPercent(600 / 816)).toBe('74%')
  })
})
