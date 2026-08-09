import { AlertTriangle, Building2, Globe2, Loader2, Wrench } from 'lucide-react'
import { toOllamaOptions, type GenerationConfig } from '@/lib/chat-config'
import type { AttachmentDescriptor, UIMessage } from '@/hooks/useSessions'
import type { Department } from '@/lib/api'
import { useAttachment } from '@/hooks/useAttachment'
import { describeUploadSummary } from '@/lib/upload-validation'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { GenerationSettings } from './GenerationSettings'

interface ChatPanelProps {
  messages: UIMessage[]
  sending: boolean
  loadingThread: boolean
  reachable: boolean
  genConfig: GenerationConfig
  onGenConfigChange: (config: GenerationConfig) => void
  onSend: (
    text: string,
    options?: Record<string, unknown>,
    attachment?: AttachmentDescriptor,
    department?: string,
  ) => void
  onRetry: (assistantId: string, text: string, options?: Record<string, unknown>) => void
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
  genConfig,
  onGenConfigChange,
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
          }
        : undefined
    onSend(text, toOllamaOptions(genConfig), descriptor, activeDepartment ?? undefined)
    clear()
  }
  const handleRetry = (assistantId: string, text: string) =>
    onRetry(assistantId, text, toOllamaOptions(genConfig))

  const canSend = reachable && !sending

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-4 py-2">
        <button
          type="button"
          onClick={() => onDepartmentChange(null)}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
            activeDepartment === null
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe2 className="size-3.5" />
          General
        </button>
        {departments.filter((department) => department.is_active).map((department) => (
          <button
            key={department.id}
            type="button"
            onClick={() => onDepartmentChange(department.code)}
            title={`${department.name} (${department.code})`}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
              activeDepartment === department.code
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="size-3.5" />
            {department.name}
          </button>
        ))}
        {departmentsLoading && <Loader2 className="ml-1 size-4 shrink-0 animate-spin text-muted-foreground" />}
        {departmentsError && (
          <span className="ml-1 shrink-0 text-xs text-destructive" title={departmentsError}>
            Departments unavailable
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Wrench className="size-3.5" />
          Tools run automatically when useful
        </div>
        <div className="ml-auto">
          <GenerationSettings value={genConfig} onChange={onGenConfigChange} />
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
