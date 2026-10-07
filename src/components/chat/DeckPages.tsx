import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import {
  fetchPptxCoverBackground,
  fetchPptxHeaderBackground,
  type ChartSpec,
  type DeckPreview,
  type SlideSpec,
} from '@/lib/api'
import {
  boxStyle,
  cardsLayout,
  CLOSING_ICON_BOX,
  CLOSING_RULE_BOX,
  CLOSING_TEXT,
  CLOSING_TITLE_BOX,
  comparisonLayout,
  COVER_SUBTITLE_BOX,
  COVER_TITLE_BOX,
  DECK_COLORS,
  FONT_PT,
  fitPt,
  percent,
  progressLayout,
  pt,
  sideStatBoxes,
  SLIDE_HEIGHT_PX,
  SLIDE_WIDTH_PX,
  slideZones,
  stepsLayout,
  TAKEAWAY_BOX,
  timelineLayout,
  TITLE_BOX,
  zoneBottom,
  type Box,
} from '@/lib/deck-layout'
import { deckIcon } from '@/lib/deck-icons'
import { fitScale, type PageZoom } from '@/lib/page-zoom'
import { useAuthedImageUrl } from '@/hooks/useAuthedImageUrl'
import { useElementWidth } from '@/hooks/useElementWidth'

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
function ImagePreview({ fileId, caption, maxHeight }: { fileId: string; caption?: string; maxHeight: number }) {
  const { url, error } = useAuthedImageUrl(fileId)
  return (
    <div className="flex flex-col items-center gap-2">
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-6 text-xs text-destructive">
          <ImageOff className="size-4 shrink-0" />
          Couldn't load this image: {error}
        </div>
      ) : url ? (
        <img src={url} alt={caption ?? ''} style={{ maxHeight }} className="max-w-full object-contain" />
      ) : (
        <div className="grid h-40 w-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {caption && (
        <p className="text-center italic text-muted-foreground" style={{ fontSize: pt(FONT_PT.caption) }}>
          {caption}
        </p>
      )}
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

/** The HTML/SVG chart preview is sized for a narrow panel; on the 1280 px
 * slide it is laid out at half width and doubled, so its labels stay legible. */
const CHART_ZOOM = 2

// --- Infographic layouts: create_pptx's shapes, at deck-layout.ts positions.
// Deck colours (DECK_COLORS), not theme tokens: the preview mirrors the deck,
// which looks the same in either theme.

/** An absolutely-placed text block (the gateway's zero-margin text boxes). */
function TextBlock({
  box,
  align = 'left',
  anchor = 'top',
  children,
}: {
  box: Box
  align?: 'left' | 'center'
  anchor?: 'top' | 'middle' | 'bottom'
  children: ReactNode
}) {
  const justify = anchor === 'middle' ? 'justify-center' : anchor === 'bottom' ? 'justify-end' : 'justify-start'
  return (
    <div
      className={`absolute flex flex-col overflow-hidden leading-[1.2] ${justify}`}
      style={{ ...boxStyle(box), textAlign: align }}
    >
      {children}
    </div>
  )
}

/** A gateway icon: red in a pale circle (`badge`), or bare white on a band. */
function DeckIcon({ name, box, badge = true }: { name: string | null | undefined; box: Box; badge?: boolean }) {
  // A fixed, module-level Lucide component looked up by name — not one
  // created per render — so createElement rather than a JSX tag bound to a
  // render-time variable (react-hooks/static-components).
  const icon = deckIcon(name)
  if (!icon) return null
  const size = box.height * SLIDE_HEIGHT_PX
  const glyph = badge ? size * 0.56 : size
  return (
    <div
      className="absolute grid place-items-center rounded-full"
      style={{ ...boxStyle(box), background: badge ? DECK_COLORS.pale : undefined }}
    >
      {createElement(icon, {
        'aria-hidden': true,
        'data-icon': name ?? undefined,
        color: badge ? DECK_COLORS.brand : '#ffffff',
        strokeWidth: 2,
        style: { width: glyph, height: glyph },
      })}
    </div>
  )
}

function CardsSlide({ slide }: { slide: SlideSpec }) {
  const cards = slide.cards ?? []
  return (
    <>
      {cardsLayout(cards, zoneBottom(slide)).map((l, i) => (
        <div key={i}>
          <div
            className="absolute rounded-2xl border bg-white"
            style={{ ...boxStyle(l.card), borderColor: DECK_COLORS.border }}
          />
          {l.icon && <DeckIcon name={cards[i].icon} box={l.icon} />}
          <TextBlock box={l.text}>
            <div className="font-bold" style={{ fontSize: fitPt(cards[i].title, FONT_PT.cardTitle, 'card.title'), color: DECK_COLORS.ink }}>
              {cards[i].title}
            </div>
            {cards[i].text && (
              <div className="mt-[4pt]" style={{ fontSize: fitPt(cards[i].text, FONT_PT.cardText, 'card.text'), color: DECK_COLORS.muted }}>
                {cards[i].text}
              </div>
            )}
          </TextBlock>
        </div>
      ))}
    </>
  )
}

/** PowerPoint's pentagon (first step) and chevron, point depth = half the height. */
function chevronClip(widthPx: number, heightPx: number, first: boolean) {
  const d = heightPx / 2
  const w = widthPx
  return first
    ? `polygon(0 0, ${w - d}px 0, ${w}px 50%, ${w - d}px 100%, 0 100%)`
    : `polygon(0 0, ${w - d}px 0, ${w}px 50%, ${w - d}px 100%, 0 100%, ${d}px 50%)`
}

function StepsSlide({ slide }: { slide: SlideSpec }) {
  const steps = slide.steps ?? []
  return (
    <>
      {stepsLayout(steps, zoneBottom(slide)).map((l, i) => (
        <div key={i}>
          <div
            className="absolute"
            style={{
              ...boxStyle(l.band),
              background: l.color,
              clipPath: chevronClip(l.band.width * SLIDE_WIDTH_PX, l.band.height * SLIDE_HEIGHT_PX, i === 0),
            }}
          />
          <TextBlock box={l.label} align="center" anchor="middle">
            <span className="font-bold text-white" style={{ fontSize: fitPt(steps[i].title, FONT_PT.stepLabel, 'step.title') }}>
              {steps[i].title}
            </span>
          </TextBlock>
          {l.icon && <DeckIcon name={steps[i].icon} box={l.icon} />}
          {steps[i].text && (
            <TextBlock box={l.text} align="center">
              <span style={{ fontSize: fitPt(steps[i].text, FONT_PT.stepText, 'step.text'), color: DECK_COLORS.muted }}>
                {steps[i].text}
              </span>
            </TextBlock>
          )}
        </div>
      ))}
    </>
  )
}

function TimelineSlide({ slide }: { slide: SlideSpec }) {
  const events = slide.timeline ?? []
  const layout = timelineLayout(events.length, zoneBottom(slide))
  return (
    <>
      <div className="absolute" style={{ ...boxStyle(layout.rule), background: DECK_COLORS.rule }} />
      {layout.events.map((l, i) => (
        <div key={i}>
          <TextBlock box={l.date} align="center" anchor="bottom">
            <span className="font-bold" style={{ fontSize: fitPt(events[i].date, FONT_PT.eventDate, 'event.date'), color: DECK_COLORS.brand }}>
              {events[i].date}
            </span>
          </TextBlock>
          <div
            className="absolute rounded-full border-2 border-white"
            style={{ ...boxStyle(l.dot), background: DECK_COLORS.brand }}
          />
          <TextBlock box={l.text} align="center">
            <div className="font-bold" style={{ fontSize: fitPt(events[i].title, FONT_PT.eventTitle, 'event.title'), color: DECK_COLORS.ink }}>
              {events[i].title}
            </div>
            {events[i].text && (
              <div className="mt-[4pt]" style={{ fontSize: fitPt(events[i].text, FONT_PT.eventText, 'event.text'), color: DECK_COLORS.muted }}>
                {events[i].text}
              </div>
            )}
          </TextBlock>
        </div>
      ))}
    </>
  )
}

function ComparisonSlide({ slide }: { slide: SlideSpec }) {
  const columns = slide.comparison ?? []
  return (
    <>
      {comparisonLayout(columns, zoneBottom(slide)).map((l, c) => (
        <div key={c}>
          <div className="absolute" style={{ ...boxStyle(l.head), background: l.color }} />
          {l.icon && <DeckIcon name={columns[c].icon} box={l.icon} badge={false} />}
          <TextBlock box={l.heading} anchor="middle">
            <span className="font-bold text-white" style={{ fontSize: fitPt(columns[c].heading, FONT_PT.columnHeading, 'column.heading') }}>
              {columns[c].heading}
            </span>
          </TextBlock>
          <div className="absolute" style={{ ...boxStyle(l.body), background: DECK_COLORS.panel }} />
          <TextBlock box={l.points}>
            {columns[c].points.map((point, p) => (
              <div key={p} className="mb-[10pt]" style={{ fontSize: fitPt(point, FONT_PT.columnPoint, 'column.point'), color: DECK_COLORS.ink }}>
                <span style={{ color: l.color, fontSize: pt(10) }}>{'●'}&nbsp;&nbsp;</span>
                {point}
              </div>
            ))}
          </TextBlock>
        </div>
      ))}
    </>
  )
}

function ProgressSlide({ slide }: { slide: SlideSpec }) {
  const bars = slide.progress ?? []
  return (
    <>
      {progressLayout(bars, zoneBottom(slide)).map((l, i) => (
        <div key={i}>
          <TextBlock box={l.label} anchor="middle">
            <div className="font-bold" style={{ fontSize: fitPt(bars[i].label, FONT_PT.progressLabel, 'progress.label'), color: DECK_COLORS.ink }}>
              {bars[i].label}
            </div>
            {bars[i].note && (
              <div style={{ fontSize: fitPt(bars[i].note, FONT_PT.progressNote, 'progress.note'), color: DECK_COLORS.muted }}>
                {bars[i].note}
              </div>
            )}
          </TextBlock>
          <div className="absolute rounded-full" style={{ ...boxStyle(l.track), background: DECK_COLORS.track }} />
          {l.fill && (
            <div
              className="absolute rounded-full"
              role="meter"
              aria-label={bars[i].label}
              aria-valuenow={bars[i].value}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ ...boxStyle(l.fill), background: DECK_COLORS.brand }}
            />
          )}
          <TextBlock box={l.value} anchor="middle">
            <span className="font-bold" style={{ fontSize: pt(FONT_PT.progressValue), color: DECK_COLORS.brand }}>
              {percent(bars[i].value)}
            </span>
          </TextBlock>
        </div>
      ))}
    </>
  )
}

type Stat = NonNullable<SlideSpec['stats']>[number]

/** One stat card, as the gateway's `_stat_card` draws it. Its own card
 * colours (_STAT_CARD_FILL/_BORDER, _STAT_VALUE_COLOR, _STAT_LABEL_COLOR). */
function StatCard({ stat }: { stat: Stat }) {
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-[#f0c5c9] bg-[#fceaeb] px-[9%] pt-[2.5%]">
      <div className="font-bold text-[#e60012]" style={{ fontSize: pt(FONT_PT.statValue) }}>
        {stat.value}
      </div>
      <div className="font-bold text-[#222222]" style={{ fontSize: pt(FONT_PT.statLabel) }}>
        {stat.label}
      </div>
      {stat.note && (
        <div className="text-[#666666]" style={{ fontSize: pt(FONT_PT.statNote) }}>
          {stat.note}
        </div>
      )}
    </div>
  )
}

/** A split chart/image slide's right-hand panel: stacked stats, or takeaways. */
function SidePanel({ slide, side }: { slide: SlideSpec; side: Box }) {
  const stats = slide.stats ?? []
  if (stats.length) {
    return (
      <>
        {sideStatBoxes(stats.length, side).map((box, i) => (
          <div key={i} className="absolute flex" style={boxStyle(box)}>
            <StatCard stat={stats[i]} />
          </div>
        ))}
      </>
    )
  }
  return (
    <TextBlock box={side}>
      {(slide.bullets ?? []).map((b, i) => (
        <div key={i} className="mb-[12pt]" style={{ fontSize: fitPt(b, FONT_PT.sideBullet, 'side.bullet'), color: DECK_COLORS.ink }}>
          <span style={{ color: DECK_COLORS.brand, fontSize: pt(12) }}>{'●'}&nbsp;&nbsp;</span>
          {b}
        </div>
      ))}
    </TextBlock>
  )
}

/** The slide's one-line key message: a pale banner with a brand-red edge. */
function Takeaway({ text }: { text: string }) {
  return (
    <>
      <div className="absolute" style={{ ...boxStyle(TAKEAWAY_BOX), background: DECK_COLORS.pale }} />
      <div className="absolute" style={{ ...boxStyle({ ...TAKEAWAY_BOX, width: 0.006 }), background: DECK_COLORS.brand }} />
      <TextBlock
        box={{ ...TAKEAWAY_BOX, left: TAKEAWAY_BOX.left + 0.02, width: TAKEAWAY_BOX.width - 0.03 }}
        anchor="middle"
      >
        <span className="font-bold" style={{ fontSize: fitPt(text, FONT_PT.takeaway, 'takeaway'), color: DECK_COLORS.ink }}>
          {text}
        </span>
      </TextBlock>
    </>
  )
}

/** A 1280 x 720 slide canvas: what PowerPoint shows at 100%. */
function SlideCanvas({
  background,
  className = '',
  children,
}: {
  background: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={'relative overflow-hidden bg-white bg-no-repeat ' + className}
      style={{
        width: SLIDE_WIDTH_PX,
        height: SLIDE_HEIGHT_PX,
        ...(background ? { backgroundImage: `url(${background})`, backgroundSize: '100% 100%' } : {}),
      }}
    >
      {children}
    </div>
  )
}

/** One content slide, each part placed where create_pptx puts it. */
function SlidePage({ slide, background }: { slide: SlideSpec; background: string | null }) {
  const zones = slideZones(slide)
  return (
    <SlideCanvas background={background}>
      {/* The title box is where create_pptx moves the title (_HEADER_TITLE_BOX):
          the header band, left of the logo and above the divider line. Text
          wraps and overflows the box, as it does in PowerPoint. */}
      {slide.title && (
        <div
          data-testid="slide-title-box"
          className="absolute flex items-center"
          style={boxStyle(TITLE_BOX)}
        >
          <h3 className="font-bold leading-[1.1] text-black" style={{ fontSize: pt(FONT_PT.title) }}>
            {slide.title}
          </h3>
        </div>
      )}
      {zones.media && slide.image && (
        <div className="absolute flex justify-center" style={boxStyle(zones.media)}>
          <ImagePreview
            fileId={slide.image.file_id}
            caption={slide.image.caption}
            maxHeight={zones.media.height * SLIDE_HEIGHT_PX}
          />
        </div>
      )}
      {zones.media && slide.chart && (
        <div className="absolute" style={boxStyle(zones.media)}>
          <div style={{ zoom: CHART_ZOOM }}>
            <ChartPreview chart={slide.chart} />
          </div>
        </div>
      )}
      {zones.side && <SidePanel slide={slide} side={zones.side} />}
      {slide.cards && <CardsSlide slide={slide} />}
      {slide.steps && <StepsSlide slide={slide} />}
      {slide.timeline && <TimelineSlide slide={slide} />}
      {slide.comparison && <ComparisonSlide slide={slide} />}
      {slide.progress && <ProgressSlide slide={slide} />}
      {slide.takeaway && <Takeaway text={slide.takeaway} />}
      {zones.stats && slide.stats && (
        // One row of cards across the slide, 2% gaps, as _add_stats lays them.
        <div className="absolute flex gap-[2%]" style={boxStyle(zones.stats)}>
          {slide.stats.map((stat, i) => (
            <StatCard key={i} stat={stat} />
          ))}
        </div>
      )}
      {zones.bullets && slide.bullets && (
        <ul
          className="absolute list-disc space-y-[0.4em] overflow-hidden pl-[1.2em] leading-[1.2] text-black"
          style={{ ...boxStyle(zones.bullets), fontSize: pt(FONT_PT.body) }}
        >
          {slide.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {zones.table && slide.table && (
        <div className="absolute" style={boxStyle(zones.table)}>
          <table className="w-full border-collapse text-left text-black" style={{ fontSize: pt(FONT_PT.body) }}>
            {slide.table.headers && (
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  {slide.table.headers.map((h, i) => (
                    <th key={i} className="border border-white px-3 py-1.5 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {slide.table.rows.map((row, r) => (
                <tr key={r} className={r % 2 ? 'bg-primary/5' : 'bg-primary/15'}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-white px-3 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SlideCanvas>
  )
}

/** The deck's title slide: the template's cover artwork, with the title and
 * subtitle in create_pptx's own text boxes (60 pt bottom-anchored, 24 pt). */
function CoverPage({ title, subtitle, coverBg }: { title: string; subtitle: string; coverBg: string | null }) {
  return (
    <SlideCanvas background={coverBg} className={coverBg ? 'text-black' : 'bg-primary text-primary-foreground'}>
      <div className="absolute flex items-end justify-center text-center" style={boxStyle(COVER_TITLE_BOX)}>
        <h2 className="leading-[1.05] text-pretty" style={{ fontSize: pt(FONT_PT.coverTitle) }}>
          {title}
        </h2>
      </div>
      {subtitle && (
        <p
          className="absolute text-center text-pretty opacity-80"
          style={{ ...boxStyle(COVER_SUBTITLE_BOX), fontSize: pt(FONT_PT.coverSubtitle) }}
        >
          {subtitle}
        </p>
      )}
    </SlideCanvas>
  )
}

/** The deck's fixed closing slide (`_add_closing_slide`): the cover artwork,
 * a red disc with a white heart, "Thank You" at 54 pt bold and a short red
 * rule. The PowerPoint version animates in; the preview is the end state. */
function ClosingPage({ coverBg }: { coverBg: string | null }) {
  return (
    <SlideCanvas background={coverBg}>
      <div
        data-testid="closing-icon"
        className="absolute grid place-items-center rounded-full"
        style={{ ...boxStyle(CLOSING_ICON_BOX), background: DECK_COLORS.brand }}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="w-1/2 fill-white">
          <path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z" />
        </svg>
      </div>
      <div className="absolute flex items-center justify-center" style={boxStyle(CLOSING_TITLE_BOX)}>
        <h2 className="font-bold" style={{ fontSize: pt(FONT_PT.closingTitle), color: DECK_COLORS.ink }}>
          {CLOSING_TEXT}
        </h2>
      </div>
      <div className="absolute" style={{ ...boxStyle(CLOSING_RULE_BOX), background: DECK_COLORS.brand }} />
    </SlideCanvas>
  )
}

/**
 * create_pptx's own structured content, rendered as real 16:9 slides: each is
 * a 1280 x 720 canvas laid out like the PowerPoint slide (positions from
 * `deck-layout.ts`, point sizes at 96 dpi) and zoomed as a whole — to the
 * panel's width by default, or to a fixed `zoom` level. Set in Arial to match
 * the downloaded deck (the gateway's `DECK_FONT`). `onScale` reports the
 * applied scale for the zoom control's label.
 */
export function DeckPages({
  deck,
  zoom = 'fit',
  onScale,
}: {
  deck: DeckPreview
  zoom?: PageZoom
  onScale?: (scale: number) => void
}) {
  const branding = usePptxBranding()
  const viewport = useRef<HTMLDivElement>(null)
  const available = useElementWidth(viewport)
  const scale = zoom === 'fit' ? fitScale(SLIDE_WIDTH_PX, available) : zoom
  useEffect(() => {
    onScale?.(scale)
  }, [scale, onScale])

  const slides: ReactNode[] = []
  if (deck.title) {
    slides.push(<CoverPage title={deck.title} subtitle={deck.subtitle} coverBg={branding?.cover ?? null} />)
  }
  for (const slide of deck.slides) {
    slides.push(<SlidePage slide={slide} background={branding?.header ?? null} />)
  }
  if (deck.closing) {
    slides.push(<ClosingPage coverBg={branding?.cover ?? null} />)
  }

  return (
    <div ref={viewport} className="overflow-auto rounded-xl border bg-muted p-3">
      <div
        data-testid="deck-pages"
        data-scale={scale.toFixed(3)}
        className="deck-light flex w-max flex-col gap-3 font-[Arial,sans-serif]"
      >
        {slides.map((content, i) => (
          <div key={i} className="relative w-max">
            <div className="shadow-sm" style={{ zoom: scale }}>
              {content}
            </div>
            {/* Outside the zoomed slide, so it stays legible at any zoom. */}
            <span className="absolute bottom-2 right-3 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-medium text-background">
              Page {i + 1} / {slides.length}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
