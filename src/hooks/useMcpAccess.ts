import { useCallback, useEffect, useRef, useState } from 'react'
import {
  gatewayDetail,
  getMcpAccess,
  resetMcpLevel,
  resetMcpToolAccess,
  setMcpLevel,
  setMcpToolAccess,
  type McpAccessList,
  type McpLevel,
} from '@/lib/api'

/**
 * One user's MCP tool access, for the admin screen. Same discipline as
 * `useToolAccess`: one write in flight at a time (every write returns the
 * WHOLE list, so out-of-order resolution would let an older list win), and
 * state changes only after the gateway confirms.
 */
export function useMcpAccess(userId: number) {
  const [list, setList] = useState<McpAccessList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flag flips before the request
    setLoading(true)
    getMcpAccess(userId, controller.signal)
      .then((next) => {
        setList(next)
        setError(null)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setList(null)
        setError(gatewayDetail(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [userId])

  const run = useCallback(async (key: string, write: () => Promise<McpAccessList>) => {
    if (busyRef.current !== null) return
    busyRef.current = key
    setBusy(key)
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

  const setLevel = useCallback(
    (system: string, level: McpLevel) => run(`system:${system}`, () => setMcpLevel(userId, system, level)),
    [run, userId],
  )
  const resetLevel = useCallback(
    (system: string) => run(`system:${system}`, () => resetMcpLevel(userId, system)),
    [run, userId],
  )
  const setToolAllowed = useCallback(
    (tool: string, allowed: boolean) => run(`tool:${tool}`, () => setMcpToolAccess(userId, tool, allowed)),
    [run, userId],
  )
  const resetTool = useCallback(
    (tool: string) => run(`tool:${tool}`, () => resetMcpToolAccess(userId, tool)),
    [run, userId],
  )

  return { list, loading, error, busy, setLevel, resetLevel, setToolAllowed, resetTool }
}
