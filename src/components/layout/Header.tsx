import { Moon, PanelLeft, Sun } from 'lucide-react'
import { SystemStatusBadge } from './McpStatusBadge'
import { BurstLogo } from '@/components/brand/BurstLogo'
import { APP_NAME, APP_NAME_PRIMARY, APP_NAME_SECONDARY } from '@/lib/branding'
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
          <BurstLogo size={22} title={APP_NAME} />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            <span className="text-primary">{APP_NAME_PRIMARY}</span>{' '}
            <span className="text-foreground">{APP_NAME_SECONDARY}</span>
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <SystemStatusBadge
          health={health}
          reachable={reachable}
          loading={loading}
          error={error}
        />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="grid size-8 place-items-center rounded-lg border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  )
}
