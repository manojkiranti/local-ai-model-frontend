import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileSpreadsheet, Loader2, Paperclip, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Attachment } from '@/hooks/useAttachment'
import { UPLOAD_ACCEPT, describeUploadSummary } from '@/lib/upload-validation'

interface ComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  placeholder?: string
  attachment: Attachment | null
  onPickFile: (file: File) => void
  onClearAttachment: () => void
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  attachment,
  onPickFile,
  onClearAttachment,
}: ComposerProps) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
        <input
          ref={fileRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPickFile(file)
            e.target.value = '' // allow re-picking the same file
          }}
        />

        {attachment && (
          <div
            className={cn(
              'mb-2 flex w-fit max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm',
              attachment.status === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {attachment.status === 'uploading' ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <FileSpreadsheet className="size-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <div className="truncate font-medium">
                {attachment.status === 'ready' ? attachment.file.filename : attachment.filename}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {attachment.status === 'uploading'
                  ? 'Uploading…'
                  : attachment.status === 'ready'
                    ? describeUploadSummary(attachment.file.summary)
                    : attachment.message}
              </div>
            </div>
            <button
              type="button"
              onClick={onClearAttachment}
              aria-label="Remove attachment"
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div
          className={cn(
            'flex items-end gap-2.5 rounded-[20px] border bg-card py-2.5 pl-4 pr-2.5 shadow-lg transition-colors focus-within:border-primary',
            disabled && 'opacity-60',
          )}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            aria-label="Attach a spreadsheet"
            title="Attach a spreadsheet (.xlsx, .csv)"
            className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip className="size-[18px]" />
          </button>
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
