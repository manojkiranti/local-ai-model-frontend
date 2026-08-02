import { cn } from '@/lib/utils'

interface BlobMarkProps {
  /** Rendered size in px (square). */
  size?: number
  /** Morph faster + glow stronger while the model is working. */
  active?: boolean
  className?: string
}

/**
 * An original, organic "living" mark for the assistant — a soft gradient blob
 * whose edges slowly morph and rotate. Pure CSS (see `.blob-mark` in index.css),
 * theme-aware via --color-primary, and stilled by prefers-reduced-motion.
 */
export function BlobMark({ size = 26, active = false, className }: BlobMarkProps) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn('blob-mark', active && 'blob-mark--active', className)}
    />
  )
}
