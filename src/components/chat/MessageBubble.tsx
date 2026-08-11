import { useState } from 'react'
import { AlertTriangle, Check, Copy, FileSpreadsheet, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { FileCard } from '@/components/agent/FileCard'
import { TracePanel } from '@/components/agent/TracePanel'
import { ToolTimeline } from '@/components/agent/ToolTimeline'
import { stripFileRefs } from '@/lib/agent-api'
import type { UIMessage } from '@/hooks/useSessions'

interface MessageBubbleProps {
  message: UIMessage
  onRetry?: (assistantId: string, text: string) => void
  canRetry?: boolean
}

export function MessageBubble({ message, onRetry, canRetry = true }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[74%] flex-col items-end gap-1.5">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-secondary px-4 py-3 text-[15px] leading-relaxed">
            {message.content}
          </div>
          {message.attachment && (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-xs">
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 truncate font-medium">{message.attachment.filename}</span>
              <span className="shrink-0 text-muted-foreground">{message.attachment.summaryLine}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const streaming = message.status === 'streaming'
  const hasFiles = Boolean(message.files && message.files.length > 0)
  // Once file cards render, drop the raw "GET /v1/files/…" text they replace.
  const displayContent = hasFiles ? stripFileRefs(message.content) : message.content
  const copyResponse = async () => {
    try {
      await navigator.clipboard.writeText(displayContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be denied by browser permissions; leave the UI unchanged.
    }
  }

  return (
    <div className="group/message flex gap-3.5">
      <BurstLogo size={26} active={streaming} className="mt-0.5" />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {message.liveTools && message.liveTools.length > 0 && (
          <ToolTimeline tools={message.liveTools} />
        )}

        {message.status === 'error' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{message.error ?? 'Something went wrong.'}</span>
            </div>
            {message.retryText && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.id, message.retryText!)}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
              >
                <RotateCw className="size-3.5" />
                Retry
              </button>
            )}
          </div>
        ) : displayContent ? (
          <MarkdownContent className={cn(streaming && 'streaming-caret')}>
            {displayContent}
          </MarkdownContent>
        ) : streaming && (!message.liveTools || message.liveTools.length === 0) ? (
          <div className="flex items-center py-1 text-sm">
            <span className="thinking-shimmer font-medium">Working…</span>
          </div>
        ) : null}

        {message.trace && message.trace.length > 0 && <TracePanel trace={message.trace} />}

        {hasFiles && (
          <div className="flex flex-col gap-2">
            {message.files!.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        )}

        {message.status === 'done' && displayContent && (
          <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => void copyResponse()}
              aria-label={copied ? 'Response copied' : 'Copy response'}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {message.retryText && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.id, message.retryText!)}
                disabled={!canRetry}
                aria-label="Retry response"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCw className="size-3.5" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
