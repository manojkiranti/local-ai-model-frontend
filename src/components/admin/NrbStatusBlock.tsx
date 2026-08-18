import { splitBlock, type CountEntry } from '@/lib/nrb-format'

function StatList({ entries }: { entries: CountEntry[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map((entry) => (
        <div key={entry.key} className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground" title={entry.label}>
            {entry.label}
          </dt>
          <dd className="font-mono text-sm font-semibold tabular-nums">{entry.value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface NrbStatusBlockProps {
  /** Accessible name and heading for the block. */
  title: string
  block: Record<string, unknown> | null | undefined
  description?: string
}

/**
 * One status block, rendered from whatever keys the gateway returned rather than
 * a fixed field list — a stage may add a counter without a schema change.
 * Nested maps (`rag.documents`, `rag.jobs`) become their own labelled groups
 * instead of being flattened into the scalars beside them.
 */
export function NrbStatusBlock({ title, block, description }: NrbStatusBlockProps) {
  const { entries, groups } = splitBlock(block)
  const empty = entries.length === 0 && groups.length === 0

  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
      {empty ? (
        <p className="mt-3 text-sm text-muted-foreground">No counts reported.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {entries.length > 0 && <StatList entries={entries} />}
          {groups.map((group) => (
            <div
              key={group.key}
              role="group"
              aria-label={group.label}
              className="rounded-lg border border-dashed p-3"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <StatList entries={group.entries} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
