import { useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useHealth } from '@/hooks/useHealth'
import { useSessions } from '@/hooks/useSessions'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { DEFAULT_GENERATION, type GenerationConfig } from '@/lib/chat-config'

export function Workspace() {
  const { theme, toggle } = useTheme()
  const health = useHealth()
  const chat = useSessions()
  const { user, logout } = useAuth()

  const [genConfig, setGenConfig] = useState<GenerationConfig>(DEFAULT_GENERATION)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            sessions={chat.sessions}
            activeId={chat.activeId}
            onSelect={chat.selectSession}
            onNewChat={chat.newChat}
            onDelete={chat.removeSession}
            onCollapse={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            health={health.health}
            reachable={health.reachable}
            loading={health.loading}
            error={health.error}
            theme={theme}
            onToggleTheme={toggle}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            email={user?.email ?? ''}
            role={user?.role ?? 'member'}
            onLogout={logout}
          />

          <div className="min-h-0 flex-1">
            <ChatPanel
              messages={chat.messages}
              sending={chat.sending}
              mode={chat.mode}
              onSetMode={chat.setMode}
              loadingThread={chat.loadingThread}
              reachable={health.reachable}
              genConfig={genConfig}
              onGenConfigChange={setGenConfig}
              onSend={chat.send}
              onRetry={chat.retry}
              onStop={chat.stop}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
