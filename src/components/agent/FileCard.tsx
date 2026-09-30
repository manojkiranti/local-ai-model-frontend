import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Download,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  Presentation,
} from 'lucide-react'
import { describeError, fetchFile } from '@/lib/api'
import { filenameFromContentDisposition } from '@/lib/file-format'
import type { FileRef } from '@/lib/agent-api'

interface Loaded {
  contentType: string
  blobUrl: string
  /** Populated only for text/html (used as the sandboxed iframe srcdoc). */
  html: string | null
  filename: string
}

const isImage = (ct: string) => ct.startsWith('image/')
const isHtml = (ct: string) => ct.includes('text/html')
const isSpreadsheet = (ct: string) =>
  ct.includes('spreadsheetml.sheet') || ct.includes('application/vnd.ms-excel')
const isDeck = (ct: string) =>
  ct.includes('presentationml.presentation') || ct.includes('ms-powerpoint')

/**
 * Render one gateway-generated file inline. Fetches `/v1/files/{id}` WITH the
 * bearer header (a plain <a> can't), then branches on the real Content-Type:
 * images (SVG charts) show inline via <img> (never innerHTML — img-loaded SVG
 * can't run scripts), HTML previews in a sandboxed iframe (no allow-scripts),
 * spreadsheets, decks and everything else get a download chip — a browser
 * renders none of those. The blob URL is revoked on unmount.
 *
 * `onPreview` (optional) adds a separate "Preview" button that opens the file
 * in the chat window's right-side panel (`FilePreviewPanel`) instead of — or
 * alongside — the inline rendering here; omit it to keep this card
 * download-only, e.g. in a context with no panel to open it in.
 */
export function FileCard({
  file,
  onPreview,
}: {
  file: FileRef
  onPreview?: (file: FileRef) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Keyed by file.id in the list, so an id change remounts with fresh state —
    // no synchronous reset needed here.
    let cancelled = false
    let createdUrl: string | null = null

    void (async () => {
      try {
        const res = await fetchFile(file.id)
        const contentType = res.headers.get('Content-Type') ?? ''
        const named = filenameFromContentDisposition(res.headers.get('Content-Disposition'))
        const blob = await res.blob()
        const html = isHtml(contentType) ? await blob.text() : null
        const blobUrl = URL.createObjectURL(blob)
        createdUrl = blobUrl
        if (cancelled) {
          URL.revokeObjectURL(blobUrl)
          return
        }
        setLoaded({
          contentType,
          blobUrl,
          html,
          filename:
            named ||
            file.filename ||
            `file-${file.id.slice(0, 8)}`,
        })
      } catch (e) {
        // A 401 is already handled globally (token cleared → redirect to login).
        if (!cancelled) setError(describeError(e))
      }
    })()

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [file.id, file.filename])

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          Couldn't load {file.filename ?? 'file'}: {error}
        </span>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex w-fit items-center gap-2 rounded-xl border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading {file.filename ?? 'file'}…
      </div>
    )
  }

  const Icon = isImage(loaded.contentType)
    ? ImageIcon
    : isSpreadsheet(loaded.contentType)
      ? FileSpreadsheet
      : isDeck(loaded.contentType)
        ? Presentation
        : FileIcon

  const downloadChip = (
    <a
      href={loaded.blobUrl}
      download={loaded.filename}
      className="group inline-flex w-fit items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 shadow-sm transition-colors hover:border-primary"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="block max-w-[16rem] truncate text-sm font-semibold group-hover:text-primary">
        {loaded.filename}
      </span>
      <Download className="ml-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5 group-hover:text-primary" />
    </a>
  )

  // A distinct action from the chip above: this opens the file in the chat
  // window's right-side panel rather than downloading it. Offered for every
  // file type — the panel itself decides what it can actually render,
  // falling back to a "download it instead" message for formats with no
  // browser-native viewer (PPTX/DOCX/XLSX today).
  const previewButton = onPreview ? (
    <button
      type="button"
      onClick={() => onPreview(file)}
      className="inline-flex w-fit items-center gap-2 rounded-xl border bg-card px-3.5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:border-primary hover:text-primary"
    >
      <Eye className="size-4" />
      Preview
    </button>
  ) : null

  if (isImage(loaded.contentType)) {
    return (
      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-white p-2">
          {/* <img> (not innerHTML) so SVG can't execute scripts. */}
          <img src={loaded.blobUrl} alt={loaded.filename} className="mx-auto block max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          {downloadChip}
          {previewButton}
        </div>
      </div>
    )
  }

  if (isHtml(loaded.contentType)) {
    return (
      <div className="flex flex-col gap-2">
        {/* Empty sandbox: no scripts, no same-origin, no forms — CSS/markup only. */}
        <iframe
          title={`Preview of ${loaded.filename}`}
          srcDoc={loaded.html ?? ''}
          sandbox=""
          className="h-[400px] w-full rounded-xl border bg-white"
        />
        <div className="flex flex-wrap gap-2">
          {downloadChip}
          {previewButton}
        </div>
      </div>
    )
  }

  // Spreadsheets, decks, and anything else: no inline rendering here, but the
  // panel can still open (image/PDF get a real preview there too; everything
  // else gets the same "download it instead" message the panel shows).
  return (
    <div className="flex flex-wrap gap-2">
      {downloadChip}
      {previewButton}
    </div>
  )
}
