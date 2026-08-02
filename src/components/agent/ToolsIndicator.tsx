import { Wrench } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTools } from '@/hooks/useTools'

/** Small header control that lists the tools the gateway exposes to the agent. */
export function ToolsIndicator() {
  const { tools, loading, error } = useTools()
  const count = tools?.exposed.length ?? 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/70 transition-colors hover:border-primary hover:text-primary"
        >
          <Wrench className="size-3.5" />
          {loading ? 'Tools…' : error ? 'Tools' : `${count} tool${count === 1 ? '' : 's'}`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-0">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-semibold">Available tools</div>
          {tools && (
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {tools.mode} · {tools.server_url}
            </div>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {error && <div className="px-2 py-3 text-xs text-destructive">{error}</div>}
          {!error && count === 0 && !loading && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No tools exposed.
            </div>
          )}
          {tools?.exposed.map((tool) => (
            <div key={tool.name} className="rounded-lg px-2 py-2 hover:bg-muted">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{tool.name}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {tool.backend}
                </span>
              </div>
              {tool.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {tool.description}
                </p>
              )}
            </div>
          ))}

          {tools && tools.filtered_out.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                filtered out
              </div>
              {tools.filtered_out.map((tool) => (
                <div key={tool.name} className="px-2 py-1 text-xs text-muted-foreground">
                  <span className="font-mono">{tool.name}</span> — {tool.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
