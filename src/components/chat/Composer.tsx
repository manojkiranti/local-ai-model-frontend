import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  placeholder?: string
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
}: ComposerProps) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || streaming) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="bg-background px-6 pb-5 pt-3.5">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          className={cn(
            'flex items-end gap-2.5 rounded-[20px] border bg-card py-2.5 pl-4 pr-2.5 shadow-lg transition-colors focus-within:border-primary',
            disabled && 'opacity-60',
          )}
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={
              disabled ? 'Gateway offline — reconnect to send' : (placeholder ?? 'Send a message…')
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-[190px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="grid size-9 shrink-0 place-items-center rounded-full border bg-background text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !text.trim()}
              aria-label="Send message"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        <p className="mt-2.5 text-center font-mono text-[10px] text-muted-foreground">
          {disabled
            ? 'Composer disabled while the gateway is unreachable'
            : 'Enter to send · Shift+Enter for a new line'}
        </p>
      </div>
    </div>
  )
}
