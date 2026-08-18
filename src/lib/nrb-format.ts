/**
 * Pure presentation and request-shaping helpers for the NRB operations screen.
 *
 * Deliberately contains NO pipeline lifecycle logic. It does not decide which
 * statuses are "active", when a run settles, or whether one run supersedes
 * another — the gateway owns all of that, and the screen reads
 * `status.active_run` rather than inferring it from a status string.
 *
 * What lives here is only: the exact operator wording for a status, generic
 * rendering of a counter block whose keys are not known ahead of time, and
 * turning the scope form into a `RunTriggerIn` body.
 */
import { formatBytes } from '@/lib/file-format'
import type { NrbRunTrigger } from '@/lib/api'

/** The four staging stages, in the pipeline's own order (`pipeline.STAGES`). */
export const NRB_STAGES = ['sync', 'fetch', 'extract', 'rag'] as const

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Updating',
  awaiting_jobs: 'Indexing',
  succeeded: 'Succeeded',
  partial: 'Completed with failures',
  failed: 'Failed',
}

/**
 * Operator-facing label for a run status. An unknown status renders as itself:
 * a status the backend adds later must never be shown under a wrong label.
 */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/**
 * What the run is waiting on, or null when it is terminal.
 *
 * `queued` says only that nobody has claimed the run yet. The gateway does not
 * expose whether the runner process is alive (`heartbeat_at` is not serialised),
 * so a queued run that sits still is indistinguishable from one about to be
 * claimed, and this text stops short of claiming runner health.
 */
export function statusNote(status: string): string | null {
  if (status === 'queued') return 'Waiting for the NRB pipeline runner to claim it'
  if (status === 'running') return 'The NRB pipeline runner is staging files'
  if (status === 'awaiting_jobs') {
    return 'Staging finished; the RAG worker is still indexing'
  }
  return null
}

function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Render one counter value. A `bytes`-named key is a raw byte sum, so it is
 * formatted as a size — printed as a bare number it reads as a nonsense count
 * beside the file totals.
 */
export function formatCountValue(key: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return key.includes('bytes') ? formatBytes(value) : groupDigits(value)
  }
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** `active_sources` → `Active sources`. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface CountEntry {
  key: string
  label: string
  value: string
}

export interface CountGroup {
  key: string
  label: string
  entries: CountEntry[]
}

export interface SplitBlock {
  entries: CountEntry[]
  groups: CountGroup[]
}

function toEntry(key: string, value: unknown): CountEntry {
  return { key, label: humanizeKey(key), value: formatCountValue(key, value) }
}

function isNestedMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Split a status block into scalar entries and nested groups, iterating whatever
 * keys the gateway actually returned — never a fixed field list, because a stage
 * may add a counter key without a schema change.
 *
 * Key order is the gateway's own; nothing is sorted or renamed away.
 */
export function splitBlock(block: Record<string, unknown> | null | undefined): SplitBlock {
  const entries: CountEntry[] = []
  const groups: CountGroup[] = []
  for (const [key, value] of Object.entries(block ?? {})) {
    if (isNestedMap(value)) {
      groups.push({
        key,
        label: humanizeKey(key),
        entries: Object.entries(value).map(([k, v]) => toEntry(k, v)),
      })
    } else {
      entries.push(toEntry(key, value))
    }
  }
  return { entries, groups }
}

// --------------------------------------------------------------------------- //
// The scope form → RunTriggerIn
// --------------------------------------------------------------------------- //
/**
 * The bounds an admin may set. A subset of `RunTriggerIn`, and `all_files` is
 * not among them: a full-corpus run is deliberately unavailable over HTTP, so
 * it must be unexpressible here rather than merely unsent.
 */
export interface ScopeForm {
  department: string
  limit: string
  years: string
  sections: string
  owners: string
  extensions: string
}

export const EMPTY_SCOPE_FORM: ScopeForm = {
  department: '',
  limit: '',
  years: '',
  sections: '',
  owners: '',
  extensions: '',
}

/** Split a comma- or newline-separated field into trimmed, non-empty values. */
export function parseList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseYears(raw: string): number[] {
  return parseList(raw)
    .map((item) => (/^\d+$/.test(item) ? Number(item) : NaN))
    .filter((year) => Number.isInteger(year))
}

/** An integer within the gateway's `1..5000`, or undefined if unusable. */
export function parseLimit(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return value >= 1 && value <= 5000 ? value : undefined
}

/**
 * Is at least one real bound set? Checked against PARSED values, so text that
 * cannot become a bound (`limit: "abc"`) does not enable a submit the gateway
 * would reject with a 422. The department is not a bound — it says where the rag
 * stage ingests, not which slice of the corpus to run.
 */
export function hasBound(form: ScopeForm): boolean {
  return (
    parseLimit(form.limit) !== undefined ||
    parseYears(form.years).length > 0 ||
    parseList(form.sections).length > 0 ||
    parseList(form.owners).length > 0 ||
    parseList(form.extensions).length > 0
  )
}

/** Why the form cannot be submitted yet, or null when it can. */
export function scopeFormIssue(form: ScopeForm): string | null {
  if (!form.department.trim()) {
    return 'Choose a department — the rag stage ingests into it.'
  }
  if (!hasBound(form)) {
    return 'Set at least one bound: limit, years, sections, owners or extensions.'
  }
  return null
}

export type TriggerKind = 'update' | 'retry'

/**
 * Build the POST body.
 *
 * `update` runs the four staging stages with `retry_failed:false`. `retry` runs
 * `rag` ONLY with `retry_failed:true`: the bytes are already downloaded, so
 * re-running sync and fetch to fix a parse failure is wasted work. Blank bounds
 * are omitted rather than sent as empty lists.
 */
export function buildTriggerRequest(form: ScopeForm, kind: TriggerKind): NrbRunTrigger {
  const body: NrbRunTrigger = {
    department: form.department.trim(),
    stages: kind === 'retry' ? ['rag'] : [...NRB_STAGES],
    retry_failed: kind === 'retry',
  }
  const limit = parseLimit(form.limit)
  if (limit !== undefined) body.limit = limit
  const years = parseYears(form.years)
  if (years.length) body.years = years
  const sections = parseList(form.sections)
  if (sections.length) body.sections = sections
  const owners = parseList(form.owners)
  if (owners.length) body.owners = owners
  const extensions = parseList(form.extensions)
  if (extensions.length) body.extensions = extensions
  return body
}
