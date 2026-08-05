import { cn } from '@/lib/utils'
import { useMcpStatus } from '@/hooks/useMcpStatus'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type McpState = 'loading' | 'off' | 'connected' | 'disconnected'

/**
 * Live MCP connection indicator (like Claude Desktop's per-server dot). Polls
 * `/v1/mcp/status` on mount and every ~30s. Three real states plus a neutral
 * "checking" one before the first probe returns.
 */
export function McpStatusBadge() {
  const { status } = useMcpStatus()

  const state: McpState = !status
    ? 'loading'
    : !status.configured
      ? 'off'
      : status.reachable
        ? 'connected'
        : 'disconnected'

  const dot = {
    loading: 'bg-muted-foreground/50',
    off: 'bg-muted-foreground/50',
    connected: 'bg-emerald-600 dark:bg-emerald-500',
    disconnected: 'bg-destructive',
  }[state]

  const label = {
    loading: 'MCP',
    off: 'MCP off',
    connected: 'MCP connected',
    disconnected: 'MCP disconnected',
  }[state]

  const labelColor =
    state === 'disconnected' ? 'text-destructive' : 'text-foreground/70'

  const tooltip =
    state === 'connected'
      ? status && status.tools.length > 0
        ? status.tools.join(', ')
        : 'No tools exposed'
      : state === 'disconnected'
        ? status?.error ?? 'MCP server unreachable'
        : state === 'off'
          ? 'No MCP server configured'
          : 'Checking MCP…'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs">
          <span className="relative flex size-[7px]">
            {state === 'connected' && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            )}
            <span className={cn('relative inline-flex size-[7px] rounded-full', dot)} />
          </span>
          <span className={cn('font-semibold', labelColor)}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {state === 'connected' && status ? (
          <div className="max-w-64 space-y-0.5 font-mono leading-relaxed">
            {status.server_url && <div>{status.server_url}</div>}
            {status.tool_mode && <div>mode · {status.tool_mode}</div>}
            <div className="whitespace-pre-wrap break-words">{tooltip}</div>
          </div>
        ) : (
          <span>{tooltip}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
