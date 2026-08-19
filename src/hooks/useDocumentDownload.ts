import { useCallback, useEffect, useRef, useState } from 'react'
import { GatewayError, describeError, fetchDepartmentDocument, type Source } from '@/lib/api'
import { downloadFilename } from '@/lib/sources'

/**
 * Content types safe to open in a browser tab from a blob: URL.
 *
 * The gateway serves pdf/docx/xlsx/csv/text and never text/html here, but a
 * blob: page opened in a tab runs with THIS origin, so a "view" is opened only
 * for a type the browser renders as inert content — PDF and plain text — never
 * for HTML/XHTML (which would execute script) and never for the Office formats
 * (which the browser cannot render anyway). The decision is made on the response
 * Content-Type, not on the button that was clicked, so an unexpected type is
 * saved rather than opened.
 */
function isViewableContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type === 'text/html' || type === 'application/xhtml+xml') return false
  return type === 'application/pdf' || type.startsWith('text/')
}

/**
 * Fetch a cited department document and hand it to the browser — either saved to
 * disk (`download`) or opened in a new tab (`view`).
 *
 * The route is behind JWT, so neither can be a plain `<a href>`: it sends no
 * Authorization header and 401s. Both fetch with the bearer header, turn the
 * body into a blob URL, and drive a throwaway anchor — `download` with a
 * `download` attribute, `view` with `target="_blank"`. `view` opens in-tab only
 * for a browser-renderable Content-Type (see above) and otherwise falls back to
 * saving, so it never silently does nothing.
 *
 * `download_url` comes from the response and is passed through untouched: it is
 * derived server-side, may change, and is never persisted or rebuilt here. The
 * blob URL is revoked late — a new tab (or a large save) still needs it alive,
 * and revoking in the same tick cancels both in Chromium.
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

  const run = useCallback(
    async (mode: 'download' | 'view') => {
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
        const contentType = res.headers?.get('Content-Type') ?? ''
        const filename = downloadFilename(source, res.headers?.get('Content-Disposition'))
        objectUrl = URL.createObjectURL(await res.blob())

        const anchor = document.createElement('a')
        anchor.href = objectUrl
        if (mode === 'view' && isViewableContentType(contentType)) {
          anchor.target = '_blank'
          anchor.rel = 'noopener noreferrer'
        } else {
          anchor.download = filename
          anchor.rel = 'noopener'
        }
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
    },
    [source],
  )

  const download = useCallback(() => run('download'), [run])
  const view = useCallback(() => run('view'), [run])

  return { download, view, pending, error }
}
