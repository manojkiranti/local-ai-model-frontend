import { useCallback, useEffect, useState } from 'react'
import { describeError, listDepartments, type Department } from '@/lib/api'

/** The authenticated user's available RAG scopes (all scopes for an admin). */
export function useDepartments() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDepartments(await listDepartments())
    } catch (err) {
      setError(describeError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the authenticated user's scopes on mount
    void reload()
  }, [reload])

  // No `roleFor(code)` helper here on purpose: both consumers already hold the
  // whole department row (`AdminRagPage` selects one from its prop; `Workspace`
  // asks an any-department question), so a lookup would ship unused. The level
  // is read straight off `Department.role` and ranked by `atLeast`.
  return { departments, loading, error, reload }
}
