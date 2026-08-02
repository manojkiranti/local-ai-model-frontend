import { useCallback, useEffect, useState } from 'react'
import { describeError, listModels, type ModelInfo } from '@/lib/api'

/** Fetch the list of models installed on the Ollama server. */
export function useModels(enabled = true) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setModels(await listModels())
      setError(null)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Intentional: fetch the model list once on mount / when enabled.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) refresh()
  }, [enabled, refresh])

  return { models, loading, error, refresh }
}
