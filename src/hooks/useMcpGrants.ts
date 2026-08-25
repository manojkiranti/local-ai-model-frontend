import { useCallback, useEffect, useRef, useState } from 'react'
import {
  gatewayDetail,
  grantMcpGrant,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
  type McpGrantKey,
} from '@/lib/api'

/**
 * The MCP grants held by ONE user, for the admin screen.
 *
 * Writes are serialised — one in flight at a time. That is a correctness
 * requirement, not a nicety: every POST returns the WHOLE list, so two
 * concurrent writes can resolve out of order and the loser's list silently
 * overwrites the winner's.
 *
 * State changes only after the server has confirmed. Nothing is applied
 * optimistically, so a failed write needs no rollback.
 */
export function useMcpGrants(userId: number) {
  const [items, setItems] = useState<McpGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // Intentional: the flag flips before the request, and the rest of the state
    // is written after it resolves — not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    listMcpGrants(userId, controller.signal)
      .then((list) => {
        setItems(list.items)
        setError(null)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setItems([])
        setError(gatewayDetail(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [userId])

  const start = useCallback((key: string): boolean => {
    if (busyRef.current !== null) return false
    busyRef.current = key
    setBusy(key)
    setError(null)
    return true
  }, [])

  const finish = useCallback(() => {
    busyRef.current = null
    setBusy(null)
  }, [])

  const grant = useCallback(
    async (key: McpGrantKey) => {
      if (!start(key)) return
      try {
        // The response is the user's full list AFTER the change, and its
        // `granted_at` is the ORIGINAL insert time on a re-grant. Take it as-is.
        const list = await grantMcpGrant(userId, key)
        setItems(list.items)
      } catch (cause) {
        setError(gatewayDetail(cause))
      } finally {
        finish()
      }
    },
    [finish, start, userId],
  )

  const revoke = useCallback(
    async (key: string) => {
      if (!start(key)) return
      try {
        await revokeMcpGrant(userId, key)
        // 204 arrives whether or not a row existed, so this says nothing about
        // whether the user previously held it — it only reflects our own list.
        setItems((current) => current.filter((item) => item.grant_key !== key))
      } catch (cause) {
        setError(gatewayDetail(cause))
      } finally {
        finish()
      }
    },
    [finish, start, userId],
  )

  return { items, loading, error, busy, grant, revoke }
}
