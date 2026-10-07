import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { fetchFile, gatewayDetail, fetchFilePdf, fetchFilePreview } from '@/lib/api'
import { isMemoPreview, type FilePreview } from '@/lib/api'
import { MemoPages } from './MemoPreview'
import { DeckPages } from './DeckPages'
import { DocxPages } from './DocxPages'
import { ZoomMenu } from './ZoomMenu'
import type { PageZoom } from '@/lib/page-zoom'
import { filenameFromContentDisposition } from '@/lib/file-format'
import type { FileRef } from '@/lib/agent-api'

interface Loaded {
  contentType: string
  blob: Blob
  blobUrl: string
  filename: string
}

const isImage = (ct: string) => ct.startsWith('image/')
const isPdf = (ct: string) => ct.includes('application/pdf')
const isDeck = (ct: string) => ct.includes('presentationml.presentation') || ct.includes('ms-powerpoint')
// A generated .docx may be a create_memo memo, which records a structured preview.
const isDocx = (ct: string) => ct.includes('wordprocessingml.document')
const hasStructuredPreview = (ct: string) => isDeck(ct) || isDocx(ct)

/**
 * Docked preview panel on the right side of the chat window. Fetches
 * `/v1/files/{id}` with the bearer header (a plain <a> can't) and branches on
 * the real Content-Type: images render inline, PDFs render in the browser's
 * own PDF viewer via an iframe (zero extra libraries), and a PPTX deck
 * renders from its OWN structured content (`GET /v1/files/{id}/preview`) as
 * scrollable per-slide pages — not by parsing the binary file, which no
 * browser can render. A Word file is shown as the gateway's PDF rendering,
 * else its memo record, else parsed in the browser (`DocxPages`). Anything
 * else (or a deck with no recorded preview —
 * not every tool provides one, and files predating this feature have none)
 * falls back to a "download it instead" message. Blob URLs are revoked on
 * unmount/file change, same discipline as FileCard.
 */
export function FilePreviewPanel({
  file,
  onClose,
}: {
  file: FileRef | null
  onClose: () => void
}) {
  // Same convention as useAuthedImageUrl: state is stamped with the id it
  // belongs to and read back by comparison below, so a changed file reports
  // "loading" without a synchronous reset inside the effect (this panel is
  // reused across different files rather than remounted, unlike FileCard,
  // which gets a fresh instance per id via its list `key`).
  const [loadedState, setLoadedState] = useState<(Loaded & { id: string }) | null>(null)
  const [failedState, setFailedState] = useState<{ id: string; error: string } | null>(null)
  // `deck: null` (attempted, none recorded) is distinct from this whole record
  // being absent (not attempted yet, or for a different id) — collapsing the
  // two would render the "no preview, download it" fallback for the split
  // second before a deck's OWN structured preview arrives.
  const [deckState, setDeckState] = useState<{ id: string; deck: FilePreview | null } | null>(null)
  // A Word file is shown as the PDF the gateway renders of it (LibreOffice),
  // exactly like a PDF. `url: null` = conversion unavailable or failed, which
  // falls back to the structured memo preview, then to the download message.
  const [pdfState, setPdfState] = useState<{ id: string; url: string | null } | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Stamped with the file id like the states above, so another file opens at
  // "fit" again without a reset inside the fetch effect.
  const [zoomState, setZoomState] = useState<{ id: string; zoom: PageZoom } | null>(null)
  const [pageScale, setPageScale] = useState(1)

  useEffect(() => {
    if (!file) return
    const fileId = file.id
    let cancelled = false
    let createdUrl: string | null = null
    let pdfUrl: string | null = null

    void (async () => {
      try {
        const res = await fetchFile(fileId)
        const contentType = res.headers.get('Content-Type') ?? ''
        const named = filenameFromContentDisposition(res.headers.get('Content-Disposition'))
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        createdUrl = blobUrl
        if (cancelled) {
          URL.revokeObjectURL(blobUrl)
          return
        }
        setLoadedState({
          id: fileId,
          contentType,
          blob,
          blobUrl,
          filename: named || file.filename || `file-${fileId.slice(0, 8)}`,
        })

        if (isDocx(contentType)) {
          try {
            const pdf = await fetchFilePdf(fileId)
            pdfUrl = URL.createObjectURL(await pdf.blob())
          } catch {
            pdfUrl = null // not installed / not convertible: fall back below
          }
          if (cancelled) {
            if (pdfUrl) URL.revokeObjectURL(pdfUrl)
            return
          }
          if (pdfUrl) {
            setPdfState({ id: fileId, url: pdfUrl })
            setDeckState({ id: fileId, deck: null })
            return
          }
        }

        if (hasStructuredPreview(contentType)) {
          // Best-effort, secondary fetch: 404 means no structured preview was
          // recorded for this file (an older file, or a tool that doesn't
          // supply one), and any other failure isn't worth a distinct error
          // state here either — either way this resolves to `deck: null`
          // (attempted, none available), and the raw-file view (the download
          // link itself) still works regardless.
          let preview: FilePreview | null = null
          try {
            preview = await fetchFilePreview(fileId)
          } catch {
            // preview stays null — no structured preview for this file
          }
          if (!cancelled) {
            setDeckState({ id: fileId, deck: preview })
            if (isDocx(contentType)) setPdfState({ id: fileId, url: null })
          }
        }
      } catch (e) {
        if (!cancelled) setFailedState({ id: fileId, error: gatewayDetail(e) })
      }
    })()

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
    // Depend on the primitives actually used (id/filename), not the object
    // reference: an unstable but same-id object must not re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.filename])

  if (!file) return null

  const loaded = loadedState?.id === file.id ? loadedState : null
  const error = failedState?.id === file.id ? failedState.error : null
  // Three states for a deck: undefined (fetch still in flight), null
  // (attempted, none recorded), or the resolved preview.
  const deckAttempt = deckState?.id === file.id ? deckState : undefined
  const deckPending = Boolean(
    loaded && hasStructuredPreview(loaded.contentType) && deckAttempt === undefined,
  )
  const pdfAttempt = pdfState?.id === file.id ? pdfState : undefined
  const pdfPending = Boolean(loaded && isDocx(loaded.contentType) && pdfAttempt === undefined)
  const renderedPdf = pdfAttempt?.url ?? null
  const structured = deckAttempt?.deck ?? null
  const memo = structured && isMemoPreview(structured) ? structured : null
  const deck = structured && !isMemoPreview(structured) ? structured : null
  const zoom: PageZoom = zoomState?.id === file.id ? zoomState.zoom : 'fit'
  const settled = Boolean(loaded && !error && !pdfPending && !deckPending)
  // Word drawn in the browser (no server PDF, no memo record).
  const browserDocx = Boolean(settled && loaded && !renderedPdf && !memo && isDocx(loaded.contentType))
  const deckView = Boolean(settled && loaded && !renderedPdf && !memo && deck && isDeck(loaded.contentType))
  // The views whose pages this panel scales, so the ones with a zoom control.
  const zoomable = browserDocx || deckView

  return (
    <div
      role="complementary"
      aria-label={loaded ? `Preview: ${loaded.filename}` : 'File preview'}
      className={
        expanded
          ? 'fixed inset-0 z-40 flex flex-col bg-background'
          : 'fixed inset-0 z-40 flex flex-col bg-background sm:static sm:inset-auto sm:z-auto sm:h-full sm:w-[460px] lg:w-[600px] xl:w-[760px] sm:shrink-0 sm:border-l'
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {loaded?.filename ?? file.filename ?? 'Preview'}
        </span>
        {zoomable && (
          <ZoomMenu zoom={zoom} scale={pageScale} onChange={(next) => setZoomState({ id: file.id, zoom: next })} />
        )}
        {loaded && (
          <a
            href={loaded.blobUrl}
            download={loaded.filename}
            aria-label={`Download ${loaded.filename}`}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Restore panel size' : 'Expand to full screen'}
          className="hidden size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:grid"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Couldn't load {file.filename ?? 'file'}: {error}</span>
          </div>
        ) : !loaded || deckPending || pdfPending ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : renderedPdf ? (
          <iframe
            title={`Preview of ${loaded.filename}`}
            src={renderedPdf}
            className="h-full min-h-[70vh] w-full rounded-xl border bg-white"
          />
        ) : memo ? (
          <div className={expanded ? 'mx-auto max-w-4xl' : undefined}>
            <MemoPages memo={memo} />
          </div>
        ) : isDeck(loaded.contentType) && deck ? (
          <DeckPages deck={deck} zoom={zoom} onScale={setPageScale} />
        ) : isDocx(loaded.contentType) ? (
          // No server PDF (LibreOffice absent) and no memo record: render the
          // .docx itself in the browser.
          <div className={expanded ? 'mx-auto max-w-4xl' : undefined}>
            <DocxPages
              blob={loaded.blob}
              blobUrl={loaded.blobUrl}
              filename={loaded.filename}
              zoom={zoom}
              onScale={setPageScale}
            />
          </div>
        ) : isImage(loaded.contentType) ? (
          <div className="overflow-hidden rounded-xl border bg-white p-2">
            <img src={loaded.blobUrl} alt={loaded.filename} className="mx-auto block max-w-full" />
          </div>
        ) : isPdf(loaded.contentType) ? (
          <iframe
            title={`Preview of ${loaded.filename}`}
            src={loaded.blobUrl}
            className="h-full min-h-[70vh] w-full rounded-xl border bg-white"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            <span>No visual preview available for this file type yet.</span>
            <a
              href={loaded.blobUrl}
              download={loaded.filename}
              className="inline-flex items-center gap-2 rounded-xl border bg-background px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
            >
              <Download className="size-4" />
              Download {loaded.filename}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
