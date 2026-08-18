import { useEffect, useState } from 'react'
import { describeError, fetchFile } from '@/lib/api'

/**
 * An object URL for `GET /v1/files/{id}`, fetched WITH the bearer header.
 *
 * `<img src="/v1/files/{id}">` cannot work: the route is authenticated and an
 * <img> tag sends no Authorization header, so it 401s and renders broken. Fetch,
 * blob, object URL — and revoke it when the id changes or the component unmounts.
 * Pass null/undefined to load nothing.
 *
 * State is stamped with the id it belongs to and read back by comparison, so a
 * changed id reports "loading" without a synchronous reset inside the effect.
 */
export function useAuthedImageUrl(fileId: string | null | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null)

  useEffect(() => {
    if (!fileId) return

    let cancelled = false
    let createdUrl: string | null = null

    void (async () => {
      try {
        const res = await fetchFile(fileId)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        createdUrl = objectUrl
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setLoaded({ id: fileId, url: objectUrl })
      } catch (e) {
        // A 401 is already handled globally (token cleared → redirect to login).
        if (!cancelled) setFailed({ id: fileId, error: describeError(e) })
      }
    })()

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [fileId])

  return {
    url: fileId && loaded?.id === fileId ? loaded.url : null,
    error: fileId && failed?.id === fileId ? failed.error : null,
  }
}
