import { useState } from 'react'
import { Code, Download, Eye, EyeOff, File, FileSpreadsheet, Loader2 } from 'lucide-react'
import {
  downloadFile,
  fetchFileText,
  type DownloadKind,
  type FileDownload,
} from '@/lib/agent-api'
import { describeError } from '@/lib/api'
import { formatBytes } from '@/lib/utils'

const KIND_ICON: Record<DownloadKind, typeof FileSpreadsheet> = {
  excel: FileSpreadsheet,
  html: Code,
  file: File,
}

/** A download button for one generated artifact, with an inline preview for HTML. */
export function DownloadButton({ download }: { download: FileDownload }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ open: boolean; html: string | null; loading: boolean }>(
    { open: false, html: null, loading: false },
  )

  const Icon = KIND_ICON[download.kind]

  const onDownload = async () => {
    setBusy(true)
    setError(null)
    try {
      await downloadFile(download)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const onTogglePreview = async () => {
    if (preview.open) {
      setPreview((p) => ({ ...p, open: false }))
      return
    }
    if (preview.html != null) {
      setPreview((p) => ({ ...p, open: true }))
      return
    }
    setPreview({ open: true, html: null, loading: true })
    setError(null)
    try {
      const html = await fetchFileText(download)
      setPreview({ open: true, html, loading: false })
    } catch (e) {
      setError(describeError(e))
      setPreview({ open: false, html: null, loading: false })
    }
  }

  const meta = [
    download.bytes ? formatBytes(download.bytes) : null,
    download.rows != null ? `${download.rows} row${download.rows === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="group inline-flex w-fit items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 text-left shadow-sm transition-colors hover:border-primary disabled:opacity-60"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold group-hover:text-primary">
              {download.filename}
            </span>
            {meta && (
              <span className="block font-mono text-[10px] text-muted-foreground">{meta}</span>
            )}
          </span>
          <Download className="ml-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5 group-hover:text-primary" />
        </button>

        {download.kind === 'html' && (
          <button
            type="button"
            onClick={onTogglePreview}
            disabled={preview.loading}
            aria-pressed={preview.open}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/70 transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {preview.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : preview.open ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
            {preview.open ? 'Hide preview' : 'Preview'}
          </button>
        )}
      </div>

      {error && <span className="text-xs text-destructive">{error}</span>}

      {preview.open && preview.html != null && (
        // Sandboxed with an empty allow-list: model-generated HTML renders with
        // no scripts, no same-origin access, no form submission — CSS only.
        <iframe
          title={`Preview of ${download.filename}`}
          srcDoc={preview.html}
          sandbox=""
          className="h-80 w-full rounded-xl border bg-white"
        />
      )}
    </div>
  )
}
