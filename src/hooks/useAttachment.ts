import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile, type UploadedFile } from '@/lib/api'
import { describeUploadError, validateUpload } from '@/lib/upload-validation'

export type Attachment =
  | { status: 'uploading'; filename: string; size: number }
  | { status: 'ready'; file: UploadedFile }
  | { status: 'error'; filename: string; message: string }

/**
 * Owns a single, replaceable attachment for the composer. Validates
 * client-side first (no wasted round trip), uploads, and tracks the result.
 * Picking again or clearing aborts any in-flight upload; also aborts on unmount.
 */
export function useAttachment() {
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const pick = useCallback(
    (file: File) => {
      abortInFlight()
      const rejection = validateUpload(file)
      if (rejection) {
        setAttachment({ status: 'error', filename: file.name, message: rejection })
        return
      }
      const controller = new AbortController()
      controllerRef.current = controller
      setAttachment({ status: 'uploading', filename: file.name, size: file.size })
      void (async () => {
        try {
          const uploaded = await uploadFile(file, controller.signal)
          if (controllerRef.current === controller) {
            setAttachment({ status: 'ready', file: uploaded })
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
    [abortInFlight],
  )

  const clear = useCallback(() => {
    abortInFlight()
    setAttachment(null)
  }, [abortInFlight])

  useEffect(() => () => abortInFlight(), [abortInFlight])

  return { attachment, pick, clear }
}
