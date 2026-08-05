import { useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME } from '@/lib/branding'
import type { UIMessage } from '@/hooks/useSessions'

// Clickable starter prompts — each one exercises a real tool the gateway exposes
// (employee records, web lookup, file generation).
const EXAMPLES = [
  'Get the employee details from the HR system.',
  'Look up https://www.nicasiabank.com/ and summarise what NIC Asia Bank offers.',
  'Generate an Excel list of all employees with their departments.',
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
      <div className="mx-auto flex w-full max-w-[660px] flex-col items-start px-6 pb-6 pt-[11vh]">
        <BurstLogo size={46} title={APP_NAME} className="mb-5" />
        <h1 className="text-[31px] font-semibold leading-tight tracking-tight text-pretty">
          What can I help you with?
        </h1>
        <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground text-pretty">
          Ask a question, pull up employee records, research a company from its
          website, or turn the answer into a spreadsheet, document, or chart.
        </p>
        <div className="mt-6 flex w-full flex-col gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={!canSend}
              onClick={() => onExample(example)}
              className="group flex items-center gap-3 rounded-[13px] border bg-card px-4 py-3 text-left text-[14.5px] shadow-sm transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex-1">{example}</span>
              <ArrowRight className="size-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-6 py-7">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} onRetry={onRetry} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
