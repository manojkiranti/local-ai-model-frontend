import { useCallback, useState } from 'react'

import type { Department } from '@/lib/api'
import { readRecentDepartments } from '@/lib/department-recents'
import { launchDepartment } from '@/lib/department-scopes'

type Options = {
  departments: Department[]
  loading: boolean
  /** True while a server session is open (the thread has an id). */
  sessionOpen: boolean
}

/**
 * The chat's RAG scope: a department code, `null` for General, or `undefined`
 * when it is not known.
 *
 * Until the user acts, the scope is DERIVED: unknown while the departments load,
 * then the launch department. The first choice — a chip, a reopened chat, or a
 * first turn sent — pins it, so a list that lands or reloads later can never
 * relabel a chat that already exists.
 *
 * A pinned `undefined` is a reopened chat whose department the gateway did not
 * say. That describes the open chat, not a tab, so with no chat open the scope
 * falls back to the launch department instead of staying unknown.
 */
export function useChatScope({ departments, loading, sessionOpen }: Options) {
  // Read once: a chip picked later rewrites the recents, and the launch choice
  // must not move under a user who has not acted yet.
  const [recents] = useState(readRecentDepartments)
  const [pinned, setPinned] = useState<{ code: string | null | undefined } | null>(null)

  const launch = loading ? undefined : launchDepartment(departments, recents)
  const scope =
    pinned && (pinned.code !== undefined || sessionOpen) ? pinned.code : launch

  const pin = useCallback((code: string | null | undefined) => setPinned({ code }), [])

  return { scope, pin }
}
