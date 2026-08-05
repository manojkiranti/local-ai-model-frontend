import { useLocation, useNavigate } from 'react-router-dom'
import { FolderOpen, MessageSquare, MoreHorizontal, PanelLeft, Plus, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME } from '@/lib/branding'
import { cn } from '@/lib/utils'
import type { SessionSummary } from '@/lib/api'

interface SidebarProps {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
  onCollapse: () => void
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onCollapse,
}: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const onFiles = location.pathname === '/files'

  // Chat actions always return to the chat view (the sidebar shows on every page).
  const selectChat = (id: string) => {
    onSelect(id)
    navigate('/')
  }
  const startNewChat = () => {
    onNewChat()
    navigate('/')
  }

  return (
    <aside className="flex h-full w-68 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-4">
        <BurstLogo size={26} title={APP_NAME} />
        <span className="flex-1 text-sm font-semibold tracking-tight">{APP_NAME}</span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <div className="space-y-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={startNewChat}
          className="flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="size-4" />
          New chat
        </button>
        <button
          type="button"
          onClick={() => navigate('/files')}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            onFiles ? 'bg-primary/10 text-foreground' : 'text-foreground/80 hover:bg-muted',
          )}
        >
          <FolderOpen className={cn('size-4', onFiles ? 'text-primary' : 'text-muted-foreground')} />
          My Files
        </button>
      </div>

      <div className="px-5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        Conversations
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No conversations yet — start one below.
          </p>
        ) : (
          sessions.map((session) => {
            const active = !onFiles && session.id === activeId
            return (
              <div
                key={session.id}
                onClick={() => selectChat(session.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-semibold text-foreground'
                    : 'text-foreground/80 hover:bg-muted',
                )}
              >
                <MessageSquare
                  className={cn(
                    'size-4 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                {session.message_count > 0 && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {session.message_count}
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Conversation actions"
                      onClick={(e) => e.stopPropagation()}
                      className="grid size-6 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-background/80 focus:opacity-100 focus:outline-none group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(session.id)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })
        )}
      </nav>

      <div className="border-t px-3 py-2.5">
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          History saved to your account
        </p>
      </div>
    </aside>
  )
}
