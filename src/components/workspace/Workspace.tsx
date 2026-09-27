import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { FilesPage } from '@/components/files/FilesPage'
import { AdminRagPage } from '@/components/admin/AdminRagPage'
import { NrbOpsPage } from '@/components/admin/NrbOpsPage'
import { UsersPage } from '@/components/admin/UsersPage'
import { UserDetailPage } from '@/components/admin/UserDetailPage'
import { FullScreenSpinner } from '@/components/routing/FullScreenSpinner'
import { hasAnyDepartmentAtLeast } from '@/lib/department-scopes'
import { useHealth } from '@/hooks/useHealth'
import { useSessions, type AttachmentDescriptor } from '@/hooks/useSessions'
import { useChatScope } from '@/hooks/useChatScope'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { useDepartments } from '@/hooks/useDepartments'

export function Workspace() {
  const { theme, toggle } = useTheme()
  const health = useHealth()
  const chat = useSessions()
  const departmentState = useDepartments()
  const { user, logout, isAdmin } = useAuth()

  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  )
  const scope = useChatScope({
    departments: departmentState.departments,
    loading: departmentState.loading,
    sessionOpen: chat.activeId !== null,
  })

  // The RAG screen is no longer admin-only: curation is a per-department level,
  // so anyone holding editor or owner anywhere needs the entry point. Read from
  // the gateway's own `role` field — it already folds in global admins, and a
  // second copy of the policy here would drift from the one the API enforces.
  const canManageRag = isAdmin || hasAnyDepartmentAtLeast(departmentState.departments, 'editor')

  const changeDepartment = (code: string | null) => {
    if (code === scope.scope) return
    chat.newChat()
    scope.pin(code)
  }

  const selectSession = (id: string) => {
    // Re-opening the open chat changes nothing, and must not trade a scope we
    // know (it started here) for a row that may not carry one.
    if (id === chat.activeId) return
    // Display only: continuing a chat sends no scope, because the gateway reads
    // the binding it stored. An absent `department` (an older gateway) pins
    // "unknown", which shows no chip rather than a General that may be false.
    scope.pin(chat.sessions.find((session) => session.id === id)?.department)
    void chat.selectSession(id)
  }

  const send = (text: string, attachment?: AttachmentDescriptor, department?: string) => {
    // A new chat's first turn fixes its scope, including a General one sent
    // before the department list landed.
    if (chat.activeId === null) scope.pin(department ?? null)
    chat.send(text, attachment, department)
  }

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const syncSidebar = (event: MediaQueryListEvent) => setSidebarOpen(event.matches)
    desktop.addEventListener('change', syncSidebar)
    return () => desktop.removeEventListener('change', syncSidebar)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !window.matchMedia('(min-width: 768px)').matches) {
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  const closeSidebarOnMobile = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(false)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full overflow-hidden">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] md:hidden"
          />
        )}
        {sidebarOpen && (
          <Sidebar
            sessions={chat.sessions}
            activeId={chat.activeId}
            onSelect={selectSession}
            onNewChat={chat.newChat}
            onDelete={chat.removeSession}
            onCollapse={() => setSidebarOpen(false)}
            onNavigate={closeSidebarOnMobile}
            isAdmin={isAdmin}
            canManageRag={canManageRag}
            email={user?.email ?? ''}
            role={user?.role ?? 'member'}
            onLogout={logout}
            sessionsError={chat.sessionsError}
            hasMoreSessions={chat.hasMoreSessions}
            loadingMoreSessions={chat.loadingMoreSessions}
            onLoadMoreSessions={chat.loadMoreSessions}
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
                    onSend={send}
                    onRetry={chat.retry}
                    onStop={chat.stop}
                    departments={departmentState.departments}
                    departmentsLoading={departmentState.loading}
                    departmentsError={departmentState.error}
                    activeDepartment={scope.scope}
                    onDepartmentChange={changeDepartment}
                    hasOlderMessages={chat.hasOlderMessages}
                    loadingOlder={chat.loadingOlder}
                    onLoadOlder={chat.loadOlderMessages}
                  />
                }
              />
              <Route path="files" element={<FilesPage />} />
              <Route
                path="admin"
                element={
                  canManageRag ? (
                    <AdminRagPage
                      departments={departmentState.departments}
                      onDepartmentsChanged={departmentState.reload}
                      isAdmin={isAdmin}
                    />
                  ) : departmentState.loading ? (
                    // The grants decide this, and they arrive after the first
                    // paint. Redirecting on the empty initial list would bounce
                    // every editor straight back to the chat.
                    <FullScreenSpinner />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              {/*
                No client-side redirect here: the page itself reports a 403 from
                the gateway, which is a different state from an expired session
                and must not bounce anyone to login. The backend remains
                authoritative either way.
              */}
              <Route
                path="admin/nrb"
                element={<NrbOpsPage departments={departmentState.departments} />}
              />
              {/* Like NRB: no client redirect. A non-admin who reaches this URL
                  sees the gateway's 403 in-page, which is not an expired
                  session and must not bounce them to login. */}
              <Route
                path="admin/users"
                element={<UsersPage currentUserId={user?.id ?? -1} />}
              />
              {/* Same reasoning as admin/users: no client redirect. A non-admin
                  who reaches this URL sees the gateway's 403 in-page, which is
                  not an expired session. */}
              <Route
                path="admin/users/:id"
                element={<UserDetailPage currentUserId={user?.id ?? -1} />}
              />
            </Routes>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
