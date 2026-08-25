import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, UserCog } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { McpGrantsPanel } from '@/components/admin/McpGrantsPanel'
import { UserActiveToggle } from '@/components/admin/UserActiveToggle'
import { useMcpGrants } from '@/hooks/useMcpGrants'
import { gatewayDetail, listUsers, updateUser, type UserOut } from '@/lib/api'

interface UserDetailPageProps {
  currentUserId: number
}

/**
 * One user's administrable state: their account switch, and the MCP grants they
 * hold.
 *
 * The route has NO client-side admin guard, matching the Users and NRB screens:
 * a non-admin who reaches the URL sees the gateway's 403 rendered here, which is
 * not an expired session and must not bounce them to login.
 */
export function UserDetailPage({ currentUserId }: UserDetailPageProps) {
  const { id } = useParams()
  const userId = Number(id)
  const location = useLocation()
  const seeded = (location.state as { user?: UserOut } | null)?.user ?? null

  const [directory, setDirectory] = useState<UserOut[]>([])
  const [record, setRecord] = useState<UserOut | null>(seeded)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grants = useMcpGrants(userId)

  // There is no GET /users/{id}: only /users/me and the paginated list. One wide
  // page covers a cold deep-link AND resolves granted_by ids to emails.
  useEffect(() => {
    const controller = new AbortController()
    listUsers({}, controller.signal)
      .then((page) => {
        setDirectory(page.items)
        const found = page.items.find((item) => item.id === userId)
        if (found) setRecord(found)
      })
      .catch(() => {
        // Non-fatal: the grants panel is the point of this page and reports its
        // own failures. Falling back to an id beats an error banner here.
      })
    return () => controller.abort()
  }, [userId])

  const resolveGranter = useCallback(
    (granterId: number | null): string | null => {
      if (granterId === null) return null
      if (granterId === currentUserId) return 'you'
      return directory.find((item) => item.id === granterId)?.email ?? null
    },
    [currentUserId, directory],
  )

  const isSelf = userId === currentUserId
  const heading = useMemo(
    () => record?.email ?? `User #${Number.isFinite(userId) ? userId : id}`,
    [id, record, userId],
  )

  async function setActive(isActive: boolean) {
    if (!record) return
    setBusy(true)
    setNotice(null)
    try {
      setRecord(await updateUser(record.id, { is_active: isActive }))
    } catch (error) {
      // A 409 (own account, last active admin) is a policy refusal, not an auth
      // failure: render it verbatim and leave the account as it was.
      setNotice(gatewayDetail(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <Link
          to="/admin/users"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Users
        </Link>

        <header className="mb-5 flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <UserCog className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{heading}</h1>
            {record && (
              <p className="text-xs text-muted-foreground">
                {record.is_active ? 'Active' : 'Inactive'} · {record.auth_provider}
              </p>
            )}
          </div>
          {record && (
            <>
              <Badge variant="outline" className="capitalize">{record.role}</Badge>
              <UserActiveToggle
                user={record}
                isSelf={isSelf}
                busy={busy}
                onChange={(isActive) => void setActive(isActive)}
              />
            </>
          )}
        </header>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="min-w-0">{notice}</p>
          </div>
        )}

        <McpGrantsPanel
          items={grants.items}
          loading={grants.loading}
          error={grants.error}
          busy={grants.busy}
          onGrant={grants.grant}
          onRevoke={grants.revoke}
          resolveGranter={resolveGranter}
          isSelf={isSelf}
        />
      </div>
    </div>
  )
}
