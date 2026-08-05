import { useCallback, useEffect, useState } from 'react'
import { describeError, listFiles, type FileSource, type GatewayFile } from '@/lib/api'

/**
 * Load the current user's generated files (`GET /v1/files`). The list is
 * owner-scoped and newest-first server-side, so this just fetches once on mount
 * and exposes a `reload` for the error-state Retry. A 401 is handled globally by
 * the client (→ login); other failures surface as `error`. `removeFile` drops a
 * row locally when a download 404s ("not yours or gone").
 */
export function useFiles(source?: FileSource) {
  const [files, setFiles] = useState<GatewayFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFiles(await listFiles(source))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => (prev ? prev.filter((f) => f.id !== id) : prev))
  }, [])

  return { files, loading, error, reload: load, removeFile }
}
