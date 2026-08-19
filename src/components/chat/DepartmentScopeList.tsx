import { useMemo, useState } from 'react'
import { Building2, Check, Globe2, Loader2, Search } from 'lucide-react'

import type { Department } from '@/lib/api'
import { readRecentDepartments } from '@/lib/department-recents'
import {
  GENERAL_SCOPE,
  scopeMatches,
  scopeOptions,
  type ScopeOption,
} from '@/lib/department-scopes'
import { cn } from '@/lib/utils'

type Props = {
  departments: Department[]
  loading: boolean
  error: string | null
  /** Active scope: a department code, or `null` for general chat. */
  value: string | null
  /** Reports the chosen scope. The owner decides what a re-pick means. */
  onSelect: (code: string | null) => void
  /** Escape pressed inside the list. */
  onDismiss: () => void
}

type Group = { label: string | null; options: ScopeOption[] }

const LISTBOX_ID = 'department-scope-listbox'
const optionId = (index: number) => `department-scope-option-${index}`

/**
 * Searchable department list: the overflow half of the scope control. Filters on
 * name *and* code, because departments are not uniquely named, and keeps the last
 * few used scopes in reach.
 */
export function DepartmentScopeList({
  departments,
  loading,
  error,
  value,
  onSelect,
  onDismiss,
}: Props) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  // Read once on mount (the list mounts when the popover opens) so the order does
  // not shuffle under the cursor after a selection.
  const [recentCodes] = useState(readRecentDepartments)

  const options = useMemo(() => scopeOptions(departments), [departments])

  const groups = useMemo<Group[]>(() => {
    const needle = query.trim().toLowerCase()
    if (needle) {
      const hits = [GENERAL_SCOPE, ...options].filter((option) => scopeMatches(option, needle))
      return hits.length ? [{ label: null, options: hits }] : []
    }
    const recent = recentCodes
      .map((code) => options.find((option) => option.code === code))
      .filter((option): option is ScopeOption => Boolean(option))
    return [
      { label: null, options: [GENERAL_SCOPE] },
      ...(recent.length ? [{ label: 'Recent', options: recent }] : []),
      { label: recent.length ? 'All departments' : null, options },
    ]
  }, [options, query, recentCodes])

  const flat = groups.flatMap((group) => group.options)

  const move = (delta: number) => {
    if (!flat.length) return
    const next = Math.min(Math.max(highlight + delta, 0), flat.length - 1)
    setHighlight(next)
    document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = flat[highlight]
      if (option) onSelect(option.code)
      return
    }
    if (event.key === 'Escape') onDismiss()
  }

  let index = -1

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search departments"
          aria-controls={LISTBOX_ID}
          aria-activedescendant={flat.length ? optionId(highlight) : undefined}
          placeholder="Search departments…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <div
        id={LISTBOX_ID}
        role="listbox"
        aria-label="Chat scope"
        className="max-h-72 overflow-y-auto p-1"
      >
        {groups.map((group) => (
          <div key={group.label ?? 'primary'} role="group" aria-label={group.label ?? undefined}>
            {group.label && (
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
            )}
            {group.options.map((option) => {
              index += 1
              const current = index
              const selected = option.code === value
              return (
                <div
                  key={option.code ?? 'general'}
                  id={optionId(current)}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(option.code)}
                  onMouseMove={() => setHighlight(current)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    current === highlight && 'bg-muted',
                  )}
                >
                  {option.code === null ? (
                    <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{option.hint}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                </div>
              )
            })}
          </div>
        ))}

        {!flat.length && (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No department matches “{query.trim()}”
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading departments…
          </div>
        )}

        {error && <div className="px-2 py-2 text-xs text-destructive">{error}</div>}
      </div>
    </>
  )
}
