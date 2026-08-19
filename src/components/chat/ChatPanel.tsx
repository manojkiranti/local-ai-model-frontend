import { AlertTriangle, Loader2, Wrench } from 'lucide-react'
import type { AttachmentDescriptor, UIMessage } from '@/hooks/useSessions'
import type { Department } from '@/lib/api'
import { useAttachment } from '@/hooks/useAttachment'
import { attachmentWarning, describeUploadSummary } from '@/lib/upload-validation'
import { DepartmentBar } from './DepartmentBar'
import { MessageList } from './MessageList'
import { Composer } from './Composer'

interface ChatPanelProps {
  messages: UIMessage[]
  sending: boolean
  loadingThread: boolean
  reachable: boolean
  onSend: (
    text: string,
    attachment?: AttachmentDescriptor,
    department?: string,
  ) => void
  onRetry: (assistantId: string, text: string) => void
  onStop: () => void
  departments: Department[]
  departmentsLoading: boolean
  departmentsError: string | null
  activeDepartment: string | null
  onDepartmentChange: (code: string | null) => void
}

export function ChatPanel({
  messages,
  sending,
  loadingThread,
  reachable,
  onSend,
  onRetry,
  onStop,
  departments,
  departmentsLoading,
  departmentsError,
  activeDepartment,
  onDepartmentChange,
}: ChatPanelProps) {
  const { attachment, pick, clear } = useAttachment()

  const handleSend = (text: string) => {
    const descriptor =
      attachment?.status === 'ready'
        ? {
            id: attachment.file.id,
            filename: attachment.file.filename,
            summaryLine: describeUploadSummary(attachment.file.summary),
            warning: attachmentWarning(attachment.file.summary) ?? undefined,
            isImage: attachment.file.media_type.startsWith('image/'),
          }
        : undefined
    onSend(text, descriptor, activeDepartment ?? undefined)
    clear()
  }
  const handleRetry = (assistantId: string, text: string) => onRetry(assistantId, text)

  const canSend = reachable && !sending

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <DepartmentBar
          departments={departments}
          loading={departmentsLoading}
          error={departmentsError}
          value={activeDepartment}
          onChange={onDepartmentChange}
        />
        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
          <Wrench className="size-3.5" />
          Tools automatic
        </div>
      </div>

      {!reachable && (
        <div className="mx-6 mt-3.5 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="text-[13px] leading-relaxed">
            <div className="font-semibold">Service unavailable</div>
            <div className="text-foreground/70">
              Can't reach the assistant right now — this panel reconnects on its own.
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingThread ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onExample={handleSend}
            canSend={canSend}
            onRetry={handleRetry}
          />
        )}
      </div>

      <Composer
        onSend={handleSend}
        onStop={onStop}
        streaming={sending}
        disabled={!reachable}
        placeholder="Send a message — the model uses tools when useful…"
        attachment={attachment}
        onPickFile={pick}
        onClearAttachment={clear}
      />
    </div>
  )
}
