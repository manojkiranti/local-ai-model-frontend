import { AlertTriangle, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { BlobMark } from './BlobMark'
import { DownloadButton } from '@/components/agent/DownloadButton'
import { TracePanel } from '@/components/agent/TracePanel'
import { ToolTimeline } from '@/components/agent/ToolTimeline'
import type { UIMessage } from '@/hooks/useSessions'

interface MessageBubbleProps {
  message: UIMessage
  onRetry?: (assistantId: string, text: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[74%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-secondary px-4 py-3 text-[15px] leading-relaxed">
          {message.content}
        </div>
      </div>
    )
  }

  const streaming = message.status === 'streaming'

  return (
    <div className="flex gap-3.5">
      <BlobMark size={26} active={streaming} className="mt-0.5" />

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
        ) : message.content ? (
          <MarkdownContent className={cn(streaming && 'streaming-caret')}>
            {message.content}
          </MarkdownContent>
        ) : message.liveTools && message.liveTools.length > 0 ? null : (
          <div className="flex items-center gap-2 py-1 text-sm">
            <BlobMark size={16} active />
            <span className="thinking-shimmer font-medium">Working…</span>
          </div>
        )}

        {message.trace && message.trace.length > 0 && <TracePanel trace={message.trace} />}

        {message.downloads && message.downloads.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.downloads.map((download) => (
              <DownloadButton key={download.id} download={download} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
