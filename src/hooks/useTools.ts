import { useCallback, useEffect, useState } from 'react'
import { listTools, type ToolsResponse } from '@/lib/agent-api'
import { describeError } from '@/lib/api'

/** Fetch the tools the gateway exposes for the agent (once, on demand). */
export function useTools(enabled = true) {
  const [tools, setTools] = useState<ToolsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTools(await listTools())
      setError(null)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional: fetch the tool list once on mount / when enabled.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) refresh()
  }, [enabled, refresh])

  return { tools, loading, error, refresh }
}
