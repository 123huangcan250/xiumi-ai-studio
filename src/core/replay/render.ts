// 场景渲染：每个场景是一个独立的 <svg>（宽 750），自带时间轴；图层顺序为 背景 → 元素 → 光标（最上层）。
import { css } from '../style'
import { planCursors, renderCursors, type CursorPlan } from './cursors'
import { drawRun, el, type RenderCtx } from './draw'
import { gradientBands, mix } from './layout'
import { estimateBytes, lintReplaySvg } from './lint'
import { renderItem } from './presets'
import { scheduleScene, type Timeline } from './schedule'
import type { PlayMode } from './smil'
import type { ReplayDoc, ReplayScene } from './types'

export interface ReplayRenderOptions {
  mapImage?: (url: string) => string
  /** 覆盖 doc.cursors.show（预览器的“显示/隐藏光标层”与解耦测试） */
  showCursors?: boolean
  /** 生成 id 的前缀（方案 A），同一文章内多个回放模块不能重复 */
  idPrefix?: string
}

export interface SceneOutput {
  svg: string
  height: number
  timeline: Timeline
  plan: CursorPlan
  /** 元素全部完成 */
  end: number
  /** 含光标离场 / swarm 的总时长 */
  total: number
  /** 循环模式的一个周期 */
  cycle?: number
  /** 估算的发布后体积（字节） */
  bytes: number
  /** 只含元素层（解耦测试用） */
  itemLayer: string
}

export interface ReplayOutput {
  html: string
  scenes: SceneOutput[]
  errors: string[]
  warnings: string[]
}

/** 打字光标闪烁等收尾的余量 */
const TAIL = 0.4

export function renderReplay(doc: ReplayDoc, opts: ReplayRenderOptions = {}): ReplayOutput {
  const warnings = new Set<string>()
  const errors = new Set<string>()
  const idsAllowed = doc.playback.trigger === 'tap'
  const prefix = (opts.idPrefix ?? 'rp').replace(/[^\w-]/g, '').slice(0, 16) || 'rp'
  const scenes = doc.scenes.map((scene, i) => renderScene(scene, doc, { ...opts, idsAllowed, sid: `${prefix}${i}`, warn: (m) => warnings.add(m) }))
  // 整个模块一起检查，同类问题合并成一条
  const lint = lintReplaySvg(scenes.map((s) => s.svg).join(''), { idsAllowed })
  lint.errors.forEach((e) => errors.add(e))
  lint.warnings.forEach((w) => warnings.add(w))
  let total = 0
  scenes.forEach((s, i) => {
    total += s.bytes
    if (s.bytes > doc.budget.sceneKB * 1024) warnings.add(`场景 ${i + 1} 约 ${kb(s.bytes)}，超过单场景预算 ${doc.budget.sceneKB} KB`)
    if (s.timeline.overflow) warnings.add(`场景 ${i + 1} 的内容超出了设定的高度`)
    if (s.plan.unassigned.length) warnings.add(`场景 ${i + 1} 有 ${s.plan.unassigned.length} 个元素没有空闲光标演示（元素照常出现），可增加光标数量`)
    // 逐段打字的正文（不显示光标）按字数计时，不受 6 秒建议限制
    const own = s.end - (doc.playback.start ?? 0)
    if (own > 6 && doc.cursors.show) warnings.add(`场景 ${i + 1} 播放 ${own.toFixed(1)} 秒才完成，建议控制在 6 秒内（减少元素或换快节奏）`)
  })
  if (total > doc.budget.totalKB * 1024) warnings.add(`编辑回放整体约 ${kb(total)}，超过预算 ${doc.budget.totalKB} KB`)
  const empty = doc.scenes.flatMap((s) => s.items).filter((it) => it.type === 'image' && !it.image?.src).length
  if (empty) warnings.add(`有 ${empty} 个图片元素还没选图，导出时显示为占位框`)
  const html = `<section style="${css({ 'line-height': 0, 'font-size': 0 })}">${scenes.map((s) => s.svg).join('')}</section>`
  return { html, scenes, errors: [...errors], warnings: [...warnings] }
}

const kb = (b: number) => `${Math.round(b / 102.4) / 10} KB`

type SceneOpts = ReplayRenderOptions & { idsAllowed: boolean; sid: string; warn: (m: string) => void }

export function renderScene(scene: ReplayScene, doc: ReplayDoc, o: SceneOpts): SceneOutput {
  const timeline = scheduleScene(scene, doc)
  const plan = planCursors(timeline, doc, scene)
  const H = timeline.height
  const end = timeline.end
  const total = Math.max(end + TAIL, plan.end)
  const loop = doc.playback.loop
  const cycle = loop ? Math.round((total + loop.hold) * 1000) / 1000 : undefined
  const mode: PlayMode = o.idsAllowed ? { kind: 'tap', trigger: o.sid, cycle } : cycle ? { kind: 'loop', cycle } : { kind: 'once' }
  const ctx: RenderCtx = { doc, mode, sceneHeight: H, idsAllowed: o.idsAllowed, sid: o.sid, img: o.mapImage ?? ((u) => u), warn: o.warn }

  const itemLayer = timeline.items.map((ti) => renderItem(ti, ctx)).join('')
  const show = o.showCursors ?? doc.cursors.show
  const cursorLayer = show ? renderCursors(plan, ctx) : ''
  // 方案 A：点击前隐藏元素和光标，显示“点击开始”；透明的点击区域放在最上面
  const hide = o.idsAllowed ? `<set attributeName="opacity" to="0" begin="0s" end="${o.sid}.click"/>` : ''
  const layers = `<g>${hide}${itemLayer}</g>` + (cursorLayer ? `<g>${hide}${cursorLayer}</g>` : '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 ${H}" width="100%" style="${css({ display: 'block', width: '100%' })}">` +
    background(doc, H, ctx) +
    layers +
    (o.idsAllowed ? tapTrigger(ctx, H) : '') +
    `</svg>`
  return { svg, height: H, timeline, plan, end, total, cycle, bytes: estimateBytes(svg), itemLayer }
}

/** 背景板：纯色 / 渐变 / 背景图，可叠加蓝图网格 */
function background(doc: ReplayDoc, H: number, ctx: RenderCtx): string {
  const bg = doc.canvas.background
  let out: string
  if (bg.type === 'color') out = el('rect', { width: 750, height: H, fill: bg.value })
  else if (bg.type === 'gradient') {
    const stops = bg.value.split(',')
    if (ctx.idsAllowed) {
      const id = `${ctx.sid}g`
      out =
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map((c, i) => el('stop', { offset: stops.length > 1 ? i / (stops.length - 1) : 0, 'stop-color': c })).join('')}</linearGradient></defs>` +
        el('rect', { width: 750, height: H, fill: `url(#${id})` })
    } else {
      // 不依赖 id：横向色带近似渐变
      out = gradientBands(doc, H)!
        .map((b) => el('rect', { y: b.y, width: 750, height: b.h, fill: b.color }))
        .join('')
    }
  } else {
    out = el('rect', { width: 750, height: H, fill: '#000000' })
    if (bg.image?.src) {
      const src = bg.image.src.startsWith('/media/') ? `${bg.image.src.split('?')[0]}?w=1500` : bg.image.src
      out += el('image', { href: ctx.img(src), width: 750, height: H, preserveAspectRatio: 'xMidYMid slice' })
    }
  }
  if (bg.grid) {
    const s = bg.grid.size
    let d = ''
    for (let x = s; x < 750; x += s) d += `M${x} 0V${H}`
    for (let y = s; y < H; y += s) d += `M0 ${y}H750`
    out += el('path', { d, stroke: bg.grid.color, 'stroke-width': 1, fill: 'none' })
  }
  return out
}

function tapTrigger(ctx: RenderCtx, H: number): string {
  const { accent } = ctx.doc.theme
  const w = 300
  const x = (750 - w) / 2
  const y = H / 2 - 36
  const prompt =
    el('rect', { x, y, width: w, height: 72, rx: 36, fill: accent }) +
    drawRun({ x, y, w, lines: ['▶  点击开始回放'], font: { size: 26, weight: 700, letterSpacing: 2 }, color: mix(accent, '#000000', 0.8), lineHeight: 72, align: 'center' }, ctx).join('')
  return `<g opacity="0"><set attributeName="opacity" to="1" begin="0s" end="${ctx.sid}.click"/>${prompt}</g>` + el('rect', { id: ctx.sid, width: 750, height: H, fill: '#000000', 'fill-opacity': 0 })
}

/** 画布定格时间：元素全部完成、光标离场（或 swarm 散开）之后 */
export function replayFinalTimes(doc: ReplayDoc): number[] {
  return doc.scenes.map((s) => {
    const tl = scheduleScene(s, doc)
    return Math.max(tl.end + TAIL, planCursors(tl, doc, s).end)
  })
}
