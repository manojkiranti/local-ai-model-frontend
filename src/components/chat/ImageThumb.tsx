import { AlertTriangle, Image as ImageIcon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthedImageUrl } from '@/hooks/useAuthedImageUrl'

interface ImageThumbProps {
  /** A local object URL; when absent the image is fetched by `fileId`. */
  src?: string
  fileId?: string
  filename: string
  onOpen?: () => void
  className?: string
}

/**
 * Small preview of an attached image. A local object URL renders instantly; a
 * file id is fetched with the bearer header (see useAuthedImageUrl — a bare
 * <img src="/v1/files/{id}"> would 401).
 */
export function ImageThumb({ src, fileId, filename, onOpen, className }: ImageThumbProps) {
  const { url: fetched, error } = useAuthedImageUrl(src ? null : fileId)
  const url = src ?? fetched

  const box = cn(
    'grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted',
    className,
  )

  const inner = error ? (
    <AlertTriangle className="size-4 text-destructive" aria-hidden />
  ) : url ? (
    <img src={url} alt="" className="size-full object-cover" />
  ) : fileId ? (
    <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
  ) : (
    <ImageIcon className="size-4 text-primary" aria-hidden />
  )

  if (!onOpen) {
    return <span className={box}>{inner}</span>
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${filename} full size`}
      title={`View ${filename} full size`}
      className={cn(box, 'transition-colors hover:border-primary')}
    >
      {inner}
    </button>
  )
}
