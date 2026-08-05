import { useCallback, useEffect, useState } from 'react'
import { getMcpStatus, type McpStatus } from '@/lib/api'

/**
 * Poll the gateway's MCP status. Each call is a real probe of the MCP server, so
 * fetch once on mount and again every ~30s to reflect live state. The endpoint
 * always returns 200 (health lives in the body); a 401 is handled globally by
 * the client, and a transient network failure leaves `status` null (unknown).
 */
export function useMcpStatus(intervalMs = 30000) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getMcpStatus())
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional: fetch once on mount, then poll. setState runs after the
    // request resolves, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  return { status, loading, refresh }
}
