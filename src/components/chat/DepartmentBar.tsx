import { useMemo, useState } from 'react'
import { Building2, ChevronDown, Globe2, Loader2 } from 'lucide-react'

import type { Department } from '@/lib/api'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { readRecentDepartments, rememberDepartment } from '@/lib/department-recents'
import { scopeOptions, type ScopeOption } from '@/lib/department-scopes'
import { cn } from '@/lib/utils'
import { DepartmentScopeList } from './DepartmentScopeList'

type Props = {
  departments: Department[]
  loading: boolean
  error: string | null
  /** Active scope: a department code, or `null` for general chat. */
  value: string | null
  onChange: (code: string | null) => void
}

/**
 * Department chip slots beside General. Anything past this goes into the overflow
 * list; a tenant with one extra department is fully chipped instead, since hiding
 * a single item behind "+1 more" costs a click and saves no space worth having.
 */
const MAX_CHIPS = 4

/**
 * The chat's RAG scope: one click for the handful of departments a user works in,
 * a searchable overflow list for the rest.
 *
 * Chips are picked by priority — active scope, then recently used, then
 * alphabetical — but *displayed* alphabetically so they keep their positions as
 * the selection moves. The active scope is always chipped, so the control can
 * never scroll or hide the department the next answer will be grounded in.
 */
export function DepartmentBar({ departments, loading, error, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [recentCodes, setRecentCodes] = useState(readRecentDepartments)

  const options = useMemo(() => scopeOptions(departments), [departments])

  // A scope the list has not caught up with (still loading, or newly disabled)
  // is shown by code rather than silently reported as General.
  const unknown = useMemo<ScopeOption[]>(
    () =>
      value && !options.some((option) => option.code === value)
        ? [{ code: value, label: value, hint: value }]
        : [],
    [options, value],
  )

  const chips = useMemo<ScopeOption[]>(() => {
    if (options.length <= MAX_CHIPS + 1) return options
    const priority: ScopeOption[] = []
    const take = (option: ScopeOption | undefined) => {
      if (option && priority.length < MAX_CHIPS && !priority.includes(option)) priority.push(option)
    }
    take(options.find((option) => option.code === value))
    for (const code of recentCodes) take(options.find((option) => option.code === code))
    for (const option of options) take(option)
    return [...priority].sort((a, b) => a.label.localeCompare(b.label))
  }, [options, recentCodes, value])

  const hidden = options.length - chips.length

  const pick = (code: string | null) => {
    setOpen(false)
    // Re-selecting the active scope would throw away the open conversation.
    if (code === value) return
    rememberDepartment(code)
    setRecentCodes(readRecentDepartments())
    onChange(code)
  }

  const chipClass = (selected: boolean) =>
    cn(
      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
      selected
        ? 'bg-card text-foreground shadow-sm'
        : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
    )

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-xl border bg-muted/40 p-1">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => pick(null)}
        title="General chat — no documents searched"
        className={chipClass(value === null)}
      >
        <Globe2 className={cn('size-3.5', value === null && 'text-primary')} />
        General
      </button>

      {[...unknown, ...chips].map((option) => {
        const selected = option.code === value
        return (
          <button
            key={option.code}
            type="button"
            aria-pressed={selected}
            onClick={() => pick(option.code)}
            title={`${option.label} (${option.hint})`}
            className={chipClass(selected)}
          >
            <Building2 className={cn('size-3.5', selected && 'text-primary')} />
            <span className="max-w-40 truncate">{option.label}</span>
          </button>
        )
      })}

      {hidden > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-haspopup="listbox"
            className={cn(chipClass(false), 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            +{hidden} more
            <ChevronDown className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <DepartmentScopeList
              departments={departments}
              loading={loading}
              error={error}
              value={value}
              onSelect={pick}
              onDismiss={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      )}

      {loading && (
        <span role="status" aria-label="Loading departments" className="mx-1 shrink-0">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </span>
      )}

      {error && (
        <span className="mx-1 shrink-0 text-xs text-destructive" title={error}>
          Departments unavailable
        </span>
      )}
    </div>
  )
}
