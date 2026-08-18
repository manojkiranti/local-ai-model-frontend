import { useState } from 'react'
import { ImageIcon, ScanText } from 'lucide-react'
import { ImageLightbox } from './ImageLightbox'

/**
 * Provenance caveat for an answer built on OCR'd image text.
 *
 * The `read_image` tool tells the model the text is machine-read and that
 * figures must be verified, but the model does not reliably pass that on — it
 * has read "Net Pay: 6,518.00" correctly and answered "NPR 6,518.00", inventing
 * a currency and dropping the warning. These are financial documents, so the
 * caveat is stated here, off the tool signal, and the original image is one
 * click away for comparison.
 */
export function OcrNotice({ imageIds }: { imageIds: string[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      <span className="flex items-center gap-1.5">
        <ScanText className="size-3.5 shrink-0" aria-hidden />
        Text read from image by OCR — check figures, dates and account numbers
        against the original.
      </span>
      {imageIds.map((id, i) => (
        <button
          key={id}
          type="button"
          onClick={() => setOpenId(id)}
          className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-background/60 px-1.5 py-0.5 font-medium transition-colors hover:border-amber-500 hover:text-amber-800 dark:hover:text-amber-300"
        >
          <ImageIcon className="size-3" aria-hidden />
          {imageIds.length > 1 ? `View image ${i + 1}` : 'View image'}
        </button>
      ))}
      {openId && <ImageLightbox fileId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
