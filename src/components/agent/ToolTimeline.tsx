import { BookOpenText, Check, Loader2, TriangleAlert, Wrench, X } from 'lucide-react'
import type { LiveTool } from '@/hooks/useSessions'

/** Live timeline of tool calls while a turn streams (before the final trace). */
export function ToolTimeline({ tools }: { tools: LiveTool[] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card/60 px-3 py-2.5">
      {tools.map((tool, i) => (
        <div key={`${tool.name}-${i}`} className="flex items-center gap-2 text-xs">
          {tool.name === 'read_document' ? (
            <BookOpenText className="size-3.5 shrink-0 text-primary" />
          ) : (
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={tool.label ? 'font-medium' : 'font-mono font-semibold'}>
            {tool.label ?? tool.name}
          </span>
          <StatusBadge status={tool.status} />
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: LiveTool['status'] }) {
  if (status === 'running') {
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        working…
      </span>
    )
  }
  if (status === 'ok') {
    return <Check className="ml-auto size-3.5 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === 'tool_error') {
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-destructive">
        <X className="size-3.5" />
        {status}
      </span>
    )
  }
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <TriangleAlert className="size-3.5" />
      {status}
    </span>
  )
}
