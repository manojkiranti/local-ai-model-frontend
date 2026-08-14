import { cn } from '@/lib/utils'

interface BurstLogoProps {
  /** Rendered size in px (square). */
  size?: number
  /** Pulse (grow/shrink) the logo — used while the assistant is answering. */
  active?: boolean
  /** Accessible name; when omitted the mark is decorative (adjacent text names it). */
  title?: string
  className?: string
}

/**
 * The brand mark (public/logo.png). With `active`, it gently pulses
 * (scales up/down) — the app's "the assistant is answering" animation,
 * stilled under `prefers-reduced-motion` by the global rule in index.css.
 */
export function BurstLogo({ size = 28, active = false, title, className }: BurstLogoProps) {
  return (
    <img
      src="/logo.png"
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      style={{ width: size, height: size }}
      className={cn('shrink-0 object-contain', active && 'burst-pulse', className)}
    />
  )
}
