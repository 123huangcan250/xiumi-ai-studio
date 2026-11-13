// 布局：flow 自上而下自动排版（间距、断行、按内容算高度），absolute 按 frame 放置。
import { toHex } from '../color'
import { replayEnv, wrapText, type FontSpec } from './text'
import type { ReplayDoc, ReplayItem, ReplayItemType, ReplayScene, ReplayStyle } from './types'

export const CANVAS_W = 750
export const PAD_X = 56
export const PAD_TOP = 88
export const PAD_BOTTOM = 96
export const CONTENT_W = CANVAS_W - PAD_X * 2
const MIN_FLOW_HEIGHT = 820
const ROW_GAP = 18

/** 一段排好的文字：位置为文字区左上角，lines 已断行 */
export interface TextRun {
  x: number
  y: number
  w: number
  lines: string[]
  font: FontSpec
  color: string
  lineHeight: number
  align: ReplayStyle['align']
  /** 关键词（**…** 标出）在去掉标记后的文字里的区间 [起, 止) */
  marks?: [number, number][]
  /** 每行第一个字在去掉标记后的文字里的位置 */
  starts?: number[]
  /** 关键词颜色 */
  markColor?: string
}

export interface LaidItem {
  item: ReplayItem
  index: number
  box: { x: number; y: number; w: number; h: number }
  style: ReplayStyle
  /** 主文字（标题、正文、按钮文字、数据卡数值等） */
  text?: TextRun
  /** 次要文字（数据卡说明、卡片小标题、引语出处） */
  label?: TextRun
  /** 按钮、标签是否为描边样式 */
  outline?: boolean
}

export interface SceneLayout {
  items: LaidItem[]
  height: number
  /** 内容超出了手动设置的场景高度 */
  overflow: boolean
}

// ---------- 颜色 ----------

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
/** a、b 按 w 混合（w=1 为 b） */
export function mix(a: string, b: string, w: number): string {
  const x = rgb(toHex(a) ?? '#000000')
  const y = rgb(toHex(b) ?? '#000000')
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * w).toString(16).padStart(2, '0')).join('')
}

/** 场景底色（渐变取第一个颜色，背景图按深色处理），用于推算对比色与打字遮挡 */
export function baseColor(doc: ReplayDoc): string {
  const bg = doc.canvas.background
  if (bg.type === 'color') return bg.value
  if (bg.type === 'gradient') return bg.value.split(',')[0]
  return '#000000'
}

/** 渐变背景在 y 处的颜色（打字遮挡用，和色带近似一致） */
export function backgroundAt(doc: ReplayDoc, y: number, height: number): string | null {
  const bg = doc.canvas.background
  if (bg.type === 'color') return bg.value
  if (bg.type === 'image') return null
  const stops = bg.value.split(',')
  const t = Math.min(1, Math.max(0, y / Math.max(1, height))) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  return mix(stops[i], stops[i + 1], t - i)
}

// ---------- 样式 ----------

const BASE: Omit<ReplayStyle, 'color'> = { fill: '', stroke: '', fontSize: 28, fontWeight: 400, align: 'left', lineHeight: 1.7, letterSpacing: 0, radius: 0 }

export function resolveStyle(item: ReplayItem, doc: ReplayDoc, outline = false): ReplayStyle {
  const { text, accent } = doc.theme
  const bg = baseColor(doc)
  const muted = mix(text, bg, 0.3)
  const ink = mix(bg, '#000000', 0.2)
  const d: Record<ReplayItemType, Partial<ReplayStyle>> = {
    title: { color: text, fontSize: 56, fontWeight: 700, lineHeight: 1.28, letterSpacing: 1 },
    subtitle: { color: accent, fontSize: 30, lineHeight: 1.45, letterSpacing: 2 },
    text: { color: muted, fontSize: 28, lineHeight: 1.75, letterSpacing: 0.5 },
    quote: { color: text, fontSize: 30, lineHeight: 1.6, stroke: accent },
    tag: outline ? { color: accent, stroke: accent, fontSize: 22, fontWeight: 700, letterSpacing: 2, radius: 999, lineHeight: 1.3 } : { color: ink, fill: accent, fontSize: 22, fontWeight: 700, letterSpacing: 2, radius: 999, lineHeight: 1.3 },
    button: outline ? { color: accent, stroke: accent, fontSize: 26, fontWeight: 700, radius: 12, lineHeight: 1.3, letterSpacing: 1 } : { color: ink, fill: accent, fontSize: 26, fontWeight: 700, radius: 12, lineHeight: 1.3, letterSpacing: 1 },
    stat: { color: accent, fill: mix(bg, accent, 0.08), stroke: mix(bg, accent, 0.45), fontSize: 52, fontWeight: 700, lineHeight: 1.15, radius: 14 },
    image: { color: muted, stroke: mix(bg, accent, 0.5) },
    divider: { color: muted, stroke: mix(bg, text, 0.35) },
    shape: { color: accent, fill: accent },
  }
  return { ...BASE, color: text, ...d[item.type], ...(item.style ?? {}) } as ReplayStyle
}

const font = (s: ReplayStyle): FontSpec => ({ size: s.fontSize, weight: s.fontWeight, letterSpacing: s.letterSpacing })
/** 去掉 **关键词** 标记，返回纯文字和关键词区间 */
export function parseMarks(content: string): { plain: string; marks: [number, number][] } {
  const marks: [number, number][] = []
  let plain = ''
  const parts = content.split('**')
  // 不成对的 ** 原样保留
  const usable = parts.length % 2 === 1 ? parts : [...parts.slice(0, -2), `${parts[parts.length - 2]}**${parts[parts.length - 1]}`]
  usable.forEach((part, i) => {
    if (i % 2 === 1 && part) marks.push([plain.length, plain.length + part.length])
    plain += part
  })
  return { plain, marks }
}

const run = (s: ReplayStyle, x: number, y: number, w: number, content: string, override: Partial<ReplayStyle> = {}, markColor?: string): TextRun => {
  const st = { ...s, ...override }
  const f = font(st)
  const { plain, marks } = parseMarks(content)
  // 关键词加粗后会略宽：留一点余量，避免超出行宽
  const lines = wrapText(plain, f, marks.length ? w * 0.97 : w)
  const out: TextRun = { x, y, w, lines, font: f, color: st.color, lineHeight: Math.round(st.fontSize * st.lineHeight), align: st.align }
  if (marks.length) {
    let cursor = 0
    out.starts = lines.map((l) => {
      const i = plain.indexOf(l, cursor)
      const at = i < 0 ? cursor : i
      cursor = at + l.length
      return at
    })
    out.marks = marks
    out.markColor = markColor
  }
  return out
}
export const runHeight = (r: TextRun | undefined) => (r ? r.lines.length * r.lineHeight : 0)

// ---------- 单个元素的尺寸 ----------

const INLINE: Partial<Record<ReplayItemType, string>> = { tag: 'tag', button: 'button', stat: 'stat' }
const MARGIN: Record<ReplayItemType, number> = { title: 18, subtitle: 14, text: 22, image: 30, tag: 26, button: 36, stat: 36, quote: 30, divider: 30, shape: 24 }

/** 在给定宽度内排一个元素；返回相对 (0,0) 的布局，调用方再平移 */
function measureItem(item: ReplayItem, index: number, doc: ReplayDoc, w: number, outline = false): LaidItem {
  const s = resolveStyle(item, doc, outline)
  const box = { x: 0, y: 0, w, h: 0 }
  const out: LaidItem = { item, index, box, style: s, ...(outline && { outline }) }
  switch (item.type) {
    case 'title':
    case 'subtitle':
    case 'text': {
      const card = !!s.fill || !!s.stroke
      const pad = card ? 28 : 0
      let y = pad
      if (item.label && card) {
        out.label = run(s, pad, y, w - pad * 2, item.label, { color: doc.theme.accent, fontSize: 20, fontWeight: 700, letterSpacing: 2, lineHeight: 1.4, align: 'left' })
        y += runHeight(out.label) + 12
      }
      out.text = run(s, pad, y, w - pad * 2, item.content, {}, doc.theme.accent)
      box.h = y + runHeight(out.text) + pad
      break
    }
    case 'quote': {
      out.text = run(s, 30, 4, w - 30, item.content, {}, doc.theme.accent)
      let h = 4 + runHeight(out.text)
      if (item.label) {
        out.label = run(s, 30, h + 10, w - 30, `— ${item.label}`, { color: mix(s.color, baseColor(doc), 0.35), fontSize: 22, lineHeight: 1.5, letterSpacing: 1 })
        h += 10 + runHeight(out.label)
      }
      box.h = h + 4
      break
    }
    case 'tag':
    case 'button': {
      const padX = item.type === 'tag' ? 18 : 40
      const padY = item.type === 'tag' ? 9 : 18
      const f = font(s)
      const one = wrapText(item.content, f, Math.max(40, w - padX * 2))
      const tw = Math.max(...one.map((l) => measureLine(l, f)))
      box.w = Math.min(w, Math.ceil(tw) + padX * 2)
      out.text = { x: padX, y: padY, w: box.w - padX * 2, lines: one, font: f, color: s.color, lineHeight: Math.round(s.fontSize * s.lineHeight), align: 'center' }
      box.h = padY * 2 + runHeight(out.text)
      break
    }
    case 'stat': {
      const pad = 22
      out.text = run(s, pad, pad, w - pad * 2, item.content)
      const lh = runHeight(out.text)
      out.label = item.label ? run(s, pad, pad + lh + 6, w - pad * 2, item.label, { color: mix(doc.theme.text, baseColor(doc), 0.35), fontSize: 22, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 }) : undefined
      box.h = pad * 2 + lh + (out.label ? 6 + runHeight(out.label) : 0)
      break
    }
    case 'image': {
      const ratio = item.image?.width && item.image?.height ? item.image.height / item.image.width : 0.56
      box.h = Math.round(Math.min(900, Math.max(160, w * ratio)))
      if (item.label) {
        out.label = run(s, 0, box.h + 12, w, item.label, { fontSize: 22, lineHeight: 1.5, align: 'center' })
        box.h += 12 + runHeight(out.label)
      }
      break
    }
    case 'divider':
      box.h = 2
      break
    case 'shape':
      if (item.content === 'circle' || item.content === 'ring') {
        box.w = Math.min(w, 96)
        box.h = 96
      } else {
        box.w = Math.min(w, 120)
        box.h = 10
      }
      break
  }
  return out
}

const measureLine = (line: string, f: FontSpec) => replayEnv().measure(line, f)

function shift(l: LaidItem, dx: number, dy: number): LaidItem {
  l.box.x += dx
  l.box.y += dy
  for (const r of [l.text, l.label]) {
    if (!r) continue
    r.x += dx
    r.y += dy
  }
  return l
}

// ---------- 场景布局 ----------

export function layoutScene(scene: ReplayScene, doc: ReplayDoc): SceneLayout {
  return scene.layout === 'absolute' ? layoutAbsolute(scene, doc) : layoutFlow(scene, doc)
}

function layoutAbsolute(scene: ReplayScene, doc: ReplayDoc): SceneLayout {
  let y = scene.padding ?? PAD_TOP
  const items = scene.items.map((item, i) => {
    const f = item.frame ?? { x: PAD_X, y, w: CONTENT_W }
    const l = measureItem(item, i, doc, f.w)
    if (f.h) l.box.h = f.h
    if (item.type === 'tag' || item.type === 'button' || item.type === 'shape') l.box.w = Math.min(l.box.w, f.w)
    shift(l, f.x, f.y)
    y = Math.max(y, l.box.y + l.box.h + MARGIN[item.type])
    return l
  })
  const bottom = Math.max(0, ...items.map((l) => l.box.y + l.box.h))
  const height = scene.height ?? Math.max(1100, bottom + (scene.padding ?? PAD_BOTTOM))
  return { items, height, overflow: bottom > height }
}

function layoutFlow(scene: ReplayScene, doc: ReplayDoc): SceneLayout {
  const out: LaidItem[] = []
  let y = scene.padding ?? PAD_TOP
  let i = 0
  const list = scene.items
  while (i < list.length) {
    const item = list[i]
    const family = INLINE[item.type]
    if (out.length) y += scene.gap ?? MARGIN[item.type]
    if (!family) {
      const l = measureItem(item, i, doc, CONTENT_W)
      out.push(shift(l, PAD_X + alignOffset(l, CONTENT_W), y))
      y += l.box.h
      i++
      continue
    }
    // 同类行内元素（标签 / 按钮 / 数据卡）连成一行
    let j = i
    while (j < list.length && INLINE[list[j].type] === family) j++
    const group = list.slice(i, j)
    if (family === 'stat') y = flowStats(group, i, doc, y, out)
    else y = flowPills(group, i, doc, y, out)
    i = j
  }
  const bottom = y
  // 设置了留白的场景（如逐段打字的正文）按内容定高，不套用一屏的最小高度
  const height = scene.height ?? (scene.padding !== undefined ? Math.ceil(bottom + scene.padding) : Math.max(MIN_FLOW_HEIGHT, Math.ceil(bottom + PAD_BOTTOM)))
  return { items: out, height, overflow: bottom > height }
}

const alignOffset = (l: LaidItem, w: number) => (l.item.type === 'shape' ? (l.style.align === 'center' ? (w - l.box.w) / 2 : l.style.align === 'right' ? w - l.box.w : 0) : 0)

/** 数据卡：每行最多 3 个，等宽，同一行等高 */
function flowStats(group: ReplayItem[], start: number, doc: ReplayDoc, y: number, out: LaidItem[]): number {
  for (let k = 0; k < group.length; k += 3) {
    const row = group.slice(k, k + 3)
    const gap = 20
    const w = (CONTENT_W - gap * (row.length - 1)) / row.length
    const laid = row.map((it, n) => measureItem(it, start + k + n, doc, w))
    const h = Math.max(...laid.map((l) => l.box.h))
    laid.forEach((l, n) => {
      l.box.h = h
      out.push(shift(l, PAD_X + n * (w + gap), y))
    })
    y += h + (k + 3 < group.length ? gap : 0)
  }
  return y
}

/** 标签和按钮：按文字宽度排成一行，放不下时换行；第二个起默认描边样式 */
function flowPills(group: ReplayItem[], start: number, doc: ReplayDoc, y: number, out: LaidItem[]): number {
  const gap = group[0].type === 'tag' ? 14 : 22
  const align = group[0].style?.align ?? 'left'
  let row: LaidItem[] = []
  let rowW = 0
  const flush = () => {
    if (!row.length) return
    const h = Math.max(...row.map((l) => l.box.h))
    let x = PAD_X + (align === 'center' ? (CONTENT_W - rowW) / 2 : align === 'right' ? CONTENT_W - rowW : 0)
    for (const l of row) {
      shift(l, x, y + (h - l.box.h) / 2)
      x += l.box.w + gap
      out.push(l)
    }
    y += h + ROW_GAP
    row = []
    rowW = 0
  }
  group.forEach((it, n) => {
    const l = measureItem(it, start + n, doc, CONTENT_W, n > 0)
    const next = rowW ? rowW + gap + l.box.w : l.box.w
    if (next > CONTENT_W && row.length) flush()
    rowW = rowW ? rowW + gap + l.box.w : l.box.w
    row.push(l)
  })
  flush()
  return y - ROW_GAP
}
