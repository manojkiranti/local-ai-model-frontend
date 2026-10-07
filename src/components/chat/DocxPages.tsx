import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { neutralizeLinks } from '@/lib/docx-links'
import { normalizeHangingIndents } from '@/lib/docx-layout'
import { fitScale, type PageZoom } from '@/lib/page-zoom'
import { useElementWidth } from '@/hooks/useElementWidth'

/** `docx-preview` lays out tab stops on a 500 ms timer after rendering, from
 * on-screen positions, so the page must stay unzoomed until that has run. */
const TAB_LAYOUT_MS = 600

/**
 * Word file rendered in the browser with `docx-preview`, for when the gateway
 * cannot convert it to PDF (no LibreOffice) and it has no memo record. The
 * library is loaded on demand so it stays out of the main bundle. It builds
 * DOM from the document's XML; embedded HTML chunks (`altChunk`) are not
 * rendered, and images are inlined as data URLs so there is no blob URL to
 * leak. Layout is approximate — fonts and floating shapes may differ from Word.
 *
 * Pages keep their real size and margins: floating rules and logos are placed
 * at fixed offsets, so reflowing the text to the panel would slide it under
 * them. Instead the whole page is zoomed — to the panel's width by default,
 * re-fitted whenever the panel is resized or expanded, or to a fixed `zoom`
 * level (scrolling when wider than the panel). Only once the page is settled,
 * since the tab-stop pass measures it at zoom 1. `onScale` reports the scale
 * applied, for the zoom control's label.
 */
export function DocxPages({
  blob,
  blobUrl,
  filename,
  zoom = 'fit',
  onScale,
}: {
  blob: Blob
  blobUrl: string
  filename: string
  zoom?: PageZoom
  onScale?: (scale: number) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'rendering' | 'done' | 'failed'>('rendering')
  // The page's natural width, measured once at zoom 1 right after rendering.
  const [pageWidth, setPageWidth] = useState(0)
  const available = useElementWidth(viewport)

  useEffect(() => {
    const el = container.current
    if (!el) return
    let cancelled = false
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelled) return
        setState('rendering')
        el.replaceChildren()
        await renderAsync(blob, el, undefined, {
          inWrapper: false,
          // Real tab stops: a memo's To/From colons and its right-aligned logo.
          experimental: true,
          renderAltChunks: false,
          useBase64URL: true,
        })
        if (cancelled) return
        // Before the library's tab timer fires, which measures from the box.
        normalizeHangingIndents(el)
        neutralizeLinks(el)
        await new Promise((resolve) => setTimeout(resolve, TAB_LAYOUT_MS))
        if (cancelled) return
        const page = el.querySelector<HTMLElement>('section.docx')
        setPageWidth(page?.offsetWidth ?? 0)
        setState('done')
      } catch {
        if (!cancelled) setState('failed')
      }
    })()
    return () => {
      cancelled = true
      el.replaceChildren()
    }
  }, [blob])

  const fit = fitScale(pageWidth, available)
  const scale = state !== 'done' ? 1 : zoom === 'fit' ? fit : zoom

  // Reported as the scale the page WILL show at, so the label reads the fit
  // percentage even before the first render settles.
  const shown = zoom === 'fit' ? fit : zoom
  useEffect(() => {
    onScale?.(shown)
  }, [shown, onScale])

  return (
    <div className="flex flex-col gap-3">
      {state === 'rendering' && (
        <div className="grid h-40 place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Rendering document" />
        </div>
      )}
      {state === 'failed' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          <span>This Word document could not be previewed.</span>
          <a
            href={blobUrl}
            download={filename}
            className="inline-flex items-center gap-2 rounded-xl border bg-background px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
          >
            <Download className="size-4" />
            Download {filename}
          </a>
        </div>
      )}
      {/* Laid out but invisible while rendering, so the page can be measured.
          A document page is white paper in either theme, like the PDF iframe. */}
      <div
        ref={viewport}
        className={
          state === 'done'
            ? 'overflow-auto rounded-xl border bg-muted p-3'
            : 'invisible h-0 overflow-hidden'
        }
      >
        <div
          ref={container}
          data-testid="docx-pages"
          data-scale={scale.toFixed(3)}
          hidden={state === 'failed'}
          style={{ zoom: scale }}
          className="text-black [&_section.docx]:mx-auto [&_section.docx]:mb-3 [&_section.docx]:bg-white [&_section.docx]:shadow-sm [&_section.docx:last-child]:mb-0"
        />
      </div>
    </div>
  )
}
