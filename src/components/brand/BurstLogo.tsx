import { cn } from '@/lib/utils'

// One tapered, rounded spoke (from public/radial-burst-logo.svg), reused at 16
// rotations. Inlined as <path> elements (no <use>/<defs> id) so multiple logos
// on a page can't collide on an element id.
const SPOKE =
  'M252 210 C249.8 210 248.6 208.2 248.8 205.8 L244 108 ' +
  'C243.5 97.5 248.8 90 256 90 C263.2 90 268.5 97.5 268 108 ' +
  'L263.2 205.8 C263.4 208.2 262.2 210 260 210 Z'

const ANGLES = Array.from({ length: 16 }, (_, i) => i * 22.5)

interface BurstLogoProps {
  /** Rendered size in px (square). */
  size?: number
  /** Pulse (grow/shrink) the burst — used while the assistant is answering. */
  active?: boolean
  /** Accessible name; when omitted the mark is decorative (adjacent text names it). */
  title?: string
  className?: string
}

/**
 * The radial-burst brand mark. Fills with `currentColor` (default: the brand red
 * `#b8352c`), so a parent can recolor it via a text-color class. With `active`,
 * the whole burst gently pulses (scales up/down) — the app's "the assistant is
 * answering" animation, stilled under `prefers-reduced-motion` by the global rule
 * in index.css.
 */
export function BurstLogo({ size = 28, active = false, title, className }: BurstLogoProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0 text-[#b8352c]', className)}
    >
      {title ? <title>{title}</title> : null}
      <g fill="currentColor" className={cn(active && 'burst-pulse')}>
        {ANGLES.map((angle) => (
          <path key={angle} d={SPOKE} transform={`rotate(${angle} 256 256)`} />
        ))}
      </g>
    </svg>
  )
}
