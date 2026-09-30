import { useEffect, useState } from 'react'
import { AlertTriangle, Download, ImageOff, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import {
  describeError,
  fetchFile,
  fetchFilePreview,
  fetchPptxCoverBackground,
  fetchPptxHeaderBackground,
} from '@/lib/api'
import type { ChartSpec, DeckPreview, SlideSpec } from '@/lib/api'
import { filenameFromContentDisposition } from '@/lib/file-format'
import type { FileRef } from '@/lib/agent-api'
import { useAuthedImageUrl } from '@/hooks/useAuthedImageUrl'

interface Loaded {
  contentType: string
  blobUrl: string
  filename: string
}

const isImage = (ct: string) => ct.startsWith('image/')
const isPdf = (ct: string) => ct.includes('application/pdf')
const isDeck = (ct: string) => ct.includes('presentationml.presentation') || ct.includes('ms-powerpoint')

interface PptxBranding {
  cover: string | null
  header: string | null
}

// Module-level, not component state: the template artwork is one shared,
// effectively-static asset for the whole app session, not per-file — fetching
// it once and reusing the blob URL across every deck preview (rather than
// per open) avoids a re-fetch every time a different deck is previewed. Never
// revoked: unlike a per-file blob, this outlives any single panel instance.
let brandingPromise: Promise<PptxBranding> | null = null

function loadPptxBranding(): Promise<PptxBranding> {
  if (!brandingPromise) {
    brandingPromise = (async () => {
      const [cover, header] = await Promise.all([
        fetchPptxCoverBackground()
          .then((res) => res.blob())
          .then((blob) => URL.createObjectURL(blob))
          .catch(() => null),
        fetchPptxHeaderBackground()
          .then((res) => res.blob())
          .then((blob) => URL.createObjectURL(blob))
          .catch(() => null),
      ])
      return { cover, header }
    })()
  }
  return brandingPromise
}

/** The org's template artwork, if this deployment has one (404 -> plain color fallback). */
function usePptxBranding(): PptxBranding | null {
  const [branding, setBranding] = useState<PptxBranding | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadPptxBranding().then((b) => {
      if (!cancelled) setBranding(b)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return branding
}

// Fixed categorical order (never cycled — dataviz skill) — 4 colors defined
// as tokens in index.css, validated together (light+dark) with the palette
// validator. A 5th+ series folds into one shared muted color rather than
// repeating slot 1-4 or inventing a 5th.
const SERIES_BG = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4']
const SERIES_STROKE = ['stroke-chart-1', 'stroke-chart-2', 'stroke-chart-3', 'stroke-chart-4']
const OTHER_BG = 'bg-muted-foreground/40'
const OTHER_STROKE = 'stroke-muted-foreground'

function seriesBg(i: number) {
  return SERIES_BG[i] ?? OTHER_BG
}
function seriesStroke(i: number) {
  return SERIES_STROKE[i] ?? OTHER_STROKE
}

/** One embedded raster image (bearer-fetched, same hook the chat attachment
 * lightbox uses), scaled to fit with its aspect ratio preserved. */
function ImagePreview({ fileId, caption }: { fileId: string; caption?: string }) {
  const { url, error } = useAuthedImageUrl(fileId)
  return (
    <div className="flex flex-col items-center gap-2">
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-6 text-xs text-destructive">
          <ImageOff className="size-4 shrink-0" />
          Couldn't load this image: {error}
        </div>
      ) : url ? (
        <img src={url} alt={caption ?? ''} className="max-h-[50vh] max-w-full rounded-lg border object-contain" />
      ) : (
        <div className="grid h-40 w-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {caption && <p className="text-center text-xs italic text-muted-foreground">{caption}</p>}
    </div>
  )
}

/** create_pptx's own native chart, previewed with plain HTML/SVG — not a
 * pixel copy of the real PowerPoint chart, but the same data, categorically
 * colored and direct-labeled (dataviz skill's relief rule) so it reads
 * without a legend lookup for the common 1-2 series case. */
function ChartPreview({ chart }: { chart: ChartSpec }) {
  const series = chart.series.length ? chart.series : [{ data: [] }]
  const displaySeries = chart.chart_type === 'pie' || chart.chart_type === 'donut' ? series.slice(0, 1) : series
  const showLegend = displaySeries.length > 1

  if (chart.chart_type === 'pie' || chart.chart_type === 'donut') {
    const values = displaySeries[0]?.data ?? []
    const total = values.reduce((a, b) => a + b, 0) || 1
    return (
      <div className="flex flex-col gap-3">
        <div className="flex h-8 w-full overflow-hidden rounded-full border">
          {chart.labels.map((label, i) => {
            const pct = ((values[i] ?? 0) / total) * 100
            if (pct <= 0) return null
            return <div key={label} className={seriesBg(i)} style={{ width: `${pct}%` }} title={`${label}: ${values[i]}`} />
          })}
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {chart.labels.map((label, i) => (
            <li key={label} className="flex items-center gap-1.5 text-foreground/85">
              <span className={`size-2.5 shrink-0 rounded-full ${seriesBg(i)}`} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="tabular-nums text-muted-foreground">
                {(((values[i] ?? 0) / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const allValues = displaySeries.flatMap((s) => s.data)
  const max = Math.max(1, ...allValues.map((v) => Math.abs(v)))

  if (chart.chart_type === 'line' || chart.chart_type === 'area') {
    const w = 100
    const h = 44
    const stepX = chart.labels.length > 1 ? w / (chart.labels.length - 1) : 0
    return (
      <div className="flex flex-col gap-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label={`${chart.chart_type} chart`}>
          <line x1={0} y1={h} x2={w} y2={h} className="stroke-border" strokeWidth={0.5} />
          {displaySeries.map((s, si) => {
            const points = s.data.map((v, i) => `${i * stepX},${h - (Math.abs(v) / max) * (h - 4)}`).join(' ')
            return (
              <g key={si}>
                {chart.chart_type === 'area' && (
                  <polygon points={`0,${h} ${points} ${w},${h}`} className={seriesBg(si)} opacity={0.18} />
                )}
                <polyline
                  points={points}
                  fill="none"
                  className={seriesStroke(si)}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          {chart.labels.map((l) => (
            <span key={l} className="truncate">
              {l}
            </span>
          ))}
        </div>
        {showLegend && <ChartLegend names={displaySeries.map((s, i) => s.name || `Series ${i + 1}`)} />}
      </div>
    )
  }

  // bar / hbar: grouped bars per category, direct value labels.
  const horizontal = chart.chart_type === 'hbar'
  return (
    <div className="flex flex-col gap-3">
      <div className={horizontal ? 'flex flex-col gap-2' : 'flex h-40 items-end gap-3'}>
        {chart.labels.map((label, li) => (
          <div key={label} className={horizontal ? 'flex items-center gap-2' : 'flex min-w-0 flex-1 flex-col items-center gap-1'}>
            {horizontal && <span className="w-16 shrink-0 truncate text-right text-[11px] text-foreground/80">{label}</span>}
            <div className={horizontal ? 'flex flex-1 gap-1' : 'flex h-full w-full items-end justify-center gap-1'}>
              {displaySeries.map((s, si) => {
                const v = s.data[li] ?? 0
                const pct = Math.max(2, (Math.abs(v) / max) * 100)
                return (
                  <div
                    key={si}
                    className={`${seriesBg(si)} rounded-sm`}
                    style={horizontal ? { width: `${pct}%`, height: 14 } : { height: `${pct}%`, width: 10 }}
                    title={`${s.name || label}: ${v}`}
                  />
                )
              })}
            </div>
            {!horizontal && <span className="truncate text-[10px] text-muted-foreground">{label}</span>}
          </div>
        ))}
      </div>
      {showLegend && <ChartLegend names={displaySeries.map((s, i) => s.name || `Series ${i + 1}`)} />}
    </div>
  )
}

function ChartLegend({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {names.map((name, i) => (
        <span key={name} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
          <span className={`size-2.5 shrink-0 rounded-full ${seriesBg(i)}`} />
          {name}
        </span>
      ))}
    </div>
  )
}

/** One slide rendered as a page — title, bullets, table, whichever are present. */
function SlidePage({
  slide,
  page,
  total,
  headerBg,
}: {
  slide: SlideSpec
  page: number
  total: number
  headerBg: string | null
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* A thin band of the template's own header artwork (logo, divider
          line) — matching how it actually looks on a real content slide —
          rather than stretching it across the whole variable-height card,
          which would crop the logo unpredictably depending on content length. */}
      {headerBg && (
        <div
          className="h-14 w-full bg-cover bg-top"
          style={{ backgroundImage: `url(${headerBg})` }}
          aria-hidden="true"
        />
      )}
      <div className="p-6">
        {slide.title && (
          <h3 className="border-b-2 border-primary/60 pb-2 text-lg font-semibold text-foreground">
            {slide.title}
          </h3>
        )}
        {slide.image && (
          <div className="mt-4">
            <ImagePreview fileId={slide.image.file_id} caption={slide.image.caption} />
          </div>
        )}
        {slide.chart && (
          <div className="mt-4">
            <ChartPreview chart={slide.chart} />
          </div>
        )}
        {slide.stats && slide.stats.length > 0 && (
          // Fixed 2 columns rather than a viewport breakpoint: this panel is
          // docked at a fixed width regardless of window size (or, expanded,
          // capped at max-w-2xl), so a `sm:` class would react to the wrong
          // dimension and could cram 4 cards into a narrow docked panel.
          <div className="mt-4 grid grid-cols-2 gap-3">
            {slide.stats.map((stat, i) => (
              <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="text-xl font-bold text-primary">{stat.value}</div>
                <div className="mt-1 text-[11px] font-semibold text-foreground">{stat.label}</div>
                {stat.note && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{stat.note}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {slide.bullets && slide.bullets.length > 0 && (
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-foreground/85">
            {slide.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {slide.table && (
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-left text-[12.5px]">
              {slide.table.headers && (
                <thead>
                  <tr className="bg-muted">
                    {slide.table.headers.map((h, i) => (
                      <th key={i} className="border-b px-2.5 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {slide.table.rows.map((row, r) => (
                  <tr key={r} className={r % 2 ? 'bg-muted/40' : undefined}>
                    {row.map((cell, c) => (
                      <td key={c} className="border-b px-2.5 py-1.5">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <span className="absolute bottom-2 right-3 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background">
        Page {page} / {total}
      </span>
    </div>
  )
}

/** The deck's title slide, styled distinctly from content slides. Locked to
 * the real 16:9 slide aspect ratio so the cover artwork (a full-bleed image,
 * unlike the header band above) maps onto it with no cropping. */
function CoverPage({
  title,
  subtitle,
  page,
  total,
  coverBg,
}: {
  title: string
  subtitle: string
  page: number
  total: number
  coverBg: string | null
}) {
  return (
    <div
      className={
        'relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-xl border px-6 text-center shadow-sm ' +
        (coverBg ? 'bg-cover bg-center text-foreground' : 'bg-primary text-primary-foreground')
      }
      style={coverBg ? { backgroundImage: `url(${coverBg})` } : undefined}
    >
      <h2 className="text-2xl font-bold text-pretty">{title}</h2>
      {subtitle && (
        <p
          className={
            'mt-2 text-sm text-pretty ' + (coverBg ? 'text-foreground/75' : 'text-primary-foreground/85')
          }
        >
          {subtitle}
        </p>
      )}
      <span className="absolute bottom-2 right-3 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background">
        Page {page} / {total}
      </span>
    </div>
  )
}

/** create_pptx's own structured content, rendered as scrollable slide "pages".
 * Set in Arial to match the downloaded deck (the gateway's `DECK_FONT`). */
function DeckPages({ deck }: { deck: DeckPreview }) {
  const branding = usePptxBranding()
  const total = (deck.title ? 1 : 0) + deck.slides.length
  let page = 0
  return (
    <div data-testid="deck-pages" className="flex flex-col gap-4 font-[Arial,sans-serif]">
      {deck.title && (
        <CoverPage
          title={deck.title}
          subtitle={deck.subtitle}
          page={++page}
          total={total}
          coverBg={branding?.cover ?? null}
        />
      )}
      {deck.slides.map((slide, i) => (
        <SlidePage
          key={i}
          slide={slide}
          page={++page}
          total={total}
          headerBg={branding?.header ?? null}
        />
      ))}
    </div>
  )
}

/**
 * Docked preview panel on the right side of the chat window. Fetches
 * `/v1/files/{id}` with the bearer header (a plain <a> can't) and branches on
 * the real Content-Type: images render inline, PDFs render in the browser's
 * own PDF viewer via an iframe (zero extra libraries), and a PPTX deck
 * renders from its OWN structured content (`GET /v1/files/{id}/preview`) as
 * scrollable per-slide pages — not by parsing the binary file, which no
 * browser can render. Anything else (or a deck with no recorded preview —
 * not every tool provides one, and files predating this feature have none)
 * falls back to a "download it instead" message. Blob URLs are revoked on
 * unmount/file change, same discipline as FileCard.
 */
export function FilePreviewPanel({
  file,
  onClose,
}: {
  file: FileRef | null
  onClose: () => void
}) {
  // Same convention as useAuthedImageUrl: state is stamped with the id it
  // belongs to and read back by comparison below, so a changed file reports
  // "loading" without a synchronous reset inside the effect (this panel is
  // reused across different files rather than remounted, unlike FileCard,
  // which gets a fresh instance per id via its list `key`).
  const [loadedState, setLoadedState] = useState<(Loaded & { id: string }) | null>(null)
  const [failedState, setFailedState] = useState<{ id: string; error: string } | null>(null)
  // `deck: null` (attempted, none recorded) is distinct from this whole record
  // being absent (not attempted yet, or for a different id) — collapsing the
  // two would render the "no preview, download it" fallback for the split
  // second before a deck's OWN structured preview arrives.
  const [deckState, setDeckState] = useState<{ id: string; deck: DeckPreview | null } | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!file) return
    const fileId = file.id
    let cancelled = false
    let createdUrl: string | null = null

    void (async () => {
      try {
        const res = await fetchFile(fileId)
        const contentType = res.headers.get('Content-Type') ?? ''
        const named = filenameFromContentDisposition(res.headers.get('Content-Disposition'))
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        createdUrl = blobUrl
        if (cancelled) {
          URL.revokeObjectURL(blobUrl)
          return
        }
        setLoadedState({
          id: fileId,
          contentType,
          blobUrl,
          filename: named || file.filename || `file-${fileId.slice(0, 8)}`,
        })

        if (isDeck(contentType)) {
          // Best-effort, secondary fetch: 404 means no structured preview was
          // recorded for this file (an older file, or a tool that doesn't
          // supply one), and any other failure isn't worth a distinct error
          // state here either — either way this resolves to `deck: null`
          // (attempted, none available), and the raw-file view (the download
          // link itself) still works regardless.
          let preview: DeckPreview | null = null
          try {
            preview = await fetchFilePreview(fileId)
          } catch {
            // preview stays null — no structured preview for this file
          }
          if (!cancelled) setDeckState({ id: fileId, deck: preview })
        }
      } catch (e) {
        if (!cancelled) setFailedState({ id: fileId, error: describeError(e) })
      }
    })()

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
    // Depend on the primitives actually used (id/filename), not the object
    // reference: an unstable but same-id object must not re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.filename])

  if (!file) return null

  const loaded = loadedState?.id === file.id ? loadedState : null
  const error = failedState?.id === file.id ? failedState.error : null
  // Three states for a deck: undefined (fetch still in flight), null
  // (attempted, none recorded), or the resolved preview.
  const deckAttempt = deckState?.id === file.id ? deckState : undefined
  const deckPending = Boolean(loaded && isDeck(loaded.contentType) && deckAttempt === undefined)

  return (
    <div
      role="complementary"
      aria-label={loaded ? `Preview: ${loaded.filename}` : 'File preview'}
      className={
        expanded
          ? 'fixed inset-0 z-40 flex flex-col bg-background'
          : 'fixed inset-0 z-40 flex flex-col bg-background sm:static sm:inset-auto sm:z-auto sm:h-full sm:w-[420px] sm:shrink-0 sm:border-l'
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {loaded?.filename ?? file.filename ?? 'Preview'}
        </span>
        {loaded && (
          <a
            href={loaded.blobUrl}
            download={loaded.filename}
            aria-label={`Download ${loaded.filename}`}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Restore panel size' : 'Expand to full screen'}
          className="hidden size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:grid"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Couldn't load {file.filename ?? 'file'}: {error}</span>
          </div>
        ) : !loaded || deckPending ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isDeck(loaded.contentType) && deckAttempt?.deck ? (
          <div className={expanded ? 'mx-auto max-w-2xl' : undefined}>
            <DeckPages deck={deckAttempt.deck} />
          </div>
        ) : isImage(loaded.contentType) ? (
          <div className="overflow-hidden rounded-xl border bg-white p-2">
            <img src={loaded.blobUrl} alt={loaded.filename} className="mx-auto block max-w-full" />
          </div>
        ) : isPdf(loaded.contentType) ? (
          <iframe
            title={`Preview of ${loaded.filename}`}
            src={loaded.blobUrl}
            className="h-full min-h-[70vh] w-full rounded-xl border bg-white"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            <span>No visual preview available for this file type yet.</span>
            <a
              href={loaded.blobUrl}
              download={loaded.filename}
              className="inline-flex items-center gap-2 rounded-xl border bg-background px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
            >
              <Download className="size-4" />
              Download {loaded.filename}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
