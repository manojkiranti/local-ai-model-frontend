import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpGrant, McpGrantKey } from '@/lib/api'
import {
  formatGrantedAt,
  grantFor,
  holds,
  MCP_SYSTEMS,
  orphanedPermissions,
  requiredRoleFor,
  unknownGrants,
  type McpGrantCopy,
} from '@/lib/mcp-grants'

export interface McpGrantsPanelProps {
  items: McpGrant[]
  loading: boolean
  error: string | null
  /** The key currently being written, or null. Disables every control. */
  busy: string | null
  onGrant: (key: McpGrantKey) => void
  onRevoke: (key: string) => void
  /** granted_by -> email, or null when it cannot be resolved. */
  resolveGranter: (id: number | null) => string | null
  /** The signed-in admin is looking at their own row. */
  isSelf: boolean
}

/**
 * Which MCP grants one user holds.
 *
 * This screen renders GRANTS, never tools: the MCP server decides what a grant
 * unlocks, and there is no way to ask it about anybody but the caller. The
 * descriptions are copy for a human, not a contract.
 */
export function McpGrantsPanel({
  items,
  loading,
  error,
  busy,
  onGrant,
  onRevoke,
  resolveGranter,
  isSelf,
}: McpGrantsPanelProps) {
  const orphans = orphanedPermissions(items)
  const unknown = unknownGrants(items)
  const writing = busy !== null

  function row(copy: McpGrantCopy, nested: boolean) {
    const held = holds(items, copy.key)
    const record = grantFor(items, copy.key)
    const missingRole = orphans.includes(copy.key) ? requiredRoleFor(copy.key) : null
    const granter = record ? resolveGranter(record.granted_by) : null

    return (
      <div
        key={copy.key}
        className={cn(
          'rounded-lg border px-3 py-2.5',
          nested && 'ml-6',
          copy.sharp ? 'border-amber-500/40 bg-amber-500/5' : 'bg-card',
        )}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id={`grant-${copy.key}`}
            checked={held}
            disabled={writing}
            onChange={(event) =>
              event.target.checked ? onGrant(copy.key) : onRevoke(copy.key)
            }
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`grant-${copy.key}`} className="text-sm font-medium">
                {copy.label}
              </label>
              {copy.sharp && (
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              )}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {copy.key}
              </code>
              {busy === copy.key && (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>

            {missingRole && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                <p className="min-w-0 flex-1 text-xs">
                  No effect on its own — without{' '}
                  <code className="font-mono">{missingRole}</code> this user cannot use it,
                  or discover anything through it.
                </p>
                {/* An explicit second POST, so both audit rows exist and neither
                    grant is implied by the other. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={writing}
                  onClick={() => onGrant(missingRole)}
                >
                  Also grant {missingRole}
                </Button>
              </div>
            )}

            {record && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Granted {formatGrantedAt(record.granted_at)}
                {record.granted_by !== null &&
                  ` · by ${granter ?? `admin #${record.granted_by}`}`}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2.5 border-b pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-4" />
        </span>
        <h2 className="text-base font-semibold">Tool access</h2>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0">{error}</p>
        </div>
      )}

      {/* Rule 1: gateway admin is an IT/ops role and confers no tool access. The
          controls stay live — an admin grants themselves explicitly, and that is
          what leaves the audit row. */}
      {isSelf && items.length === 0 && (
        <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Global admin does not confer tool access. Grant yourself explicitly — it writes an
          audit row.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading grants…
        </div>
      ) : (
        <div className="space-y-5">
          {MCP_SYSTEMS.map((system) => (
            <div key={system.id} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {system.name}
              </h3>
              {row(system.role, false)}
              {system.permissions.map((permission) => row(permission, true))}
            </div>
          ))}

          {unknown.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Other grants
              </h3>
              {unknown.map((item) => (
                <div
                  key={item.grant_key}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <code className="font-mono text-xs">{item.grant_key}</code>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This build does not recognise this grant. It is left here so it stays
                      revocable.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={writing}
                    onClick={() => onRevoke(item.grant_key)}
                  >
                    Revoke {item.grant_key}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
        This lists grants, not tools. Which tools a grant unlocks is decided by the MCP
        server.
      </p>
    </section>
  )
}
