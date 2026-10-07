import { describe, expect, it } from 'vitest'
import { normalizeHangingIndents } from '@/lib/docx-layout'

describe('normalizeHangingIndents', () => {
  it('moves a hanging indent into padding so the box and its border start with the first line', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<p id="meta" style="margin-left: 98px; text-indent: -98px; border-top: 2px solid black">To : CEO</p>' +
      '<p id="plain" style="margin-left: 48px">Body</p>' +
      '<p id="first" style="text-indent: 24px">Indented first line</p>'
    document.body.append(root)

    normalizeHangingIndents(root)

    const meta = root.querySelector<HTMLElement>('#meta')!
    expect(meta.style.marginLeft).toBe('0px')
    expect(meta.style.paddingLeft).toBe('98px')
    // The text itself does not move: padding 98 + indent -98 = first line at 0.
    expect(meta.style.textIndent).toBe('-98px')
    expect(root.querySelector<HTMLElement>('#plain')!.style.marginLeft).toBe('48px')
    expect(root.querySelector<HTMLElement>('#plain')!.style.paddingLeft).toBe('')
    expect(root.querySelector<HTMLElement>('#first')!.style.paddingLeft).toBe('')
    root.remove()
  })

  it('keeps any part of the left indent that the first line does not undo', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p style="margin-left: 72px; text-indent: -24px; padding-left: 4px">Item</p>'
    document.body.append(root)

    normalizeHangingIndents(root)

    const p = root.querySelector('p')!
    expect(p.style.marginLeft).toBe('48px')
    expect(p.style.paddingLeft).toBe('28px')
    root.remove()
  })
})
