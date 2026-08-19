import { useCallback, useEffect, useRef, useState } from 'react'
import { GatewayError, describeError, fetchDepartmentDocument, type Source } from '@/lib/api'
import { downloadFilename } from '@/lib/sources'

/**
 * Save a cited department document to disk.
 *
 * The route is behind JWT, so `<a href="/v1/departments/…/download">` cannot
 * work — it sends no Authorization header and 401s. Fetch it with the bearer
 * header, turn the body into a blob URL, click a throwaway anchor, and revoke
 * the URL once the browser has had time to read it (revoking in the same tick
 * cancels the save in Chrome).
 *
 * `download_url` comes from the response and is passed through untouched: it is
 * derived server-side, may change, and is never persisted or rebuilt here.
 */
export function useDocumentDownload(source: Source) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const download = useCallback(async () => {
    const path = source.download_url
    if (!path) {
      setError('This citation has no download link.')
      return
    }
    setPending(true)
    setError(null)
    let objectUrl: string | null = null
    try {
      const res = await fetchDepartmentDocument(path)
      const filename = downloadFilename(source, res.headers?.get('Content-Disposition'))
      objectUrl = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      const created = objectUrl
      window.setTimeout(() => URL.revokeObjectURL(created), 60_000)
    } catch (e) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      // 401 is already handled globally (token cleared → login). These two get
      // their own wording: `describeError` speaks about models, which is wrong
      // for a document, and the distinction matters — 403 is "not your
      // department", 404 is "gone, archived, or still being ingested".
      const message =
        e instanceof GatewayError && e.status === 403
          ? "You don't have access to this department's documents."
          : e instanceof GatewayError && e.status === 404
            ? 'This document is no longer available.'
            : describeError(e)
      if (mounted.current) setError(message)
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [source])

  return { download, pending, error }
}
