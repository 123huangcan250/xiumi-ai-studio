// 绘制基础：渲染上下文、SVG 属性序列化、文字（栅格图或 <text>）与元素静态外观。
import { esc } from '../style'
import { backgroundAt, baseColor, mix, type TextRun } from './layout'
import type { TimedItem } from './schedule'
import { smil, type AnimSpec, type PlayMode } from './smil'
import { baseline, FONT_FAMILY, replayEnv } from './text'
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

/** 一行或整段文字的绘制结果：整体一个元素，或逐行元素（逐行出现时使用） */
export function drawRun(run: TextRun, ctx: RenderCtx, opts: { color?: string; perLine?: boolean; lines?: string[] } = {}): string[] {
  const lines = opts.lines ?? run.lines
  const color = opts.color ?? run.color
  const lh = run.lineHeight
  const env = replayEnv()
  if (ctx.doc.textMode === 'image' && env.rasterize) {
    const raster = (ls: string[], y: number) => {
      const url = env.rasterize!({ ...run.font, lines: ls, color, lineHeight: lh, width: run.w, height: ls.length * lh, align: run.align })
      return url ? el('image', { href: ctx.img(url), x: run.x, y, width: run.w, height: ls.length * lh }) : null
    }
    const out = opts.perLine ? lines.map((l, i) => raster([l], run.y + i * lh)) : [raster(lines, run.y)]
    if (out.every(Boolean)) return out as string[]
  }
  if (ctx.doc.textMode === 'image') ctx.warn('当前环境不能把文字栅格化，已临时改用 svg-text 输出')
  const anchor = run.align === 'center' ? 'middle' : run.align === 'right' ? 'end' : undefined
  const x = run.align === 'center' ? run.x + run.w / 2 : run.align === 'right' ? run.x + run.w : run.x
  const base = baseline(run.font.size, lh)
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
      esc(l) || ' ',
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
  else if (ti.text) parts.push(...drawRun(ti.text, ctx, { color: opts.color }))
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
