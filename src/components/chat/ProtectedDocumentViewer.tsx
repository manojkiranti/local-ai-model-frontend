import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2, Lock, X } from 'lucide-react'
import { describeError, fetchDocumentPage, fetchDocumentPageCount } from '@/lib/api'

/** Shortcuts that would save, print, copy or select-all the document. */
const BLOCKED_KEYS = new Set(['p', 's', 'c', 'a', 'x'])

const block = (event: SyntheticEvent) => event.preventDefault()

/**
 * One page, fetched only once it scrolls near the viewport — a cited NRB PDF
 * can run to hundreds of pages. The image is a bearer-fetched blob (the route
 * is behind JWT), revoked on unmount.
 */
function ProtectedPage({
  pagesUrl,
  page,
  scrollRoot,
}: {
  pagesUrl: string
  page: number
  scrollRoot: HTMLElement | null
}) {
  const holder = useRef<HTMLDivElement>(null)
  // Without IntersectionObserver (old browsers, jsdom) every page just loads.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = holder.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { root: scrollRoot, rootMargin: '800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRoot, visible])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchDocumentPage(pagesUrl, page, controller.signal)
      .then((res) => res.blob())
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [pagesUrl, page, visible])

  return (
    <div
      ref={holder}
      data-page={page}
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-md bg-white shadow"
    >
      {src ? (
        <img
          src={src}
          alt={`Page ${page}`}
          draggable={false}
          className="pointer-events-none block w-full select-none"
        />
      ) : (
        <div className="flex aspect-[1/1.414] items-center justify-center text-xs text-neutral-500">
          {failed ? `Page ${page} could not be loaded.` : <Loader2 className="size-5 animate-spin" aria-hidden />}
        </div>
      )}
      <span className="absolute bottom-2 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
        {page}
      </span>
    </div>
  )
}

/**
 * View-only reader for a cited PDF, for users who may read it but not download
 * it. The gateway sends rendered page IMAGES (never the file, never its text
 * layer), so there is nothing to select or save; on top of that this blocks
 * the context menu, dragging, copy, and the print/save/copy/select-all
 * shortcuts, and prints a blank page while open (see index.css). A screenshot
 * is still possible — no web page can prevent one — so this deters casual
 * copying rather than guaranteeing secrecy.
 */
export function ProtectedDocumentViewer({
  title,
  pagesUrl,
  initialPage,
  onClose,
}: {
  title: string
  pagesUrl: string
  /** First cited page — scrolled to once the pages are laid out. */
  initialPage?: number
  onClose: () => void
}) {
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()
    fetchDocumentPageCount(pagesUrl, controller.signal)
      .then((n) => {
        if (!controller.signal.aborted) setCount(n)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(describeError(err))
      })
    return () => controller.abort()
  }, [pagesUrl])

  // Keyboard: Escape closes; print/save/copy/select-all are swallowed.
  // Printing via the browser menu is handled by the html class + print CSS.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('protected-view-open')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current()
        return
      }
      if ((event.ctrlKey || event.metaKey) && BLOCKED_KEYS.has(event.key.toLowerCase())) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      root.classList.remove('protected-view-open')
    }
  }, [])

  useEffect(() => {
    if (!count || !scrollRoot || !initialPage || initialPage <= 1) return
    const target = scrollRoot.querySelector(`[data-page="${Math.min(initialPage, count)}"]`)
    if (target && 'scrollIntoView' in target) target.scrollIntoView({ block: 'start' })
  }, [count, scrollRoot, initialPage])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} (view only)`}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 select-none"
      onContextMenu={block}
      onCopy={block}
      onCut={block}
      onDragStart={block}
    >
      <div className="flex items-center gap-3 border-b border-white/10 bg-neutral-900 px-4 py-2.5 text-white">
        <Lock className="size-4 shrink-0 text-white/70" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-white/60">
            View only — downloading, copying and printing are restricted.
            {count !== null && ` ${count} ${count === 1 ? 'page' : 'pages'}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close document"
          className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {error ? (
          <p className="mx-auto flex max-w-md items-start gap-2 rounded-lg bg-white px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : count === null ? (
          <div className="flex justify-center py-20 text-white/70">
            <Loader2 className="size-6 animate-spin" aria-label="Loading document" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {Array.from({ length: count }, (_, i) => (
              <ProtectedPage key={i + 1} pagesUrl={pagesUrl} page={i + 1} scrollRoot={scrollRoot} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
