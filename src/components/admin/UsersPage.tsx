import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Loader2, Search, ShieldCheck, UserCog } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  describeError,
  GatewayError,
  listUsers,
  updateUser,
  type UserOut,
} from '@/lib/api'

const PAGE_SIZE = 50

function userError(error: unknown): string {
  return error instanceof GatewayError ? error.message : describeError(error)
}

interface UsersPageProps {
  /** The signed-in admin, so their own row cannot offer self-deactivation —
   *  the one deactivation refusal the client can know ahead of the request. */
  currentUserId: number
}

/** Global-admin directory: search users and switch accounts on or off. */
export function UsersPage({ currentUserId }: UsersPageProps) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [users, setUsers] = useState<UserOut[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const page = await listUsers({ q: submittedQuery, limit: PAGE_SIZE, offset })
      setUsers(page.items)
      setTotal(page.total)
    } catch (error) {
      setNotice(userError(error))
    } finally {
      setLoading(false)
    }
  }, [offset, submittedQuery])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() flips the loading flag before fetching the page
    void load()
  }, [load])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    // A new search always starts from the first page.
    setOffset(0)
    setSubmittedQuery(query.trim())
  }

  async function setActive(user: UserOut, isActive: boolean) {
    setBusy(user.id)
    setNotice(null)
    try {
      const updated = await updateUser(user.id, { is_active: isActive })
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (error) {
      // A 409 (last admin, own account) is a policy refusal, not an auth
      // failure; render it verbatim and leave the row as it was.
      setNotice(userError(error))
    } finally {
      setBusy(null)
    }
  }

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = offset + users.length
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Users</h1>
            <p className="text-xs text-muted-foreground">Search the directory and offboard accounts.</p>
          </div>
        </header>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="min-w-0">{notice}</p>
          </div>
        )}

        <form onSubmit={submitSearch} className="mb-4 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="user-search" className="sr-only">Search users</Label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="user-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by email…"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>Search</Button>
        </form>

        <section className="rounded-xl border bg-card">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {submittedQuery ? `No users match “${submittedQuery}”.` : 'No users found.'}
            </p>
          ) : (
            <ul className="divide-y">
              {users.map((user) => {
                const isSelf = user.id === currentUserId
                return (
                  <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                    <UserCog className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{user.email}</span>
                    <Badge variant="outline" className="capitalize">{user.role}</Badge>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs ${user.is_active ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${user.is_active ? 'bg-green-600' : 'bg-muted-foreground/50'}`}
                      />
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {user.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void setActive(user, false)}
                        // Self-deactivation is the one refusal the client can be
                        // certain of; the last-admin case still comes back as a 409.
                        disabled={busy === user.id || isSelf}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                      >
                        {busy === user.id ? <Loader2 className="animate-spin" /> : null} Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void setActive(user, true)}
                        disabled={busy === user.id}
                      >
                        {busy === user.id ? <Loader2 className="animate-spin" /> : null} Activate
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {total === 0 ? 'No users' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              disabled={!hasPrev || loading}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              disabled={!hasNext || loading}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
