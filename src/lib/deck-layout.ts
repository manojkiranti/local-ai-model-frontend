/**
 * Slide geometry for the deck preview, mirroring the gateway's `create_pptx`
 * (`app/tools/local/pptx.py`) so a previewed slide matches the PowerPoint one.
 * Positions are fractions of the slide, exactly as the gateway writes them;
 * a template swap there needs these recalibrated together.
 */
import type { SlideSpec } from '@/lib/api'

/** The branded template is 12192000 x 6858000 EMU: 13.33 x 7.5 in, 16:9.
 * Laid out at 96 px per inch, so 1 pt is 4/3 px, like PowerPoint at 100%. */
export const SLIDE_WIDTH_PX = 1280
export const SLIDE_HEIGHT_PX = 720

/** A point size as CSS pixels on the 1280 x 720 slide. */
export const pt = (points: number) => (points * 4) / 3

/** Font sizes, exactly the gateway's: cover 60/24 pt, content title 20 pt
 * bold (`CONTENT_TITLE_PT`), body 16 pt (`CONTENT_BODY_PT`), stat card 28/12/9 pt. */
export const FONT_PT = {
  coverTitle: 60,
  coverSubtitle: 24,
  title: 20,
  body: 16,
  statValue: 28,
  statLabel: 12,
  statNote: 9,
  caption: 11,
  // Infographic layouts and the closing slide, as create_pptx sets them.
  cardTitle: 16,
  cardText: 12,
  stepLabel: 14,
  stepText: 12,
  eventDate: 16,
  eventTitle: 14,
  eventText: 12,
  columnHeading: 18,
  columnPoint: 15,
  progressLabel: 14,
  progressNote: 10,
  progressValue: 18,
  sideBullet: 16,
  takeaway: 14,
  closingTitle: 54,
} as const

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The cover's title/subtitle text boxes (`_COVER_TITLE_XFRM`, `_COVER_SUBTITLE_XFRM`). */
const EMU_W = 12192000
const EMU_H = 6858000
const emuBox = (left: number, top: number, width: number, height: number): Box => ({
  left: left / EMU_W,
  top: top / EMU_H,
  width: width / EMU_W,
  height: height / EMU_H,
})
export const COVER_TITLE_BOX = emuBox(1524000, 1122363, 9144000, 2387600)
export const COVER_SUBTITLE_BOX = emuBox(1524000, 3602038, 9144000, 1655762)

/** A content slide's title in the header band (`_HEADER_TITLE_BOX`). */
export const TITLE_BOX: Box = { left: 0.025, top: 0.02, width: 0.8, height: 0.13 }

/** Content starts just under the header (`_CONTENT_TOP_BRANDED`); the zone
 * offsets below were written for the old 0.30 top and move up with it. */
const TOP = 0.2
const SHIFT = TOP - 0.3

/** The layout's body placeholder spans 838200 + 10515600 EMU across. */
const BODY_X = { left: 838200 / EMU_W, width: 10515600 / EMU_W }
/** Tables, stats, images and charts sit inside a 5% side margin. */
const WIDE_X = { left: 0.05, width: 0.9 }

export interface SlideZones {
  /** Image or chart: full width alone, or the left of a split slide. */
  media?: Box
  /** A split slide's right-hand panel (its stats or short bullets). */
  side?: Box
  stats?: Box
  bullets?: Box
  /** Tables size their rows to content, so only the top edge is fixed. */
  table?: Omit<Box, 'height'>
}

/** Where each part of a content slide goes, as `_build_pptx_bytes` places it. */
export function slideZones(slide: SlideSpec): SlideZones {
  if (slide.image || slide.chart) {
    const bottom = zoneBottom(slide)
    if (slide.bullets?.length || slide.stats?.length) {
      const height = bottom - TOP
      return {
        media: { left: SPLIT_VISUAL_X.left, width: SPLIT_VISUAL_X.width, top: TOP, height },
        side: { left: SPLIT_SIDE_X.left, width: SPLIT_SIDE_X.width, top: TOP, height },
      }
    }
    return { media: { ...WIDE_X, top: TOP, height: Math.min(0.58, bottom - TOP) } }
  }

  const hasStats = Boolean(slide.stats?.length)
  const hasBullets = Boolean(slide.bullets?.length)
  const hasTable = Boolean(slide.table)
  const zones: SlideZones = {}

  if (hasStats) zones.stats = { ...WIDE_X, top: TOP, height: 0.22 }
  if (hasBullets) {
    let bullets: Box
    if (hasStats) bullets = { ...BODY_X, top: 0.55 + SHIFT, height: 0.33 }
    else if (hasTable) bullets = { ...BODY_X, top: TOP, height: 0.22 }
    else bullets = { ...BODY_X, top: TOP, height: 0.66 }
    // ...stopping above the takeaway banner when there is one.
    if (slide.takeaway) bullets.height = Math.min(bullets.height, ZONE_BOTTOM_WITH_TAKEAWAY - bullets.top)
    zones.bullets = bullets
  }
  if (hasTable) {
    const top = hasStats ? (hasBullets ? 0.8 : 0.55) + SHIFT : (hasBullets ? 0.55 : 0.32) + SHIFT
    zones.table = { ...WIDE_X, top }
  }
  return zones
}

// --- Infographic layouts ------------------------------------------------------
// The gateway's `_add_cards` / `_add_steps` / `_add_timeline` / `_add_comparison`
// / `_add_progress` / `_add_side_panel` / `_add_takeaway`, as boxes. Same
// constants, same centring; an icon diameter is a fraction of slide HEIGHT
// (so it stays round), converted to width with `square`.

const MARGIN_X = 0.05
const CONTENT_W = 0.9
const ZONE_BOTTOM = 0.86
const ZONE_BOTTOM_WITH_TAKEAWAY = 0.755
export const TAKEAWAY_BOX: Box = { left: 0.05, top: 0.775, width: 0.9, height: 0.075 }
const SPLIT_VISUAL_X = { left: 0.05, width: 0.55 }
const SPLIT_SIDE_X = { left: 0.62, width: 0.33 }
const SPLIT_STAT_GAP = 0.025
const SPLIT_STAT_MAX_H = 0.2
const CARD_GAP_X = 0.02
const CARD_GAP_Y = 0.03
const CARD_MAX_H = 0.44
const CARD_INSET_X = 0.015
const CARD_INSET_Y = 0.03
const CARD_ICON_D = 0.09
const STEP_BAND_H = 0.13
const STEP_ICON_D = 0.08
const STEP_TEXT_H = 0.12
const TIMELINE_LINE_Y = 0.2
const TIMELINE_DOT_D = 0.045
const TIMELINE_BLOCK_H = 0.42
const COMPARE_GAP = 0.025
const COMPARE_HEAD_H = 0.11
const COMPARE_ICON_D = 0.06
const COMPARE_POINT_H = 0.065
const PROGRESS_ROW_MAX_H = 0.11
const PROGRESS_LABEL_X = { left: 0.05, width: 0.27 }
const PROGRESS_TRACK_X = { left: 0.34, width: 0.5 }
const PROGRESS_VALUE_X = { left: 0.86, width: 0.09 }
const PROGRESS_TRACK_H = 0.035

/** Brand colours the gateway draws with (its _BRAND / _BRAND_DARK etc.). */
export const DECK_COLORS = {
  brand: '#e60012',
  brandDark: '#7a000a',
  pale: '#fceaeb',
  border: '#f0c5c9',
  ink: '#222222',
  muted: '#555555',
  track: '#eeeeee',
  rule: '#d9d9d9',
  panel: '#f7f7f7',
  neutralDark: '#3a3a3a',
} as const
const COMPARE_HEADS = [DECK_COLORS.brand, DECK_COLORS.neutralDark, DECK_COLORS.brandDark]

/** Comfortable copy lengths (the gateway's `_TEXT_CAPS`). */
export const TEXT_CAPS = {
  'card.title': 40,
  'card.text': 110,
  'step.title': 28,
  'step.text': 100,
  'event.date': 20,
  'event.title': 32,
  'event.text': 90,
  'column.heading': 30,
  'column.point': 70,
  'progress.label': 40,
  'progress.note': 50,
  'side.bullet': 90,
  takeaway: 140,
} as const

/** The gateway's `_fit`: full size up to the comfortable length, 2 pt smaller
 * up to 1.5x it, then 4 pt smaller (never below 8 pt) — long copy shrinks
 * rather than being refused. Returns CSS px, like `pt`. */
export function fitPt(text: string, basePt: number, key: keyof typeof TEXT_CAPS): number {
  const comfortable = TEXT_CAPS[key]
  if (text.length <= comfortable) return pt(basePt)
  return pt(Math.max(basePt - (text.length <= comfortable * 1.5 ? 2 : 4), 8))
}

/** A height-fraction diameter as a width fraction. */
export const square = (dH: number) => (dH * SLIDE_HEIGHT_PX) / SLIDE_WIDTH_PX

const centered = (top: number, bottom: number, block: number) => top + Math.max(0, (bottom - top - block) / 2)

/** The bottom of the content zone: above the badge, or above the takeaway banner. */
export function zoneBottom(slide: SlideSpec): number {
  return slide.takeaway ? ZONE_BOTTOM_WITH_TAKEAWAY : ZONE_BOTTOM
}

/** Linear blend of two #rrggbb colours (the step chevrons' gradient). */
function blend(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0'))
      .join('')
  )
}

export interface CardLayout {
  card: Box
  icon?: Box
  text: Box
}

export function cardsLayout(cards: NonNullable<SlideSpec['cards']>, bottom: number): CardLayout[] {
  const n = cards.length
  const cols = n <= 3 ? n : n === 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const cw = (CONTENT_W - (cols - 1) * CARD_GAP_X) / cols
  const ch = Math.min((bottom - TOP - (rows - 1) * CARD_GAP_Y) / rows, CARD_MAX_H)
  const top = centered(TOP, bottom, rows * ch + (rows - 1) * CARD_GAP_Y)
  return cards.map((card, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const inRow = r < rows - 1 ? cols : n - (rows - 1) * cols
    const rowW = inRow * cw + (inRow - 1) * CARD_GAP_X
    const left = MARGIN_X + (CONTENT_W - rowW) / 2 + c * (cw + CARD_GAP_X)
    const t = top + r * (ch + CARD_GAP_Y)
    let y = t + CARD_INSET_Y
    let icon: Box | undefined
    if (card.icon) {
      icon = { left: left + CARD_INSET_X, top: y, width: square(CARD_ICON_D), height: CARD_ICON_D }
      y += CARD_ICON_D + 0.02
    }
    return {
      card: { left, top: t, width: cw, height: ch },
      icon,
      text: { left: left + CARD_INSET_X, top: y, width: cw - 2 * CARD_INSET_X, height: t + ch - y - 0.015 },
    }
  })
}

export interface StepLayout {
  band: Box
  label: Box
  color: string
  icon?: Box
  text: Box
}

export function stepsLayout(steps: NonNullable<SlideSpec['steps']>, bottom: number): StepLayout[] {
  const n = steps.length
  const slot = CONTENT_W / n
  const anyIcon = steps.some((s) => s.icon)
  const anyText = steps.some((s) => s.text)
  const block = STEP_BAND_H + 0.035 + (anyIcon ? STEP_ICON_D + 0.02 : 0) + (anyText ? STEP_TEXT_H : 0)
  const top = centered(TOP, bottom, block)
  return steps.map((step, i) => {
    const left = MARGIN_X + i * slot
    let y = top + STEP_BAND_H + 0.035
    let icon: Box | undefined
    if (anyIcon) {
      if (step.icon) {
        icon = { left: left + (slot - square(STEP_ICON_D)) / 2, top: y, width: square(STEP_ICON_D), height: STEP_ICON_D }
      }
      y += STEP_ICON_D + 0.02
    }
    return {
      band: { left, top, width: slot, height: STEP_BAND_H },
      label: { left: left + slot * 0.14, top, width: slot * 0.7, height: STEP_BAND_H },
      color: blend(DECK_COLORS.brand, DECK_COLORS.brandDark, n > 1 ? i / (n - 1) : 0),
      icon,
      text: { left: left + 0.008, top: y, width: slot - 0.016, height: bottom - y },
    }
  })
}

export interface TimelineLayout {
  rule: Box
  events: { date: Box; dot: Box; text: Box }[]
}

export function timelineLayout(count: number, bottomZone: number): TimelineLayout {
  const slot = CONTENT_W / count
  const top = centered(TOP, bottomZone, TIMELINE_BLOCK_H)
  const bottom = Math.min(bottomZone, top + TIMELINE_BLOCK_H)
  const lineY = top + TIMELINE_LINE_Y
  const dotW = square(TIMELINE_DOT_D)
  const below = lineY + 0.05
  return {
    rule: { left: MARGIN_X, top: lineY - 0.003, width: CONTENT_W, height: 0.006 },
    events: Array.from({ length: count }, (_, i) => {
      const left = MARGIN_X + i * slot
      return {
        date: { left: left + 0.005, top: top + 0.03, width: slot - 0.01, height: 0.13 },
        dot: { left: left + (slot - dotW) / 2, top: lineY - TIMELINE_DOT_D / 2, width: dotW, height: TIMELINE_DOT_D },
        text: { left: left + 0.008, top: below, width: slot - 0.016, height: bottom - below },
      }
    }),
  }
}

export interface ComparisonLayout {
  head: Box
  color: string
  icon?: Box
  heading: Box
  body: Box
  points: Box
}

export function comparisonLayout(
  columns: NonNullable<SlideSpec['comparison']>,
  bottomZone: number,
): ComparisonLayout[] {
  const n = columns.length
  const cw = (CONTENT_W - (n - 1) * COMPARE_GAP) / n
  const most = Math.max(...columns.map((c) => c.points.length))
  const block = Math.min(COMPARE_HEAD_H + 0.06 + most * COMPARE_POINT_H, bottomZone - TOP)
  const top = centered(TOP, bottomZone, block)
  const bottom = top + block
  const bodyTop = top + COMPARE_HEAD_H
  return columns.map((col, c) => {
    const left = MARGIN_X + c * (cw + COMPARE_GAP)
    let textX = left + 0.015
    let icon: Box | undefined
    if (col.icon) {
      icon = { left: textX, top: top + (COMPARE_HEAD_H - COMPARE_ICON_D) / 2, width: square(COMPARE_ICON_D), height: COMPARE_ICON_D }
      textX += square(COMPARE_ICON_D) + 0.01
    }
    return {
      head: { left, top, width: cw, height: COMPARE_HEAD_H },
      color: COMPARE_HEADS[c % COMPARE_HEADS.length],
      icon,
      heading: { left: textX, top, width: left + cw - 0.015 - textX, height: COMPARE_HEAD_H },
      body: { left, top: bodyTop, width: cw, height: bottom - bodyTop },
      points: { left: left + 0.02, top: bodyTop + 0.03, width: cw - 0.04, height: bottom - bodyTop - 0.05 },
    }
  })
}

export interface ProgressLayout {
  label: Box
  track: Box
  fill: Box | null
  value: Box
}

export function progressLayout(bars: NonNullable<SlideSpec['progress']>, bottom: number): ProgressLayout[] {
  const n = bars.length
  const rowH = Math.min((bottom - TOP) / n, PROGRESS_ROW_MAX_H)
  const top = centered(TOP, bottom, n * rowH)
  return bars.map((bar, i) => {
    const y = top + i * rowH
    const trackY = y + (rowH * 0.9 - PROGRESS_TRACK_H) / 2
    const fillW = Math.max((PROGRESS_TRACK_X.width * bar.value) / 100, square(PROGRESS_TRACK_H))
    return {
      label: { ...PROGRESS_LABEL_X, top: y, height: rowH * 0.9 },
      track: { ...PROGRESS_TRACK_X, top: trackY, height: PROGRESS_TRACK_H },
      fill: bar.value > 0 ? { left: PROGRESS_TRACK_X.left, top: trackY, width: fillW, height: PROGRESS_TRACK_H } : null,
      value: { ...PROGRESS_VALUE_X, top: y, height: rowH * 0.9 },
    }
  })
}

/** A split slide's stacked side stat cards (`_add_side_panel`). */
export function sideStatBoxes(count: number, side: Box): Box[] {
  const h = Math.min((side.height - (count - 1) * SPLIT_STAT_GAP) / count, SPLIT_STAT_MAX_H)
  return Array.from({ length: count }, (_, i) => ({ ...side, top: side.top + i * (h + SPLIT_STAT_GAP), height: h }))
}

/** The gateway's percentage label: `72%`, `38.5%` (Python's `f"{v:g}%"`). */
export const percent = (value: number) => `${Number(value.toPrecision(6))}%`

/** The closing "Thank You" slide (`_CLOSING_ICON`, `_CLOSING_TITLE_BOX`, `_CLOSING_RULE`). */
export const CLOSING_TEXT = 'Thank You'
export const CLOSING_ICON_BOX: Box = { left: 0.5 - square(0.2) / 2, top: 0.24, width: square(0.2), height: 0.2 }
export const CLOSING_TITLE_BOX: Box = { left: 0.1, top: 0.5, width: 0.8, height: 0.16 }
export const CLOSING_RULE_BOX: Box = { left: 0.5 - 0.08 / 2, top: 0.69, width: 0.08, height: 0.006 }

/** A box as absolute-position CSS on the slide. */
export function boxStyle(box: Partial<Box>) {
  return {
    left: box.left !== undefined ? `${box.left * 100}%` : undefined,
    top: box.top !== undefined ? `${box.top * 100}%` : undefined,
    width: box.width !== undefined ? `${box.width * 100}%` : undefined,
    height: box.height !== undefined ? `${box.height * 100}%` : undefined,
  }
}
