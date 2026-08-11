import { useEffect, useRef } from 'react'
import { ArrowRight, FileSpreadsheet, Globe2, Users, Wrench } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME } from '@/lib/branding'
import type { UIMessage } from '@/hooks/useSessions'

// Clickable starter prompts — each one exercises a real tool the gateway exposes
// (employee records, web lookup, file generation).
const EXAMPLES = [
  {
    category: 'HR system',
    text: 'Get the employee details from the HR system.',
    icon: Users,
  },
  {
    category: 'Web research',
    text: 'Look up NIC Asia Bank and summarise what it offers.',
    prompt: 'Look up https://www.nicasiabank.com/ and summarise what NIC Asia Bank offers.',
    icon: Globe2,
  },
  {
    category: 'Create a file',
    text: 'Generate an Excel list of all employees and departments.',
    prompt: 'Generate an Excel list of all employees with their departments.',
    icon: FileSpreadsheet,
  },
  {
    category: 'Explore tools',
    text: 'Show me what tools are available in this workspace.',
    icon: Wrench,
  },
]

interface MessageListProps {
  messages: UIMessage[]
  onExample: (text: string) => void
  canSend: boolean
  onRetry?: (assistantId: string, text: string) => void
}

export function MessageList({ messages, onExample, canSend, onRetry }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastContentLen = messages[messages.length - 1]?.content.length ?? 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastContentLen])

  if (messages.length === 0) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-5 py-10 sm:px-6">
        <BurstLogo size={44} title={APP_NAME} className="mb-5" />
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-pretty sm:text-[32px]">
          What can I help you with?
        </h1>
        <p className="mt-2 max-w-[58ch] text-[14px] leading-relaxed text-muted-foreground text-pretty sm:text-[15px]">
          Ask a question, pull up employee records, research a company from its
          website, or turn the answer into a spreadsheet, document, or chart.
        </p>
        <div className="mt-7 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.category}
              type="button"
              disabled={!canSend}
              onClick={() => onExample(example.prompt ?? example.text)}
              className="group flex min-h-28 flex-col rounded-2xl border bg-card p-4 text-left shadow-sm transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className="flex w-full items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                  <example.icon className="size-3.5" />
                </span>
                {example.category}
              </span>
              <span className="mt-3 flex w-full flex-1 items-end gap-3 text-[13.5px] leading-snug text-foreground/85">
                <span className="flex-1">{example.text}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-6 py-7">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} onRetry={onRetry} canRetry={canSend} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
