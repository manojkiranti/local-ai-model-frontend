import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ToolAccessGroup, ToolAccessList } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface ToolAccessPanelProps {
  list: ToolAccessList | null
  loading: boolean
  error: string | null
  /** The group whose change is in flight, if any. */
  busy: string | null
  onSetGroupAllowed: (groupId: string, allowed: boolean) => void
  onResetGroup: (groupId: string) => void
  /** Turns an admin id into a readable name for the audit line. */
  resolveAdmin: (id: number | null) => string | null
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const onOff = (value: boolean | null) => (value === null ? 'mixed' : value ? 'on' : 'off')

/** A checkbox that can also show "some" (a mixed group) — `indeterminate` is DOM-only. */
function GroupCheckbox({
  id,
  allowed,
  disabled,
  onChange,
}: {
  id: string
  allowed: boolean | null
  disabled: boolean
  onChange: (allowed: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = allowed === null
  }, [allowed])
  return (
    <input
      ref={ref}
      type="checkbox"
      id={id}
      checked={allowed === true}
      // A mixed group turns fully on with one click.
      onChange={() => onChange(allowed !== true)}
      disabled={disabled}
      aria-checked={allowed === null ? 'mixed' : allowed}
      className="mt-0.5 size-4 shrink-0 accent-primary"
    />
  )
}

/**
 * Which built-in tool groups one user may use. Every user starts from the
 * gateway's starter set; an admin switches a whole group on or off for this
 * user, and "Reset" returns it to the default. Groups, their tools, defaults and
 * states all come from the gateway — nothing here decides access, and the
 * gateway enforces it on every chat turn.
 */
export function ToolAccessPanel({
  list,
  loading,
  error,
  busy,
  onSetGroupAllowed,
  onResetGroup,
  resolveAdmin,
}: ToolAccessPanelProps) {
  const writing = busy !== null
  const groups = list?.groups ?? []
  const allowedCount = groups.filter((g) => g.allowed === true).length

  function row(group: ToolAccessGroup) {
    const id = `tool-group-${group.id}`
    const changed = group.state !== 'default'
    const admin = resolveAdmin(group.updated_by)
    return (
      <div
        key={group.id}
        data-testid={`tool-group-${group.id}`}
        className={cn(
          'flex items-start gap-3 rounded-lg border px-3 py-3',
          group.allowed === false ? 'bg-muted/40' : 'bg-card',
        )}
      >
        <GroupCheckbox
          id={id}
          allowed={group.allowed}
          disabled={writing}
          onChange={(allowed) => onSetGroupAllowed(group.id, allowed)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium">
              {group.label}
            </label>
            {changed ? (
              <Badge variant="outline" className="border-primary/40 capitalize text-primary">
                {group.state}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Default · {onOff(group.default_allowed)}
              </Badge>
            )}
            {busy === group.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {group.tools.join(' · ')}
          </p>
          {changed && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {group.updated_at && `Changed ${formatWhen(group.updated_at)}`}
              {group.updated_by !== null && ` · by ${admin ?? `admin #${group.updated_by}`}`}
              {` · default is ${onOff(group.default_allowed)}`}
            </p>
          )}
        </div>
        {changed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={writing}
            onClick={() => onResetGroup(group.id)}
            aria-label={`Reset ${group.label} to default`}
          >
            <RotateCcw /> Reset
          </Button>
        )}
      </div>
    )
  }

  return (
    <section className="mb-5 rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2.5 border-b pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Wrench className="size-4" />
        </span>
        <h2 className="flex-1 text-base font-semibold">Built-in tools</h2>
        {list && (
          <span className="text-xs text-muted-foreground">
            {allowedCount} of {groups.length} groups allowed
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading tools…
        </div>
      ) : (
        <div className="space-y-2">{groups.map(row)}</div>
      )}

      <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
        Every user starts with the default set. A change here applies to this user only, from their
        next message. HRMS, iZone and EMS tools are controlled in the MCP tools section below.
      </p>
    </section>
  )
}
