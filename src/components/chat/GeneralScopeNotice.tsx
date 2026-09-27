import { useMemo, useState } from 'react'
import { Building2, Info } from 'lucide-react'

import type { Department } from '@/lib/api'
import { readRecentDepartments, rememberDepartment } from '@/lib/department-recents'
import { rankedDepartments } from '@/lib/department-scopes'

type Props = {
  departments: Department[]
  /** The open General chat has turns, so a switch leaves it for a new one. */
  hasMessages: boolean
  onChoose: (code: string | null) => void
}

/** Enough to cover the departments a user works in without restating the bar. */
const MAX_SWITCHES = 3

/**
 * Standing notice for a General chat. Staff asked department questions here and
 * got refusals or answers from the model's memory, because nothing on screen
 * said General searches no documents. So it is said plainly, next to where the
 * question is typed, with the likeliest departments one click away.
 *
 * Someone who holds no department gets the sentence alone: there is nowhere to
 * send them, and General is the right place for everything else.
 */
export function GeneralScopeNotice({ departments, hasMessages, onChoose }: Props) {
  // Read once on mount, like the bar's overflow list, so the buttons do not
  // reorder under the pointer.
  const [recents] = useState(readRecentDepartments)
  const switches = useMemo(
    () => rankedDepartments(departments, recents).slice(0, MAX_SWITCHES),
    [departments, recents],
  )

  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="font-medium text-foreground">
        General chat doesn't search department documents.
      </span>
      {switches.length > 0 && (
        <span>
          For policies, directives or circulars, ask in a department
          {hasMessages ? ' (starts a new chat)' : ''}:
        </span>
      )}
      {switches.map((option) => (
        <button
          key={option.code}
          type="button"
          onClick={() => {
            // A switch from here is a use, exactly like picking the bar's chip.
            rememberDepartment(option.code)
            onChoose(option.code)
          }}
          aria-label={hasMessages ? `Start a new chat in ${option.label}` : undefined}
          title={`${option.label} (${option.hint})`}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border bg-card px-2 font-medium text-foreground transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Building2 className="size-3" aria-hidden />
          <span className="max-w-40 truncate">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
