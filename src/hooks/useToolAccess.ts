import { useCallback, useEffect, useRef, useState } from 'react'
import {
  gatewayDetail,
  getToolAccess,
  resetToolGroupAccess,
  setToolGroupAccess,
  type ToolAccessList,
} from '@/lib/api'

/**
 * One user's access to the built-in tool groups, for the admin screen.
 *
 * Writes are serialised, one in flight at a time, for the same reason as
 * `useMcpGrants`: every write returns the WHOLE list, so two concurrent writes
 * could resolve out of order and the older list would overwrite the newer.
 * State changes only after the server confirms; nothing is optimistic.
 */
export function useToolAccess(userId: number) {
  const [list, setList] = useState<ToolAccessList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flag flips before the request
    setLoading(true)
    getToolAccess(userId, controller.signal)
      .then((next) => {
        setList(next)
        setError(null)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setList(null)
        // A 403 is a policy refusal from a signed-in caller: shown verbatim.
        setError(gatewayDetail(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [userId])

  const run = useCallback(async (groupId: string, write: () => Promise<ToolAccessList>) => {
    if (busyRef.current !== null) return
    busyRef.current = groupId
    setBusy(groupId)
    setError(null)
    try {
      setList(await write())
    } catch (cause) {
      setError(gatewayDetail(cause))
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [])

  const setGroupAllowed = useCallback(
    (groupId: string, allowed: boolean) =>
      run(groupId, () => setToolGroupAccess(userId, groupId, allowed)),
    [run, userId],
  )

  const resetGroup = useCallback(
    (groupId: string) => run(groupId, () => resetToolGroupAccess(userId, groupId)),
    [run, userId],
  )

  return { list, loading, error, busy, setGroupAllowed, resetGroup }
}
