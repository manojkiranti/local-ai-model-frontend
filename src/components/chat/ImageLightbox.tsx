import { useEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAuthedImageUrl } from '@/hooks/useAuthedImageUrl'

interface ImageLightboxProps {
  /** A local object URL (a file the user just picked — no request needed). */
  src?: string
  /** A gateway file id, fetched with the bearer header when `src` is absent. */
  fileId?: string
  filename?: string
  onClose: () => void
}

/**
 * Full-size view of an attached image, so a figure the OCR reported can be
 * checked against the original. Prefers a local object URL when the file is in
 * hand; otherwise loads it authenticated by id (which also works for a
 * conversation reloaded from history).
 */
export function ImageLightbox({ src, fileId, filename, onClose }: ImageLightboxProps) {
  const { url: fetched, error } = useAuthedImageUrl(src ? null : fileId)
  const url = src ?? fetched

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={filename ? `Image: ${filename}` : 'Attached image'}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-5xl items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
          {filename ?? 'Attached image'}
        </span>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label="Close image"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X className="size-4" />
        </button>
      </div>

      {error ? (
        <p className="rounded-xl bg-destructive/20 px-4 py-3 text-sm text-white">
          Couldn't load the image: {error}
        </p>
      ) : url ? (
        <img
          src={url}
          alt={filename ?? 'Attached image'}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[80vh] max-w-full rounded-xl bg-white object-contain"
        />
      ) : (
        <Loader2 className="size-6 animate-spin text-white/80" />
      )}

      <p className="text-xs text-white/60">Click anywhere or press Esc to close</p>
    </div>
  )
}
