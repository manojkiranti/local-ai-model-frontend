import { useRef, useState } from 'react'
import { AlertTriangle, Bug, Cpu, Info } from 'lucide-react'
import {
  extractDownloads,
  runAgent,
  type AgentResponse,
  type FileDownload,
} from '@/lib/agent-api'
import { describeError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MarkdownContent } from '@/components/chat/MarkdownContent'
import { Composer } from '@/components/chat/Composer'
import { ToolsIndicator } from './ToolsIndicator'
import { DownloadButton } from './DownloadButton'
import { TracePanel } from './TracePanel'

interface AgentTurn {
  id: string
  prompt: string
  status: 'loading' | 'done' | 'error'
  response: AgentResponse | null
  downloads: FileDownload[]
  error: string | null
}

const EXAMPLES = [
  'Create an Excel named budget.xlsx with columns Item, Category, Amount and rows Rent/Housing/2000, Groceries/Food/600 — then give me the download link.',
  'What tools do you have available, and what can each one do?',
  'Summarise what a local Ollama gateway is in two sentences.',
]

export function AgentPanel() {
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [debug, setDebug] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const patchTurn = (id: string, patch: Partial<AgentTurn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const handleSend = async (text: string) => {
    const id = crypto.randomUUID()
    setTurns((prev) => [
      ...prev,
      { id, prompt: text, status: 'loading', response: null, downloads: [], error: null },
    ])
    setBusy(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const response = await runAgent(text, controller.signal)
      patchTurn(id, {
        status: 'done',
        response,
        downloads: extractDownloads(response.trace),
      })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      patchTurn(id, {
        status: 'error',
        error: aborted ? 'Stopped.' : describeError(e),
      })
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setBusy(false)
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
    }
  }

  const stop = () => controllerRef.current?.abort()

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
        <ToolsIndicator />
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setDebug((v) => !v)}
            aria-pressed={debug}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              debug
                ? 'border-primary bg-primary/10 text-primary'
                : 'bg-card text-foreground/70 hover:border-primary hover:text-primary',
            )}
          >
            <Bug className="size-3.5" />
            Debug
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <EmptyState onExample={handleSend} disabled={busy} />
        ) : (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-6 py-7">
            {turns.map((turn) => (
              <Turn key={turn.id} turn={turn} debug={debug} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <Composer
        onSend={handleSend}
        onStop={stop}
        streaming={busy}
        disabled={false}
        placeholder="Ask the agent — it can call tools like create_excel…"
      />
    </div>
  )
}

function Turn({ turn, debug }: { turn: AgentTurn; debug: boolean }) {
  const res = turn.response
  return (
    <div className="flex flex-col gap-6">
      {/* User prompt */}
      <div className="flex justify-end">
        <div className="max-w-[74%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-secondary px-4 py-3 text-[15px] leading-relaxed">
          {turn.prompt}
        </div>
      </div>

      {/* Assistant */}
      <div className="flex gap-3.5">
        <div className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Cpu className="size-3.5" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {turn.status === 'loading' && (
            <div className="flex items-center gap-1 py-1 text-sm text-muted-foreground">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
              <span className="ml-2 text-xs">Thinking &amp; calling tools…</span>
            </div>
          )}

          {turn.status === 'error' && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{turn.error}</span>
            </div>
          )}

          {res && res.stop_reason === 'error' && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{res.error_message ?? 'The agent reported an error.'}</span>
            </div>
          )}

          {res && res.final_answer && res.stop_reason !== 'error' && (
            <MarkdownContent>{res.final_answer}</MarkdownContent>
          )}

          {res && res.stop_reason !== 'error' && !res.final_answer && (
            <p className="text-sm text-muted-foreground">
              The agent finished without a text answer.
            </p>
          )}

          {res && res.stop_reason === 'max_iterations' && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Info className="size-3.5 shrink-0" />
              Stopped early (hit iteration cap).
            </div>
          )}

          {turn.downloads.map((download) => (
            <DownloadButton key={download.id} download={download} />
          ))}

          {res && (
            <div className="flex items-center gap-2.5 font-mono text-[10px] text-muted-foreground">
              <span>{res.iteration_count} iteration{res.iteration_count === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{res.stop_reason}</span>
            </div>
          )}

          {debug && res && <TracePanel trace={res.trace} />}
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  onExample,
  disabled,
}: {
  onExample: (text: string) => void
  disabled: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-[660px] flex-col items-start px-6 pb-6 pt-[11vh]">
      <div className="mb-5 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Cpu className="size-6" />
      </div>
      <h1 className="text-[31px] font-semibold leading-tight tracking-tight text-pretty">
        What can the agent do for you?
      </h1>
      <p className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground text-pretty">
        Ask in plain language — the model decides when to call tools like generating
        a spreadsheet. Everything runs against your local gateway.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={disabled}
            onClick={() => onExample(example)}
            className="group flex items-start gap-3 rounded-[13px] border bg-card px-4 py-3 text-left text-[14.5px] shadow-sm transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex-1">{example}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
