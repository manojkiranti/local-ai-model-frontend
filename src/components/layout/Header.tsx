import { Cpu, LogOut, Moon, PanelLeft, Sun, User } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { HealthResponse } from '@/lib/api'
import type { Theme } from '@/hooks/useTheme'

interface HeaderProps {
  health: HealthResponse | null
  reachable: boolean
  loading: boolean
  error: string | null
  theme: Theme
  onToggleTheme: () => void
  sidebarOpen: boolean
  onOpenSidebar: () => void
  email: string
  role: 'admin' | 'member'
  onLogout: () => void
}

export function Header({
  health,
  reachable,
  loading,
  error,
  theme,
  onToggleTheme,
  sidebarOpen,
  onOpenSidebar,
  email,
  role,
  onLogout,
}: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      {!sidebarOpen && (
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
          <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
            <Cpu className="size-3.5" />
          </div>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Ollama Workspace
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <StatusDot health={health} reachable={reachable} loading={loading} error={error} />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm transition-colors hover:border-primary"
          >
            <User className="size-4 text-muted-foreground" />
            <span className="hidden max-w-40 truncate sm:inline">{email}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
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
    </header>
  )
}
