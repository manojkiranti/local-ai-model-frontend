import { cn } from '@/lib/utils'
import type { HealthResponse } from '@/lib/api'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface StatusDotProps {
  health: HealthResponse | null
  reachable: boolean
  loading: boolean
  error: string | null
}

export function StatusDot({ health, reachable, loading, error }: StatusDotProps) {
  const state =
    loading && !health && !error ? 'loading' : reachable ? 'online' : 'offline'

  const dot =
    state === 'online'
      ? 'bg-emerald-600 dark:bg-emerald-500'
      : state === 'loading'
        ? 'bg-amber-500'
        : 'bg-destructive'
  const label =
    state === 'online'
      ? 'Connected'
      : state === 'loading'
        ? 'Checking…'
        : 'Gateway offline'
  const labelColor =
    state === 'offline' ? 'text-destructive' : 'text-foreground/70'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs">
          <span className="relative flex size-[7px]">
            {state === 'online' && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            )}
            <span className={cn('relative inline-flex size-[7px] rounded-full', dot)} />
          </span>
          <span className={cn('font-semibold', labelColor)}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {health ? (
          <div className="space-y-0.5 font-mono leading-relaxed">
            <div>{health.ollama.base_url}</div>
            <div>chat · {health.default_chat_model}</div>
            <div>embed · {health.default_embed_model}</div>
            {!health.ollama.reachable && (
              <div className="text-amber-400">ollama unreachable</div>
            )}
          </div>
        ) : (
          <span>{error ?? 'Checking gateway…'}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
