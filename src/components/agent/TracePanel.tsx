import { useState } from 'react'
import { ChevronRight, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall, ToolCallStatus, TraceEntry } from '@/lib/agent-api'

const STATUS_STYLES: Record<ToolCallStatus, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  unknown_tool: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad_arguments: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  repeat: 'border-border bg-muted text-muted-foreground',
  tool_error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const MAX_RESULT = 600

function formatArgs(args: ToolCall['arguments']): string {
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const result = call.result ?? ''
  const truncated = result.length > MAX_RESULT
  return (
    <div className="rounded-lg border bg-background p-2.5">
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs font-semibold">{call.name}</span>
        <span
          className={cn(
            'ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium',
            STATUS_STYLES[call.status],
          )}
        >
          {call.status}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        <div>
          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            arguments
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed">
            {formatArgs(call.arguments)}
          </pre>
        </div>
        {result && (
          <div>
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              result
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-[11px] leading-relaxed">
              {truncated ? `${result.slice(0, MAX_RESULT)}…` : result}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Collapsible "glass-box" view of the agent's full loop trace. Kept out of the
 * main chat flow — use it to debug how the model selected tools.
 */
export function TracePanel({ trace }: { trace: TraceEntry[] }) {
  const [open, setOpen] = useState(false)
  const callCount = trace.reduce((n, t) => n + t.tool_calls.length, 0)

  if (trace.length === 0) return null

  return (
    <div className="rounded-xl border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="text-xs font-semibold text-foreground/70">How it worked</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {trace.length} iteration{trace.length === 1 ? '' : 's'} · {callCount} tool call
          {callCount === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {trace.map((entry) => (
            <div key={entry.iteration} className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                iteration {entry.iteration}
              </div>
              {entry.assistant_content && (
                <p className="whitespace-pre-wrap break-words rounded-lg bg-muted px-2.5 py-2 text-xs text-foreground/80">
                  {entry.assistant_content}
                </p>
              )}
              {entry.tool_calls.map((call, i) => (
                <ToolCallRow key={`${entry.iteration}-${i}`} call={call} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
