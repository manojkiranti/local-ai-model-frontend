import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFiles } from '@/hooks/useFiles'
import { deleteFile, describeError, fetchFile, GatewayError, type GatewayFile } from '@/lib/api'
import { fileKind, formatBytes, relativeTime } from '@/lib/file-format'

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'Excel') return <FileSpreadsheet className="size-4" />
  if (kind === 'SVG' || kind === 'Image') return <ImageIcon className="size-4" />
  return <FileText className="size-4" />
}

/**
 * "My Files" — the current user's gateway-generated files. Files are already
 * owner-scoped and newest-first server-side, so we list them as-is. Each
 * download re-fetches `/v1/files/{id}` WITH the bearer header (a plain <a> can't
 * send it) into a blob URL; a 404 means "not yours or gone" and quietly drops
 * the row with a transient notice.
 */
export function FilesPage() {
  const { files, loading, error, reload, removeFile } = useFiles()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Auto-dismiss the transient notice.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  async function download(file: GatewayFile) {
    setBusyId(file.id)
    try {
      const res = await fetchFile(file.id)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      // 401 is handled globally (→ login). 404/410 = owner-scoped miss or gone:
      // drop the row quietly. Anything else is a real error worth showing.
      if (err instanceof GatewayError && (err.status === 404 || err.status === 410)) {
        setNotice('File no longer available')
        removeFile(file.id)
      } else {
        setNotice(describeError(err))
      }
    } finally {
      setBusyId(null)
    }
  }

  async function remove(file: GatewayFile) {
    setRemovingId(file.id)
    try {
      // 204 (deleted) and 404 (already gone) both resolve — drop the row either way.
      await deleteFile(file.id)
      removeFile(file.id)
    } catch (err) {
      setNotice(describeError(err))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-center gap-2.5">
        <FolderOpen className="size-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">My Files</h1>
        {files && files.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">{files.length}</span>
        )}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            <RotateCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </div>
      </header>

      {notice && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !files ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading your files…
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Couldn't load your files: {error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RotateCw />
              Retry
            </Button>
          </div>
        ) : !files || files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <FolderOpen className="size-8 opacity-40" />
            <p>No files yet.</p>
            <p className="text-xs">Files generated by tools in chat will show up here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => {
              const kind = fileKind(file.media_type)
              return (
                <li
                  key={file.id}
                  className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-sm"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <KindIcon kind={kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{file.filename}</span>
                      <Badge variant="outline" className="shrink-0">
                        {kind}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{formatBytes(file.size)}</span>
                      <span aria-hidden>·</span>
                      <span title={new Date(file.created_at).toLocaleString()}>
                        {relativeTime(file.created_at)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void download(file)}
                    disabled={busyId === file.id || removingId === file.id}
                  >
                    {busyId === file.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void remove(file)}
                    disabled={removingId === file.id || busyId === file.id}
                    aria-label={`Delete ${file.filename}`}
                    title="Delete"
                  >
                    {removingId === file.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
