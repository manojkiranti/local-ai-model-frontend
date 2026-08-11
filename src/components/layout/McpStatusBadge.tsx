import { cn } from '@/lib/utils'
import { useMcpStatus } from '@/hooks/useMcpStatus'
import type { HealthResponse } from '@/lib/api'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type McpState = 'loading' | 'off' | 'connected' | 'disconnected'

interface SystemStatusBadgeProps {
  health: HealthResponse | null
  reachable: boolean
  loading: boolean
  error: string | null
}

/** One compact summary for gateway/model health and the live MCP probe. */
export function SystemStatusBadge({
  health,
  reachable,
  loading,
  error,
}: SystemStatusBadgeProps) {
  const { status, loading: mcpLoading } = useMcpStatus()

  const state: McpState = !status
    ? 'loading'
    : !status.configured
      ? 'off'
      : status.reachable
        ? 'connected'
        : 'disconnected'

  const gatewayState = loading && !health && !error ? 'loading' : reachable ? 'online' : 'offline'
  const degraded =
    gatewayState === 'online' &&
    (health?.status === 'degraded' || !health?.ollama.reachable || state === 'disconnected')
  const checking = gatewayState === 'loading' || (mcpLoading && !status)
  const systemState =
    gatewayState === 'offline' ? 'offline' : checking ? 'checking' : degraded ? 'degraded' : 'ready'

  const dot = {
    ready: 'bg-emerald-600 dark:bg-emerald-500',
    checking: 'bg-amber-500',
    degraded: 'bg-amber-500',
    offline: 'bg-destructive',
  }[systemState]
  const label = {
    ready: 'System ready',
    checking: 'Checking…',
    degraded: 'Degraded',
    offline: 'Offline',
  }[systemState]
  const modelDetail =
    gatewayState === 'online'
      ? health?.ollama.reachable
        ? `online${health.default_chat_model ? ` · ${health.default_chat_model}` : ''}`
        : 'model service unavailable'
      : gatewayState === 'loading'
        ? 'checking'
        : error || 'gateway unavailable'
  const mcpDetail =
    state === 'connected'
      ? `connected · ${status?.tools.length ?? 0} tools`
      : state === 'off'
        ? 'not configured'
        : state === 'disconnected'
          ? status?.error || 'unavailable'
          : 'checking'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          aria-label={`System status: ${label}`}
          className="flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-xs"
        >
          <span className="relative flex size-[7px]">
            {systemState === 'ready' && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            )}
            <span className={cn('relative inline-flex size-[7px] rounded-full', dot)} />
          </span>
          <span
            className={cn(
              'hidden font-medium sm:inline',
              systemState === 'offline' ? 'text-destructive' : 'text-foreground/70',
            )}
          >
            {label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="w-64">
        <div className="space-y-2">
          <div className="font-semibold">System status</div>
          <div className="grid grid-cols-[48px_1fr] gap-x-3 gap-y-1 font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">Model</span>
            <span className="break-words">{modelDetail}</span>
            <span className="text-muted-foreground">MCP</span>
            <span className="break-words">{mcpDetail}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
