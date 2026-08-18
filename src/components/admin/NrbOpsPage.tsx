import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Layers,
  Play,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NrbStatusBlock } from '@/components/admin/NrbStatusBlock'
import { useNrbOps } from '@/hooks/useNrbOps'
import {
  EMPTY_SCOPE_FORM,
  scopeFormIssue,
  splitBlock,
  statusLabel,
  statusNote,
  type ScopeForm,
  type TriggerKind,
} from '@/lib/nrb-format'
import { cn } from '@/lib/utils'
import type { Department, NrbRun } from '@/lib/api'

/**
 * How each status looks. Colour is never the only signal: the word is always
 * printed, the section carries `data-nrb-status`, and `running` (pipeline runner)
 * is deliberately styled unlike `awaiting_jobs` (RAG worker) because they wait on
 * different processes.
 */
const STATUS_STYLE: Record<string, { badge: string; icon: typeof Clock }> = {
  queued: { badge: 'border-input bg-muted text-muted-foreground', icon: Clock },
  running: { badge: 'border-primary/30 bg-primary/10 text-primary', icon: Loader2 },
  awaiting_jobs: {
    badge: 'border-dashed border-foreground/30 bg-foreground/5 text-foreground',
    icon: Layers,
  },
  succeeded: {
    badge: 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400',
    icon: CheckCircle2,
  },
  partial: {
    badge: 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400',
    icon: AlertTriangle,
  },
  failed: {
    badge: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: XCircle,
  },
}

function timestamp(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  )
}

function RunFacts({ run }: { run: NrbRun }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      <Fact label="Run" value={String(run.id)} />
      <Fact label="Trigger" value={run.trigger} />
      <Fact label="Requested by" value={run.requested_by ?? '—'} />
      <Fact label="Stage" value={run.stage} />
      <Fact label="Department" value={run.department ?? '—'} />
      <Fact label="Created" value={timestamp(run.created_at)} />
      <Fact label="Started" value={timestamp(run.started_at)} />
      <Fact label="Finished" value={timestamp(run.finished_at)} />
    </dl>
  )
}

function RunCounters({ label, block }: { label: string; block: Record<string, unknown> }) {
  const { entries, groups } = splitBlock(block)
  if (!entries.length && !groups.length) return null
  return (
    <div role="group" aria-label={label} className="mt-3 rounded-lg border border-dashed p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {entries.map((entry) => (
          <div key={entry.key} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground" title={entry.label}>
              {entry.label}
            </dt>
            <dd className="font-mono text-sm font-semibold tabular-nums">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** One run, as the current update or as the last result. */
function RunCard({ run, title }: { run: NrbRun; title: string }) {
  const style = STATUS_STYLE[run.status] ?? {
    badge: 'border-input bg-muted text-muted-foreground',
    icon: Clock,
  }
  const Icon = style.icon
  const note = statusNote(run.status)

  return (
    <section
      aria-label={title}
      data-nrb-status={run.status}
      className="rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span
          data-nrb-status-label
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            style.badge,
          )}
        >
          <Icon className={cn('size-3.5', run.status === 'running' && 'animate-spin')} />
          {statusLabel(run.status)}
        </span>
      </div>
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}

      <RunFacts run={run} />
      <RunCounters label="Counters" block={run.counters} />
      <RunCounters label="Ingest jobs" block={run.jobs} />

      {run.error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      )}
    </section>
  )
}

interface NrbOpsPageProps {
  departments: Department[]
}

/**
 * NRB operations — a thin admin view over `/v1/nrb`. It reads and displays;
 * every lifecycle decision (when a run settles, which statuses are active,
 * supersession) belongs to the gateway.
 */
export function NrbOpsPage({ departments }: NrbOpsPageProps) {
  const ops = useNrbOps()
  const [form, setForm] = useState<ScopeForm>(EMPTY_SCOPE_FORM)

  // A 403 means a signed-in non-admin. Unlike a 401 it does not end the session,
  // so this state must not send anyone back to the login page.
  if (ops.forbidden) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md rounded-xl border bg-card p-6 text-center">
          <ShieldAlert className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">This account is not an administrator.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            NRB operations are restricted to administrators. You are still signed in.
          </p>
        </div>
      </div>
    )
  }

  const setField = (key: keyof ScopeForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const issue = scopeFormIssue(form)
  // An update is refused while one is in progress; the gateway says so via
  // `active_run`, and the buttons simply mirror that.
  const running = ops.activeRun !== null
  const blocked = running || issue !== null || ops.submitting !== null

  const submit = (kind: TriggerKind) => {
    if (blocked) return
    void ops.trigger(kind, form)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit('update')
  }

  const first = ops.loading && ops.status === null && ops.error === null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <RefreshCw className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">NRB updates</h1>
            <p className="text-xs text-muted-foreground">
              Trigger and follow Nepal Rastra Bank corpus updates.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Refresh NRB status"
            onClick={() => void ops.refresh()}
          >
            <RefreshCw className={ops.loading ? 'animate-spin' : undefined} />
          </Button>
        </header>

        {ops.error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {ops.error}
          </p>
        )}

        {ops.conflict && (
          <p
            data-nrb-note="conflict"
            className="rounded-lg border bg-muted px-3 py-2 text-sm"
          >
            {ops.conflict}
          </p>
        )}

        {first ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading NRB status…
          </p>
        ) : (
          <>
            {ops.activeRun ? (
              <RunCard run={ops.activeRun} title="Current update" />
            ) : ops.status?.latest_run ? (
              <RunCard run={ops.status.latest_run} title="Latest update" />
            ) : (
              ops.status && (
                <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                  No NRB update has run yet.
                </p>
              )
            )}

            <form onSubmit={onSubmit} className="rounded-xl border bg-card p-4">
              {/*
                Left enabled while a run is in progress: an operator can prepare
                the next scope while waiting. Only the ACTIONS are disabled.
              */}
              <fieldset className="min-w-0">
                <legend className="text-sm font-semibold">Scope</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The gateway rejects an unbounded request, and a full-corpus run is
                  not available here. Set at least one bound so the result means a
                  known slice of the corpus.
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-department">Department</Label>
                    <select
                      id="nrb-department"
                      value={form.department}
                      onChange={(event) => setField('department')(event.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                    >
                      <option value="">Select a department…</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.code}>
                          {department.name} ({department.code})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Required — the rag stage ingests into it.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-limit">Limit</Label>
                    <Input
                      id="nrb-limit"
                      inputMode="numeric"
                      value={form.limit}
                      onChange={(event) => setField('limit')(event.target.value)}
                      placeholder="e.g. 25 (max 5000)"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-years">Years</Label>
                    <Input
                      id="nrb-years"
                      value={form.years}
                      onChange={(event) => setField('years')(event.target.value)}
                      placeholder="e.g. 2024, 2025"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-sections">Sections</Label>
                    <Input
                      id="nrb-sections"
                      value={form.sections}
                      onChange={(event) => setField('sections')(event.target.value)}
                      placeholder="comma separated"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-owners">Owners</Label>
                    <Input
                      id="nrb-owners"
                      value={form.owners}
                      onChange={(event) => setField('owners')(event.target.value)}
                      placeholder="comma separated"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nrb-extensions">Extensions</Label>
                    <Input
                      id="nrb-extensions"
                      value={form.extensions}
                      onChange={(event) => setField('extensions')(event.target.value)}
                      placeholder="e.g. pdf, xlsx"
                    />
                  </div>
                </div>
              </fieldset>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={blocked}>
                  {ops.submitting === 'update' ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  Update NRB
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => submit('retry')}
                >
                  {ops.submitting === 'retry' ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  Retry failed ingest
                </Button>
                <p className="text-xs text-muted-foreground">
                  {running
                    ? 'An update is in progress — both actions resume when it finishes.'
                    : (issue ??
                      'Retry re-runs the rag stage only, for documents that failed in scope.')}
                </p>
              </div>
            </form>

            <div className="grid gap-4 lg:grid-cols-2">
              <NrbStatusBlock
                title="Catalog"
                block={ops.status?.catalog}
                description="Sources, files and relationships known to the catalog."
              />
              <NrbStatusBlock
                title="Files"
                block={ops.status?.files}
                description="Download state of the file catalog."
              />
              <NrbStatusBlock
                title="RAG"
                block={ops.status?.rag}
                description="NRB documents and ingest jobs on the RAG side."
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
