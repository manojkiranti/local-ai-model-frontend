import { useCallback, useEffect, useState } from 'react'
import { describeError, getHealth, type HealthResponse } from '@/lib/api'

/**
 * Poll the gateway's /health endpoint. `reachable` is true only when both the
 * gateway responds and it reports Ollama as reachable.
 */
export function useHealth(intervalMs = 15000) {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const h = await getHealth()
      setHealth(h)
      setError(null)
    } catch (e) {
      setHealth(null)
      setError(describeError(e))
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

  return {
    health,
    reachable: Boolean(health?.ollama.reachable),
    loading,
    error,
    refresh,
  }
}
