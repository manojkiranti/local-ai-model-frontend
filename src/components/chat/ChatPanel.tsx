import { AlertTriangle, Loader2, MessagesSquare, Wrench } from 'lucide-react'
import { toOllamaOptions, type GenerationConfig } from '@/lib/chat-config'
import type { TurnMode, UIMessage } from '@/hooks/useSessions'
import { cn } from '@/lib/utils'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { GenerationSettings } from './GenerationSettings'

interface ChatPanelProps {
  messages: UIMessage[]
  sending: boolean
  mode: TurnMode
  onSetMode: (mode: TurnMode) => void
  loadingThread: boolean
  reachable: boolean
  genConfig: GenerationConfig
  onGenConfigChange: (config: GenerationConfig) => void
  onSend: (text: string, options?: Record<string, unknown>) => void
  onRetry: (assistantId: string, text: string, options?: Record<string, unknown>) => void
  onStop: () => void
}

export function ChatPanel({
  messages,
  sending,
  mode,
  onSetMode,
  loadingThread,
  reachable,
  genConfig,
  onGenConfigChange,
  onSend,
  onRetry,
  onStop,
}: ChatPanelProps) {
  // Generation options apply to plain chat; the agent turn ignores them.
  const handleSend = (text: string) => onSend(text, toOllamaOptions(genConfig))
  const handleRetry = (assistantId: string, text: string) =>
    onRetry(assistantId, text, toOllamaOptions(genConfig))

  const canSend = reachable && !sending

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
        <ModeToggle mode={mode} onChange={onSetMode} disabled={sending} />
        <div className="ml-auto">
          <GenerationSettings value={genConfig} onChange={onGenConfigChange} />
        </div>
      </div>

      {!reachable && (
        <div className="mx-6 mt-3.5 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="text-[13px] leading-relaxed">
            <div className="font-semibold">Gateway offline</div>
            <div className="text-foreground/70">
              Can't reach the gateway. Start it and this panel reconnects on its own.
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
        placeholder={
          mode === 'agent'
            ? 'Ask the agent — it can create files and use tools…'
            : 'Send a message…'
        }
      />
    </div>
  )
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: TurnMode
  onChange: (mode: TurnMode) => void
  disabled: boolean
}) {
  const options: { value: TurnMode; label: string; icon: typeof Wrench }[] = [
    { value: 'chat', label: 'Chat', icon: MessagesSquare },
    { value: 'agent', label: 'Tools', icon: Wrench },
  ]
  return (
    <div
      role="tablist"
      aria-label="Conversation mode"
      className="inline-flex items-center gap-1 rounded-xl bg-muted p-1"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const selected = mode === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(value)}
            title={
              value === 'agent'
                ? 'Agent mode: the model can call tools (file creation, data lookups)'
                : 'Plain chat: conversation only, no tools'
            }
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
