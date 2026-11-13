// 绘制基础：渲染上下文、SVG 属性序列化、文字（栅格图或 <text>）与元素静态外观。
import { esc } from '../style'
import { backgroundAt, baseColor, mix, type TextRun } from './layout'
import type { TimedItem } from './schedule'
import { smil, type AnimSpec, type PlayMode } from './smil'
import { baseline, FONT_FAMILY, replayEnv, type Segment } from './text'
import type { ReplayDoc } from './types'

export interface RenderCtx {
  doc: ReplayDoc
  mode: PlayMode
  sceneHeight: number
  /** 方案 A：允许 id 与 url(#id) */
  idsAllowed: boolean
  /** 场景内唯一前缀（id 用） */
  sid: string
  /** 图片地址映射（导出管线的 mapImage） */
  img: (url: string) => string
  warn: (msg: string) => void
}

export type Attrs = Record<string, string | number | undefined | false | null>

/** SVG 展示属性序列化：只写有值的属性，数字保留两位小数 */
export function attrs(a: Attrs): string {
  let out = ''
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false || v === '') continue
    out += ` ${k}="${typeof v === 'number' ? Math.round(v * 100) / 100 : esc(v)}"`
  }
  return out
}

export const el = (tag: string, a: Attrs, inner = '') => (inner ? `<${tag}${attrs(a)}>${inner}</${tag}>` : `<${tag}${attrs(a)}/>`)

/** 带动画的分组：anims 为空时直接返回内容，减少体积 */
export function group(ctx: RenderCtx, a: Attrs, anims: (AnimSpec | null | false | undefined)[], inner: string): string {
  if (!inner) return ''
  const s = anims.filter((x): x is AnimSpec => !!x).map((x) => smil(x, ctx.mode)).join('')
  if (!s && !Object.values(a).some((v) => v !== undefined && v !== null && v !== false && v !== '')) return inner
  return `<g${attrs(a)}>${s}${inner}</g>`
}

/** 给单个图形元素加动画（动画作为子元素） */
export function shape(tag: string, a: Attrs, ctx: RenderCtx, anims: (AnimSpec | null | false | undefined)[]): string {
  const s = anims.filter((x): x is AnimSpec => !!x).map((x) => smil(x, ctx.mode)).join('')
  return s ? `<${tag}${attrs(a)}>${s}</${tag}>` : `<${tag}${attrs(a)}/>`
}

// ---------- 文字 ----------

/** 某一行按关键词切成的片段；color 覆盖时（如故障副本）整行同色 */
export function lineSegments(run: TextRun, i: number, color?: string): Segment[] {
  const line = run.lines[i] ?? ''
  const base: Segment = { text: line, color: color ?? run.color, weight: run.font.weight }
  if (!run.marks?.length || !run.starts) return [base]
  const from = run.starts[i]
  const to = from + line.length
  const out: Segment[] = []
  let at = from
  for (const [a, b] of run.marks) {
    const s = Math.max(a, from)
    const e = Math.min(b, to)
    if (s >= e) continue
    if (s > at) out.push({ ...base, text: line.slice(at - from, s - from) })
    out.push({ text: line.slice(s - from, e - from), color: color ?? run.markColor ?? run.color, weight: 700 })
    at = e
  }
  if (at < to) out.push({ ...base, text: line.slice(at - from) })
  return out.length ? out : [base]
}

/** 关键词的位置（逐行），用于画荧光笔底纹 */
export function markSpans(run: TextRun): { x: number; y: number; w: number; h: number; line: number }[] {
  if (!run.marks?.length) return []
  const env = replayEnv()
  const out: { x: number; y: number; w: number; h: number; line: number }[] = []
  run.lines.forEach((_, i) => {
    const segs = lineSegments(run, i)
    const widths = segs.map((g) => env.measure(g.text, { ...run.font, weight: g.weight }))
    const total = widths.reduce((a, b) => a + b, 0)
    let x = run.align === 'center' ? run.x + (run.w - total) / 2 : run.align === 'right' ? run.x + run.w - total : run.x
    segs.forEach((g, j) => {
      if (g.weight === 700 && run.font.weight !== 700 && g.text.trim()) out.push({ x, y: run.y + i * run.lineHeight, w: widths[j], h: run.lineHeight, line: i })
      x += widths[j]
    })
  })
  return out
}

/** 荧光笔底纹：压在关键词下半部 */
export const markerAttrs = (m: { x: number; y: number; w: number; h: number }, color: string) => ({
  x: m.x - 2,
  y: m.y + m.h * 0.55,
  width: m.w + 4,
  height: m.h * 0.3,
  rx: 3,
  fill: color,
  'fill-opacity': 0.22,
})

/** 一行或整段文字的绘制结果：整体一个元素，或逐行元素（逐行出现时使用） */
export function drawRun(run: TextRun, ctx: RenderCtx, opts: { color?: string; perLine?: boolean; lines?: string[] } = {}): string[] {
  const lines = opts.lines ?? run.lines
  const color = opts.color ?? run.color
  const lh = run.lineHeight
  const env = replayEnv()
  if (ctx.doc.textMode === 'image' && env.rasterize) {
    // first：ls 第一行在 run.lines 里的序号（逐行绘制时用于找关键词）
    const raster = (ls: string[], y: number, first: number) => {
      const segments = run.marks?.length && !opts.lines ? ls.map((_, k) => lineSegments(run, first + k, opts.color)) : undefined
      const url = env.rasterize!({ ...run.font, lines: ls, color, lineHeight: lh, width: run.w, height: ls.length * lh, align: run.align, ...(segments && { segments }) })
      return url ? el('image', { href: ctx.img(url), x: run.x, y, width: run.w, height: ls.length * lh }) : null
    }
    const out = opts.perLine ? lines.map((l, i) => raster([l], run.y + i * lh, i)) : [raster(lines, run.y, 0)]
    if (out.every(Boolean)) return out as string[]
  }
  if (ctx.doc.textMode === 'image') ctx.warn('当前环境不能把文字栅格化，已临时改用 svg-text 输出')
  const anchor = run.align === 'center' ? 'middle' : run.align === 'right' ? 'end' : undefined
  const x = run.align === 'center' ? run.x + run.w / 2 : run.align === 'right' ? run.x + run.w : run.x
  const base = baseline(run.font.size, lh)
  const tspans = (l: string, i: number) => {
    if (!run.marks?.length || opts.lines) return esc(l) || ' '
    return lineSegments(run, i, opts.color)
      .map((g) => (g.weight === 700 && run.font.weight !== 700 ? `<tspan font-weight="bold"${g.color !== color ? ` fill="${g.color}"` : ''}>${esc(g.text)}</tspan>` : esc(g.text)))
      .join('')
  }
  const text = (l: string, i: number) =>
    el(
      'text',
      {
        x,
        y: run.y + base + i * lh,
        'font-size': run.font.size,
        'font-weight': run.font.weight === 700 ? 'bold' : undefined,
        'font-family': FONT_FAMILY,
        'letter-spacing': run.font.letterSpacing || undefined,
        'text-anchor': anchor,
        fill: color,
      },
      tspans(l, i),
    )
  return lines.map(text)
}

/** 文字某一行的实际起点与宽度（打字遮挡、选中高亮用） */
export function lineBox(run: TextRun, i: number): { x: number; y: number; w: number; h: number } {
  const w = Math.min(run.w, replayEnv().measure(run.lines[i] ?? '', run.font))
  const x = run.align === 'center' ? run.x + (run.w - w) / 2 : run.align === 'right' ? run.x + run.w - w : run.x
  return { x, y: run.y + i * run.lineHeight, w, h: run.lineHeight }
}

// ---------- 元素静态外观（终态） ----------

const rectR = (h: number, r: number) => Math.min(r, h / 2)

/** 卡片、按钮、标签、数据卡的底框 */
export function frameRect(ti: TimedItem): string {
  const { box, style } = ti
  if (!style.fill && !style.stroke) return ''
  return el('rect', {
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    rx: rectR(box.h, style.radius) || undefined,
    fill: style.fill || 'none',
    stroke: style.stroke || undefined,
    'stroke-width': style.stroke ? 2 : undefined,
  })
}

/** 元素完整外观；text 可替换为逐行绘制或改色版本 */
export function itemBody(ti: TimedItem, ctx: RenderCtx, opts: { textOverride?: string; color?: string; noFrame?: boolean } = {}): string {
  const { item, box, style } = ti
  const parts: string[] = []
  const frame = opts.noFrame ? '' : frameRect(ti)
  switch (item.type) {
    case 'quote':
      if (!opts.noFrame) parts.push(el('rect', { x: box.x, y: box.y, width: 6, height: box.h, fill: style.stroke || ctx.doc.theme.accent }))
      break
    case 'image':
      parts.push(imageBody(ti, ctx))
      break
    case 'divider':
      parts.push(el('rect', { x: box.x, y: box.y, width: box.w, height: 2, fill: style.stroke }))
      break
    case 'shape':
      parts.push(shapeBody(ti))
      break
    default:
      parts.push(frame)
  }
  if (ti.label && item.type !== 'image') parts.push(...drawRun(ti.label, ctx, { color: opts.color }))
  if (opts.textOverride !== undefined) parts.push(opts.textOverride)
  else if (ti.text) {
    // 关键词的荧光笔底纹（终态）；故障副本等改色版本不画
    if (!opts.color) parts.push(...markSpans(ti.text).map((m) => el('rect', markerAttrs(m, ti.text!.markColor ?? ctx.doc.theme.accent))))
    parts.push(...drawRun(ti.text, ctx, { color: opts.color }))
  }
  if (ti.label && item.type === 'image') parts.push(...drawRun(ti.label, ctx, { color: opts.color }))
  return parts.join('')
}

function shapeBody(ti: TimedItem): string {
  const { box, style, item } = ti
  if (item.content === 'circle') return el('circle', { cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: Math.min(box.w, box.h) / 2, fill: style.fill || style.color })
  if (item.content === 'ring') return el('circle', { cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: Math.min(box.w, box.h) / 2 - 3, fill: 'none', stroke: style.fill || style.color, 'stroke-width': 4 })
  return el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: rectR(box.h, style.radius) || undefined, fill: style.fill || style.color })
}

/** 图片：slice 裁切（image 元素自带视口裁切，不需要 clipPath）；没有图片时画蓝图占位框 */
function imageBody(ti: TimedItem, ctx: RenderCtx): string {
  const { box, item, style } = ti
  const h = ti.label ? ti.label.y - 12 - box.y : box.h
  if (item.image?.src) {
    const src = item.image.src.startsWith('/media/') ? `${item.image.src.split('?')[0]}?w=1500` : item.image.src
    return (
      el('image', { href: ctx.img(src), x: box.x, y: box.y, width: box.w, height: h, preserveAspectRatio: 'xMidYMid slice' }) +
      (style.stroke ? el('rect', { x: box.x, y: box.y, width: box.w, height: h, fill: 'none', stroke: style.stroke, 'stroke-width': 2 }) : '')
    )
  }
  const accent = ctx.doc.theme.accent
  const bg = baseColor(ctx.doc)
  const line = mix(bg, accent, 0.35)
  return (
    el('rect', { x: box.x, y: box.y, width: box.w, height: h, fill: mix(bg, accent, 0.06), stroke: line, 'stroke-width': 2, 'stroke-dasharray': '10 8' }) +
    el('path', { d: `M${box.x} ${box.y}L${box.x + box.w} ${box.y + h}M${box.x + box.w} ${box.y}L${box.x} ${box.y + h}`, stroke: line, 'stroke-width': 1 }) +
    drawRun({ x: box.x, y: box.y + h / 2 - 16, w: box.w, lines: [`IMAGE  ${Math.round(box.w)} × ${Math.round(h)}`], font: { size: 22, weight: 700, letterSpacing: 3 }, color: mix(bg, accent, 0.7), lineHeight: 32, align: 'center' }, ctx).join('')
  )
}

/** 打字遮挡的颜色：元素自身底色 → 场景背景色；背景图时返回 null（改为逐行出现） */
export function coverColor(ti: TimedItem, ctx: RenderCtx, y: number): string | null {
  if (ti.style.fill) return ti.style.fill
  return backgroundAt(ctx.doc, y, ctx.sceneHeight)
}

/** 稳定的伪随机数（同一输入输出一致，保证截图可复现） */
export function rand(seed: number) {
  let s = (seed * 9301 + 49297) % 233280
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}
