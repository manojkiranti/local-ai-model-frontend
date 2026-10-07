import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ZOOM_LEVELS, zoomPercent, type PageZoom } from '@/lib/page-zoom'

/** Preview zoom picker: fixed levels or zoom to fit. The trigger shows the
 * scale actually applied, so "fit" reads as the percentage it resolved to. */
export function ZoomMenu({
  zoom,
  scale,
  onChange,
}: {
  zoom: PageZoom
  scale: number
  onChange: (zoom: PageZoom) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Zoom: ${zoom === 'fit' ? 'fit to width' : zoomPercent(zoom)}`}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {zoomPercent(scale)}
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {ZOOM_LEVELS.map((level) => (
          <DropdownMenuItem key={level} onSelect={() => onChange(level)}>
            <span className="flex-1 tabular-nums">{zoomPercent(level)}</span>
            {zoom === level && <Check aria-label="selected" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange('fit')}>
          <span className="flex-1">Zoom to fit</span>
          {zoom === 'fit' && <Check aria-label="selected" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
