import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile, type UploadedFile } from '@/lib/api'
import {
  describeUploadError,
  isImageFilename,
  validateUpload,
} from '@/lib/upload-validation'

export type Attachment =
  | {
      status: 'uploading'
      filename: string
      size: number
      /** Local object URL for an image, shown before the 201 lands. */
      previewUrl: string | null
    }
  | { status: 'ready'; file: UploadedFile; previewUrl: string | null }
  | { status: 'error'; filename: string; message: string }

/**
 * Owns a single, replaceable attachment for the composer. Validates
 * client-side first (no wasted round trip), uploads, and tracks the result.
 * Picking again or clearing aborts any in-flight upload; also aborts on unmount.
 *
 * For images the local `File` is turned into an object URL immediately, so the
 * preview needs no request at all — and it is revoked on replace, clear, and
 * unmount.
 */
export function useAttachment() {
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const pick = useCallback(
    (file: File) => {
      abortInFlight()
      revokePreview()
      const rejection = validateUpload(file)
      if (rejection) {
        setAttachment({ status: 'error', filename: file.name, message: rejection })
        return
      }
      const previewUrl = isImageFilename(file.name) ? URL.createObjectURL(file) : null
      previewUrlRef.current = previewUrl
      const controller = new AbortController()
      controllerRef.current = controller
      setAttachment({ status: 'uploading', filename: file.name, size: file.size, previewUrl })
      void (async () => {
        try {
          const uploaded = await uploadFile(file, controller.signal)
          if (controllerRef.current === controller) {
            setAttachment({ status: 'ready', file: uploaded, previewUrl })
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          if (controllerRef.current === controller) {
            setAttachment({ status: 'error', filename: file.name, message: describeUploadError(e) })
          }
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      })()
    },
    [abortInFlight, revokePreview],
  )

  const clear = useCallback(() => {
    abortInFlight()
    revokePreview()
    setAttachment(null)
  }, [abortInFlight, revokePreview])

  useEffect(
    () => () => {
      abortInFlight()
      revokePreview()
    },
    [abortInFlight, revokePreview],
  )

  return { attachment, pick, clear }
}
