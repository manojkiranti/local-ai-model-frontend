import { useEffect, useState, type RefObject } from 'react'

/** The content-box width of `ref`'s element, tracked as it resizes; 0 until
 * measured (and always 0 where ResizeObserver is missing, e.g. jsdom). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next) setWidth(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
