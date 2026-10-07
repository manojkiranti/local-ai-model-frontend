import { AlertTriangle, ChevronRight, Loader2, Plug, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { McpAccessList, McpLevel, McpSystemAccess, McpToolAccessItem } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface McpAccessPanelProps {
  list: McpAccessList | null
  loading: boolean
  error: string | null
  /** `system:<id>` or `tool:<name>` while that change is in flight. */
  busy: string | null
  onSetLevel: (system: string, level: McpLevel) => void
  onResetLevel: (system: string) => void
  onSetToolAllowed: (tool: string, allowed: boolean) => void
  onResetTool: (tool: string) => void
  /** Turns an admin id into a readable name for the audit line. */
  resolveAdmin: (id: number | null) => string | null
}

const LEVELS: { id: McpLevel; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Hidden — the assistant cannot see these tools' },
  { id: 'read', label: 'Read', hint: 'Look-up tools only' },
  { id: 'full', label: 'Full', hint: 'Look-up and data-changing tools' },
]

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const levelLabel = (level: McpLevel) => LEVELS.find((l) => l.id === level)?.label ?? level

/** "Follow level" / "Allow" / "Block" for one tool — an override beats the level. */
function ToolOverride({
  tool,
  disabled,
  onSet,
  onReset,
}: {
  tool: McpToolAccessItem
  disabled: boolean
  onSet: (allowed: boolean) => void
  onReset: () => void
}) {
  const value = tool.override === null ? 'level' : tool.override ? 'allow' : 'block'
  return (
    <select
      aria-label={`Access to ${tool.name}`}
      value={value}
      disabled={disabled || !tool.server_enabled}
      onChange={(e) => {
        const next = e.target.value
        if (next === 'level') onReset()
        else onSet(next === 'allow')
      }}
      className="h-7 shrink-0 rounded-md border bg-background px-2 text-xs"
    >
      <option value="level">Follow level</option>
      <option value="allow">Allow</option>
      <option value="block">Block</option>
    </select>
  )
}

/**
 * Which HRMS / iZone / EMS tools one user's assistant may use. Each system has
 * a level (None / Read / Full) and any single tool can be allowed or blocked
 * regardless of it. Levels, tools, read/write kinds and every effective answer
 * come from the gateway — nothing here decides access, and the gateway
 * enforces it on every chat turn.
 */
export function McpAccessPanel({
  list,
  loading,
  error,
  busy,
  onSetLevel,
  onResetLevel,
  onSetToolAllowed,
  onResetTool,
  resolveAdmin,
}: McpAccessPanelProps) {
  const writing = busy !== null
  const systems = list?.systems ?? []
  const tools = list?.tools ?? []

  function systemRow(system: McpSystemAccess) {
    const own = tools.filter((t) => t.system === system.id)
    const allowedCount = own.filter((t) => t.allowed).length
    const admin = resolveAdmin(system.updated_by)
    return (
      <div key={system.id} data-testid={`mcp-system-${system.id}`} className="rounded-lg border bg-card px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{system.label}</span>
          {system.overridden ? (
            <Badge variant="outline" className="border-primary/40 text-primary">
              Set for this user
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Default · {levelLabel(system.default_level)}
            </Badge>
          )}
          {busy === `system:${system.id}` && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <span className="flex-1" />
          <div role="group" aria-label={`${system.label} access level`} className="flex overflow-hidden rounded-md border">
            {LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                title={level.hint}
                aria-pressed={system.level === level.id}
                disabled={writing}
                onClick={() => system.level !== level.id && onSetLevel(system.id, level.id)}
                className={cn(
                  'px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                  system.level === level.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
          {system.overridden && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={writing}
              onClick={() => onResetLevel(system.id)}
              aria-label={`Reset ${system.label} to default`}
            >
              <RotateCcw /> Reset
            </Button>
          )}
        </div>
        {system.overridden && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {system.updated_at && `Changed ${formatWhen(system.updated_at)}`}
            {system.updated_by !== null && ` · by ${admin ?? `admin #${system.updated_by}`}`}
            {` · default is ${levelLabel(system.default_level)}`}
          </p>
        )}

        {own.length > 0 && (
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              {allowedCount} of {own.length} tools allowed — set individual tools
            </summary>
            <ul className="mt-2 space-y-1.5">
              {own.map((tool) => (
                <li
                  key={tool.name}
                  data-testid={`mcp-tool-${tool.name}`}
                  className={cn('flex items-center gap-2 rounded-md px-2 py-1.5', tool.allowed ? 'bg-muted/30' : 'bg-muted/60')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px]">{tool.name}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px] capitalize">
                        {tool.kind}
                      </Badge>
                      {!tool.server_enabled ? (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
                          Off server-wide
                        </Badge>
                      ) : (
                        <span className={cn('text-[10px] font-medium', tool.allowed ? 'text-primary' : 'text-muted-foreground')}>
                          {tool.allowed ? 'Allowed' : 'Hidden'}
                          {tool.override !== null && ' (override)'}
                        </span>
                      )}
                      {busy === `tool:${tool.name}` && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                    </div>
                    {tool.summary && <p className="truncate text-[11px] text-muted-foreground">{tool.summary}</p>}
                  </div>
                  <ToolOverride
                    tool={tool}
                    disabled={writing}
                    onSet={(allowed) => onSetToolAllowed(tool.name, allowed)}
                    onReset={() => onResetTool(tool.name)}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    )
  }

  return (
    <section className="mb-5 rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2.5 border-b pb-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Plug className="size-4" />
        </span>
        <h2 className="flex-1 text-base font-semibold">MCP tools</h2>
        {list && <span className="text-xs text-muted-foreground">Server mode: {list.tool_mode}</span>}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0">{error}</p>
        </div>
      )}
      {list && !list.mcp_reachable && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="min-w-0">
            The MCP server is unreachable, so individual tools can't be listed. Levels can still be changed.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading MCP tools…
        </div>
      ) : (
        <div className="space-y-2">{systems.map(systemRow)}</div>
      )}

      <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
        A level decides which of a system's tools this user's assistant can see: None hides them, Read
        allows look-ups, Full also allows tools that change data. A single tool can be allowed or blocked
        regardless of the level. The server-wide mode is a ceiling. Changes apply from the user's next
        message. The MCP grants below are a separate check made by the MCP server itself.
      </p>
    </section>
  )
}
