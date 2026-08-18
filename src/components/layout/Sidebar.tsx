import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronsUpDown,
  FolderOpen,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { Badge } from '@/components/ui/badge'
import { APP_NAME, APP_NAME_PRIMARY, APP_NAME_SECONDARY, APP_TAGLINE } from '@/lib/branding'
import { cn } from '@/lib/utils'
import type { SessionSummary } from '@/lib/api'

const CONVERSATION_GROUPS = ['Today', 'Yesterday', 'Earlier'] as const

function conversationGroup(updatedAt: string): (typeof CONVERSATION_GROUPS)[number] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const updated = new Date(updatedAt)

  if (updated >= today) return 'Today'
  if (updated >= yesterday) return 'Yesterday'
  return 'Earlier'
}

interface SidebarProps {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
  onCollapse: () => void
  onNavigate: () => void
  isAdmin: boolean
  email: string
  role: 'admin' | 'member'
  onLogout: () => void
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onCollapse,
  onNavigate,
  isAdmin,
  email,
  role,
  onLogout,
}: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const onFiles = location.pathname === '/files'
  const onAdmin = location.pathname === '/admin'
  const onNrb = location.pathname === '/admin/nrb'
  const groupedSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = normalizedQuery
      ? sessions.filter((session) =>
          (session.title || 'Untitled chat').toLowerCase().includes(normalizedQuery),
        )
      : sessions

    return CONVERSATION_GROUPS.map((label) => ({
      label,
      sessions: filtered.filter((session) => conversationGroup(session.updated_at) === label),
    })).filter((group) => group.sessions.length > 0)
  }, [query, sessions])

  // Chat actions always return to the chat view (the sidebar shows on every page).
  const selectChat = (id: string) => {
    onSelect(id)
    navigate('/')
    onNavigate()
  }
  const startNewChat = () => {
    onNewChat()
    navigate('/')
    onNavigate()
  }
  const openPage = (path: string) => {
    navigate(path)
    onNavigate()
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(19rem,calc(100vw-2.5rem))] shrink-0 flex-col border-r border-white/10 bg-sidebar text-sidebar-foreground shadow-2xl md:relative md:z-auto md:h-full md:w-68 md:shadow-none">
      <div className="flex items-start gap-2.5 border-b border-white/10 px-4 pb-3 pt-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
          <BurstLogo size={24} />
        </div>
        <div className="min-w-0 flex-1 leading-tight" title={APP_NAME}>
          <p className="truncate text-xs font-bold tracking-tight text-primary">{APP_NAME_PRIMARY}</p>
          <p className="truncate text-lg font-extrabold tracking-tight text-sidebar-foreground">
            {APP_NAME_SECONDARY}
          </p>
          <p
            title={APP_TAGLINE}
            className="mt-1 w-fit max-w-full truncate rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-tight text-primary"
          >
            {APP_TAGLINE}
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-sidebar-muted-foreground transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <div className="space-y-1.5 px-3 pb-3 pt-3">
        <button
          type="button"
          onClick={startNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New chat
        </button>
        <button
          type="button"
          onClick={() => openPage('/files')}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            onFiles ? 'bg-primary/15 text-sidebar-foreground' : 'text-sidebar-foreground/80 hover:bg-white/5',
          )}
        >
          <FolderOpen className={cn('size-4', onFiles ? 'text-primary' : 'text-sidebar-muted-foreground')} />
          My Files
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => openPage('/admin')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
              onAdmin ? 'bg-primary/15 text-sidebar-foreground' : 'text-sidebar-foreground/80 hover:bg-white/5',
            )}
          >
            <Settings2 className={cn('size-4', onAdmin ? 'text-primary' : 'text-sidebar-muted-foreground')} />
            RAG Admin
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => openPage('/admin/nrb')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
              onNrb ? 'bg-primary/15 text-sidebar-foreground' : 'text-sidebar-foreground/80 hover:bg-white/5',
            )}
          >
            <RefreshCw className={cn('size-4', onNrb ? 'text-primary' : 'text-sidebar-muted-foreground')} />
            NRB Updates
          </button>
        )}

        <label className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sidebar-muted-foreground transition-colors focus-within:border-primary/50 focus-within:bg-white/10">
          <Search className="size-3.5 shrink-0" />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
          />
        </label>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pr-1.5">
        {sessions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
            No conversations yet — start a new chat.
          </p>
        ) : groupedSessions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">No chats match “{query}”.</p>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-sidebar-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.sessions.map((session) => {
                  const active = !onFiles && !onAdmin && !onNrb && session.id === activeId
                  return (
                    <div
                      key={session.id}
                      onClick={() => selectChat(session.id)}
                      className={cn(
                        'group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                        active
                          ? 'bg-primary/15 font-medium text-sidebar-foreground shadow-[inset_2px_0_0_var(--color-primary)]'
                          : 'text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground',
                      )}
                    >
                      <MessageSquare
                        className={cn(
                          'size-3.5 shrink-0',
                          active ? 'text-primary' : 'text-sidebar-muted-foreground',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled chat'}</span>
                      {session.message_count > 0 && (
                        <span className="font-mono text-[10px] text-sidebar-muted-foreground">
                          {session.message_count}
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Conversation actions"
                            onClick={(event) => event.stopPropagation()}
                            className="grid size-6 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-white/10 focus:opacity-100 focus:outline-none group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(session.id)}>
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-semibold uppercase text-primary-foreground shadow-sm">
              {email.charAt(0) || 'U'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{email}</span>
              <span className="block text-xs capitalize text-sidebar-muted-foreground">{role}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-62">
            <div className="flex flex-col gap-1 px-2 py-1.5">
              <span className="truncate text-sm font-medium">{email}</span>
              <Badge
                variant={role === 'admin' ? 'default' : 'outline'}
                className="w-fit capitalize"
              >
                {role}
              </Badge>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
