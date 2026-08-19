import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Library,
  Loader2,
} from 'lucide-react'
import type { Source } from '@/lib/api'
import { useDocumentDownload } from '@/hooks/useDocumentDownload'
import {
  externalLinkHost,
  fileTypeLabel,
  isMachineRecovered,
  isNrbSource,
  pagesLabel,
  partitionSources,
  publishedLabel,
  routesLabel,
  sourceTitle,
} from '@/lib/sources'

/** One cited document: what it is, where to verify it, and how to save it. */
function SourceRow({ source }: { source: Source }) {
  const { download, pending, error } = useDocumentDownload(source)

  const pages = pagesLabel(source.pages)
  const kind = fileTypeLabel(source.file_type)
  const published = publishedLabel(source.published_at)
  const officialHost = externalLinkHost(source.source_url)
  const routes = routesLabel(source.routes)
  const recovered = isMachineRecovered(source)
  const title = sourceTitle(source)

  return (
    <li className="rounded-lg border bg-background/60 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] font-semibold leading-snug">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {isNrbSource(source) && <span>Nepal Rastra Bank</span>}
            {kind && <span>{kind}</span>}
            {pages && <span>{pages}</span>}
            {published && <span>Published {published}</span>}
            {routes && !recovered && <span>Text: {routes}</span>}
          </div>
          {officialHost && (
            <a
              href={source.source_url!}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3" aria-hidden />
              Official page on {officialHost}
            </a>
          )}
        </div>
        {source.download_url ? (
          <button
            type="button"
            onClick={() => void download()}
            disabled={pending}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[11px] font-semibold transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {pending ? 'Opening…' : 'Download'}
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">No file</span>
        )}
      </div>

      {/*
        Not decoration and deliberately not a tooltip: this document's text came
        from OCR or from a legacy-Nepali-font conversion that no human has
        verified, so a figure, date or name taken from it may be wrong. The
        wording is the gateway's own `verify_note` — the same sentence the model
        was shown — so the badge cannot contradict the answer.
      */}
      {recovered && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold leading-snug">
              {source.verify_note ??
                'machine-recovered — VERIFY figures, dates and names against the source'}
            </p>
            {routes && <p className="mt-0.5">Pages extracted by: {routes}</p>}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </li>
  )
}

/**
 * The documents an answer was grounded in, under the answer.
 *
 * `sources` has three meanings and they are not interchangeable:
 *   `null`/absent — no corpus was searched (every turn of a general chat, and
 *     every turn before the stream's `done` event). Renders NOTHING, not an
 *     empty heading.
 *   `[]` — a search ran and surfaced no document. Says so, once.
 *   a list — one entry per document, best first, split by whether the answer's
 *     [N] markers named it.
 */
export function SourcesPanel({ sources }: { sources: Source[] | null | undefined }) {
  if (!sources) return null

  const { cited, related } = partitionSources(sources)

  return (
    <section
      aria-label="Sources"
      className="rounded-xl border bg-card/60 px-3 py-2.5 shadow-sm"
    >
      <h3 className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        <Library className="size-3.5" aria-hidden />
        Sources
      </h3>

      {sources.length === 0 && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Department documents were searched, but none was returned for this answer.
        </p>
      )}

      {cited.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {cited.map((source) => (
            <SourceRow key={source.document_id} source={source} />
          ))}
        </ul>
      )}

      {related.length > 0 && (
        <>
          <h4 className="mt-2.5 text-[11px] font-semibold text-foreground/80">
            Related documents
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The answer drew on these, but did not mark which part came from which
            document.
          </p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {related.map((source) => (
              <SourceRow key={source.document_id} source={source} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
