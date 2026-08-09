import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { FilesPage } from '@/components/files/FilesPage'
import { AdminRagPage } from '@/components/admin/AdminRagPage'
import { useHealth } from '@/hooks/useHealth'
import { useSessions } from '@/hooks/useSessions'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { useDepartments } from '@/hooks/useDepartments'
import { DEFAULT_GENERATION, type GenerationConfig } from '@/lib/chat-config'

export function Workspace() {
  const { theme, toggle } = useTheme()
  const health = useHealth()
  const chat = useSessions()
  const departmentState = useDepartments()
  const { user, logout, isAdmin } = useAuth()

  const [genConfig, setGenConfig] = useState<GenerationConfig>(DEFAULT_GENERATION)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null)

  const changeDepartment = (code: string | null) => {
    if (code === activeDepartment) return
    chat.newChat()
    setActiveDepartment(code)
  }

  const selectSession = (id: string) => {
    // Session DTOs do not expose their department. Continuing a session is safe
    // because the gateway remembers its binding and the client sends no scope.
    setActiveDepartment(null)
    void chat.selectSession(id)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            sessions={chat.sessions}
            activeId={chat.activeId}
            onSelect={selectSession}
            onNewChat={chat.newChat}
            onDelete={chat.removeSession}
            onCollapse={() => setSidebarOpen(false)}
            isAdmin={isAdmin}
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
            <Routes>
              <Route
                index
                element={
                  <ChatPanel
                    messages={chat.messages}
                    sending={chat.sending}
                    loadingThread={chat.loadingThread}
                    reachable={health.reachable}
                    genConfig={genConfig}
                    onGenConfigChange={setGenConfig}
                    onSend={chat.send}
                    onRetry={chat.retry}
                    onStop={chat.stop}
                    departments={departmentState.departments}
                    departmentsLoading={departmentState.loading}
                    departmentsError={departmentState.error}
                    activeDepartment={activeDepartment}
                    onDepartmentChange={changeDepartment}
                  />
                }
              />
              <Route path="files" element={<FilesPage />} />
              <Route
                path="admin"
                element={
                  isAdmin ? (
                    <AdminRagPage
                      departments={departmentState.departments}
                      onDepartmentsChanged={departmentState.reload}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
            </Routes>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
