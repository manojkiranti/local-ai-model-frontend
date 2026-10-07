/** A preview zoom: a fixed level of the page's natural size, or fit-to-width. */
export type PageZoom = 'fit' | number

export const ZOOM_LEVELS = [0.25, 0.5, 1, 2] as const

/** Largest fit-to-width enlargement, so a wide full-screen panel stays readable. */
export const MAX_FIT_SCALE = 1.5

/** The scale that fits a page of `pageWidth` into `available`; 1 until both are known. */
export function fitScale(pageWidth: number, available: number): number {
  if (!(pageWidth > 0) || !(available > 0)) return 1
  return Math.min(available / pageWidth, MAX_FIT_SCALE)
}

export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
