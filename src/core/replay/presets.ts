// 进场预设库：renderItem 只根据元素自己的 tStart / tEnd 生成进场动画，完全不读光标数据。
// 每种预设都不依赖 id：遮挡用同色矩形，裁切用 image 自带视口，抖动用 discrete 关键帧。
import { coverColor, drawRun, el, group, itemBody, lineBox, markerAttrs, markSpans, rand, shape, type RenderCtx } from './draw'
import { gradientBands } from './layout'
import { paceTable, PACE_SCALE } from './pace'
import type { TimedItem } from './schedule'
import type { AnimSpec, Key } from './smil'
import type { EnterPreset } from './types'

type Renderer = (ti: TimedItem, ctx: RenderCtx) => string

const fade = (t0: number, t1: number, from = 0, to = 1): AnimSpec => ({ attr: 'opacity', keys: [{ t: t0, v: from }, { t: t1, v: to, ease: 'out' }] })
/** 先出现、保持、最后淡出（辅助图形：线框、选框、尺寸标签） */
const flash = (t0: number, hold: number, t1: number, fadeOut = 0.1): AnimSpec => ({
  attr: 'opacity',
  keys: [{ t: t0 - 0.001, v: 0 }, { t: t0, v: 1 }, { t: Math.max(t0 + 0.002, Math.min(hold, t1 - fadeOut)), v: 1 }, { t: t1, v: 0, ease: 'linear' }],
})
/**
 * 以 (cx, cy) 为中心缩放。animateTransform 会替换所在元素的 transform 属性，
 * 所以静态平移和每个变换动画各占一层分组，互不覆盖。
 */
const scaleAround = (ctx: RenderCtx, cx: number, cy: number, keys: Key[], inner: string, extra: AnimSpec[] = []) =>
  `<g transform="translate(${r2(cx)} ${r2(cy)})">${group(ctx, {}, [{ attr: 'transform', transform: 'scale', keys }], `<g transform="translate(${r2(-cx)} ${r2(-cy)})">${group(ctx, {}, extra, inner)}</g>`)}</g>`
const r2 = (v: number) => Math.round(v * 100) / 100
const k = (ctx: RenderCtx) => PACE_SCALE[ctx.doc.playback.pace] ?? 1

// ---------- inspect-draw：线框描边 → 四角方块 → 尺寸标签 → 内容淡入，线框淡出 ----------

const inspectDraw: Renderer = (ti, ctx) => {
  const { box, tStart: s, tEnd: e } = ti
  const p = paceTable(ctx.doc.playback.pace)
  const { inspector } = ctx.doc.theme
  const m = 6
  const x = box.x - m
  const y = box.y - m
  const w = box.w + m * 2
  const h = box.h + m * 2
  const perim = Math.round(2 * (w + h))
  const wire = shape('rect', { x, y, width: w, height: h, fill: 'none', stroke: inspector, 'stroke-width': 2, 'stroke-dasharray': perim, opacity: 0 }, ctx, [
    { attr: 'stroke-dashoffset', keys: [{ t: s, v: perim }, { t: s + p.stroke, v: 0, ease: 'out' }] },
    flash(s, e - 0.12, e),
  ])
  const sq = 8
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]
    .map(([cx, cy]) => el('rect', { x: cx - sq / 2, y: cy - sq / 2, width: sq, height: sq, fill: '#ffffff', stroke: inspector, 'stroke-width': 2 }))
    .join('')
  const cornersG = group(ctx, { opacity: 0 }, [flash(s + p.stroke * 0.75, e - 0.12, e)], corners)
  // 尺寸标签：放在线框下方，超出场景时放上方
  const label = `${Math.round(box.w)} × ${Math.round(box.h)}`
  const lw = 18 + label.length * 10
  const ly = y + h + 10 + 30 > ctx.sceneHeight ? y - 40 : y + h + 10
  const lx = Math.min(Math.max(box.x + box.w / 2 - lw / 2, 8), 750 - lw - 8)
  const tag =
    el('rect', { x: lx, y: ly, width: lw, height: 30, rx: 4, fill: inspector }) +
    drawRun({ x: lx, y: ly, w: lw, lines: [label], font: { size: 17, weight: 700, letterSpacing: 0.5 }, color: '#ffffff', lineHeight: 30, align: 'center' }, ctx).join('')
  const tagG = group(ctx, { opacity: 0 }, [flash(s + p.stroke * 0.8, e - 0.12, e)], tag)
  const body = group(ctx, {}, [fade(s + p.stroke * 0.8, s + p.stroke + 0.18)], itemBody(ti, ctx))
  return body + wire + cornersG + tagG
}

// ---------- glitch-settle：内容与红、青偏移副本离散抖动，夹带横向撕裂色条 ----------

const glitchSettle: Renderer = (ti, ctx) => {
  const { box, tStart: s, tEnd: e } = ti
  const d = e - s
  const { alert, accent } = ctx.doc.theme
  const at = (f: number) => s + d * f
  const texty = !!ti.text && ['title', 'subtitle', 'text', 'quote'].includes(ti.item.type)
  const jitter = (dx: number[]): AnimSpec => ({ attr: 'transform', transform: 'translate', discrete: true, keys: [{ t: s - 0.001, v: '0 0' }, ...dx.map((x, i) => ({ t: at(i / dx.length), v: `${x} 0` })), { t: at(0.72), v: '0 0' }] })
  const body = group(
    ctx,
    {},
    [
      { attr: 'opacity', discrete: true, keys: [{ t: s - 0.001, v: 0 }, { t: s, v: 1 }, { t: at(0.14), v: 0.35 }, { t: at(0.24), v: 1 }, { t: at(0.42), v: 0.6 }, { t: at(0.52), v: 1 }] },
      jitter([-9, 7, -4, 5, -2, 1]),
    ],
    itemBody(ti, ctx),
  )
  const copy = (color: string, dx: number[]) => {
    const inner = texty ? itemBody(ti, ctx, { color, noFrame: true }) : el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: 'none', stroke: color, 'stroke-width': 3 })
    return group(ctx, { opacity: 0 }, [{ attr: 'opacity', discrete: true, keys: [{ t: s - 0.001, v: 0 }, { t: s, v: 0.85 }, { t: at(0.72), v: 0 }] }, jitter(dx)], inner)
  }
  // 撕裂色条：位置由元素序号决定，保证每次渲染一致
  const rnd = rand(ti.index + 7)
  const bars = [alert, accent, alert]
    .map((color, i) => {
      const bh = 4 + Math.round(rnd() * 8)
      const by = box.y + rnd() * Math.max(1, box.h - bh)
      const bw = box.w * (0.3 + rnd() * 0.5)
      const bx = box.x + rnd() * (box.w - bw) + (rnd() - 0.5) * 30
      const t0 = at(0.08 + i * 0.18)
      return shape('rect', { x: bx, y: by, width: bw, height: bh, fill: color, opacity: 0 }, ctx, [{ attr: 'opacity', discrete: true, keys: [{ t: t0 - 0.001, v: 0 }, { t: t0, v: 0.9 }, { t: t0 + 0.06 * k(ctx), v: 0 }] }])
    })
    .join('')
  return copy(alert, [7, -6, 4, -5, 2, -1]) + copy(accent, [-6, 8, -3, 4, -2, 1]) + body + bars
}

// ---------- type-on：同色遮挡矩形逐字缩短 + 闪烁光标；背景是图片时改为逐行出现 ----------

const typeOn: Renderer = (ti, ctx) => {
  const run = ti.text
  if (!run) return pop(ti, ctx)
  const { tStart: s, tEnd: e } = ti
  const typing = Math.max(0.2, e - s - 0.12 * k(ctx))
  const counts = run.lines.map((l) => Math.max(1, [...l].length))
  const total = counts.reduce((a, b) => a + b, 0)
  let t = s + 0.06
  const spans = run.lines.map((_, i) => {
    const t0 = t
    t += (typing * counts[i]) / total
    return { t0, t1: t, ...lineBox(run, i) }
  })
  const solid = spans.every((sp) => coverColor(ti, ctx, sp.y + sp.h / 2))
  // 框、小标题等先出现，文字靠遮挡逐字露出
  const frame = group(ctx, {}, [fade(s, s + 0.1)], itemBody(ti, ctx, { textOverride: '' }))
  let text: string
  if (solid) {
    // 渐变背景由色带拼成：遮挡也按色带切成几段，每段用所在色带的颜色，不会露出一条暗边
    const bands = ti.style.fill ? null : gradientBands(ctx.doc, ctx.sceneHeight)
    const covers = spans
      .map((sp) => {
        const pad = 4
        const strips = bands
          ? bands.filter((b) => b.y < sp.y + sp.h && b.y + b.h > sp.y).map((b) => ({ y: Math.max(b.y, sp.y), h: Math.min(b.y + b.h, sp.y + sp.h) - Math.max(b.y, sp.y), color: b.color }))
          : [{ y: sp.y, h: sp.h, color: coverColor(ti, ctx, sp.y + sp.h / 2)! }]
        return strips
          .map((st) =>
            shape('rect', { x: sp.x + sp.w + pad, y: st.y, width: 0, height: st.h, fill: st.color }, ctx, [
              { attr: 'x', keys: [{ t: sp.t0, v: sp.x - pad }, { t: sp.t1, v: sp.x + sp.w + pad, ease: 'linear' }] },
              { attr: 'width', keys: [{ t: sp.t0, v: sp.w + pad * 2 }, { t: sp.t1, v: 0, ease: 'linear' }] },
            ]),
          )
          .join('')
      })
      .join('')
    // 遮挡块会盖住背景网格：在这几行上补画网格线，打字时不露出一块“没有网格”的空白
    const grid = ctx.doc.canvas.background.grid
    let gridOver = ''
    if (grid && !ti.style.fill) {
      const g = grid.size
      for (const sp of spans) {
        const x0 = sp.x - 4
        const x1 = Math.max(sp.x + sp.w + 4, x0)
        for (let x = Math.ceil(x0 / g) * g; x <= x1; x += g) gridOver += `M${x} ${sp.y}V${sp.y + sp.h}`
        for (let y = Math.ceil(sp.y / g) * g; y < sp.y + sp.h; y += g) gridOver += `M${Math.round(x0)} ${y}H${Math.round(x1)}`
      }
    }
    text = drawRun(run, ctx).join('') + covers + (gridOver ? el('path', { d: gridOver, stroke: grid!.color, 'stroke-width': 1, fill: 'none' }) : '')
  } else {
    const lines = drawRun(run, ctx, { perLine: true })
    text = lines.map((l, i) => group(ctx, {}, [fade(spans[i].t0, spans[i].t0 + 0.06)], l)).join('')
  }
  // 关键词：打字经过时荧光笔底纹从左往右扫出，之后保留
  const color = run.markColor ?? ctx.doc.theme.accent
  const markers = markSpans(run)
    .map((m) => {
      const sp = spans[m.line]
      const at = (x: number) => sp.t0 + ((x - sp.x) / Math.max(1, sp.w)) * (sp.t1 - sp.t0)
      const a = markerAttrs(m, color)
      return shape('rect', a, ctx, [{ attr: 'width', keys: [{ t: at(m.x), v: 0 }, { t: at(m.x + m.w) + 0.12, v: a.width, ease: 'out' }] }])
    })
    .join('')
  text = markers + text
  // 闪烁光标竖线：跟随打字位置，打完后闪两下消失
  const caretH = run.font.size * 1.1
  const cy = (i: number) => spans[i].y + (spans[i].h - caretH) / 2
  const xs: Key[] = []
  const ys: Key[] = []
  spans.forEach((sp, i) => {
    xs.push({ t: sp.t0, v: sp.x }, { t: sp.t1, v: sp.x + sp.w + 2, ease: 'linear' })
    ys.push({ t: sp.t0, v: cy(i) })
  })
  const done = spans[spans.length - 1].t1
  const blink = 0.12 * k(ctx)
  const caret = shape('rect', { x: spans[spans.length - 1].x + spans[spans.length - 1].w + 2, y: cy(spans.length - 1), width: 3, height: caretH, fill: ctx.doc.theme.accent, opacity: 0 }, ctx, [
    { attr: 'x', keys: xs },
    { attr: 'y', discrete: true, keys: ys },
    { attr: 'opacity', discrete: true, keys: [{ t: s - 0.001, v: 0 }, { t: s, v: 1 }, { t: done + blink, v: 0 }, { t: done + blink * 2, v: 1 }, { t: done + blink * 3, v: 0 }] },
  ])
  return frame + text + caret
}

// ---------- drag-in：光标拖出虚线选框，图片从选框里缩放淡入，末尾两帧切片抖动 ----------

const dragIn: Renderer = (ti, ctx) => {
  const { box, tStart: s, tEnd: e } = ti
  const sel = 0.3 * k(ctx)
  const { accent } = ctx.doc.theme
  const marquee = shape('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: accent, 'fill-opacity': 0.08, stroke: accent, 'stroke-width': 2, 'stroke-dasharray': '10 6', opacity: 0 }, ctx, [
    { attr: 'width', keys: [{ t: s, v: 0 }, { t: s + sel, v: box.w, ease: 'out' }] },
    { attr: 'height', keys: [{ t: s, v: 0 }, { t: s + sel, v: box.h, ease: 'out' }] },
    flash(s, e - 0.1, e),
  ])
  const t0 = s + sel * 0.6
  const body = scaleAround(
    ctx,
    box.x + box.w / 2,
    box.y + box.h / 2,
    [{ t: t0, v: 0.92 }, { t: e - 0.08, v: 1, ease: 'out' }],
    itemBody(ti, ctx),
    [
      fade(t0, t0 + 0.2),
      { attr: 'transform', transform: 'translate', discrete: true, keys: [{ t: e - 0.12, v: '0 0' }, { t: e - 0.09, v: '-6 0' }, { t: e - 0.05, v: '4 0' }, { t: e - 0.02, v: '0 0' }] },
    ],
  )
  return body + marquee
}

// ---------- pop：缩放 0.9 → 1.03 → 1 并淡入 ----------

const pop: Renderer = (ti, ctx) => {
  const { box, tStart: s, tEnd: e } = ti
  const d = e - s
  return scaleAround(ctx, box.x + box.w / 2, box.y + box.h / 2, [{ t: s, v: 0.9 }, { t: s + d * 0.6, v: 1.03, ease: 'out' }, { t: e, v: 1, ease: 'inout' }], itemBody(ti, ctx), [fade(s, s + d * 0.45)])
}

// ---------- count-up：数字分几步离散跳到最终值 ----------

const NUM = /^(\D*?)(\d+(?:\.\d+)?)(.*)$/

const countUp: Renderer = (ti, ctx) => {
  const run = ti.text
  const m = ti.item.content.match(NUM)
  if (!run || !m) return pop(ti, ctx)
  const { tStart: s, tEnd: e } = ti
  const [, pre, numStr, post] = m
  const target = Number(numStr)
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0
  const steps = 5
  const t0 = s + 0.12 * k(ctx)
  const span = e - t0 - 0.04
  const frame = group(ctx, {}, [fade(s, s + 0.14 * k(ctx))], itemBody(ti, ctx, { textOverride: '' }))
  // 缓出取值；相邻相同的数值合并（小数字时会重复）
  const values = Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps
    const v = i === steps - 1 ? numStr : (target * (1 - Math.pow(1 - f, 2))).toFixed(decimals)
    return `${pre}${v}${post}`
  }).filter((v, i, all) => i === all.length - 1 || (v !== all[i + 1] && v !== all[all.length - 1]))
  const nums = values
    .map((v, i) => {
      const a = t0 + (span * i) / values.length
      const b = t0 + (span * (i + 1)) / values.length
      const last = i === values.length - 1
      const keys = last ? [{ t: a - 0.001, v: 0 }, { t: a, v: 1 }] : [{ t: a - 0.001, v: 0 }, { t: a, v: 1 }, { t: b, v: 0 }]
      return group(ctx, { opacity: last ? undefined : 0 }, [{ attr: 'opacity', discrete: true, keys }], drawRun(run, ctx, { lines: [v] }).join(''))
    })
    .join('')
  return frame + nums
}

// ---------- select-highlight：选中高亮逐行扫过，再取消 ----------

const selectHighlight: Renderer = (ti, ctx) => {
  const { box, tStart: s, tEnd: e } = ti
  const run = ti.text
  const accent = ctx.doc.theme.accent
  const body = group(ctx, {}, [fade(s, s + 0.12 * k(ctx))], itemBody(ti, ctx))
  const rows = run ? run.lines.map((_, i) => lineBox(run, i)) : [box]
  const sweep0 = s + 0.14 * k(ctx)
  const sweepEnd = e - 0.22 * k(ctx)
  const per = (sweepEnd - sweep0) / rows.length
  const marks = rows
    .map((r, i) => {
      const a = sweep0 + per * i
      return shape('rect', { x: r.x - 4, y: r.y + 3, width: r.w + 8, height: Math.max(4, r.h - 6), fill: accent, 'fill-opacity': 0.32, opacity: 0 }, ctx, [
        { attr: 'width', keys: [{ t: a, v: 0 }, { t: a + per, v: r.w + 8, ease: 'out' }] },
        flash(a, e - 0.1, e),
      ])
    })
    .join('')
  return marks + body
}

// ---------- alert-box：红框快速闪两下后定住 ----------

const alertBox: Renderer = (ti, ctx) => {
  const { box, tStart: s } = ti
  const q = 0.08 * k(ctx)
  const m = 8
  const body = group(ctx, {}, [fade(s, s + 0.12 * k(ctx))], itemBody(ti, ctx))
  const frame = shape('rect', { x: box.x - m, y: box.y - m, width: box.w + m * 2, height: box.h + m * 2, rx: 6, fill: 'none', stroke: ctx.doc.theme.alert, 'stroke-width': 3 }, ctx, [
    { attr: 'opacity', discrete: true, keys: [{ t: s + q - 0.001, v: 0 }, { t: s + q, v: 1 }, { t: s + q * 2, v: 0 }, { t: s + q * 3, v: 1 }, { t: s + q * 4, v: 0 }, { t: s + q * 5, v: 1 }] },
  ])
  return body + frame
}

export const PRESET_RENDERERS: Record<EnterPreset, Renderer> = {
  'inspect-draw': inspectDraw,
  'glitch-settle': glitchSettle,
  'type-on': typeOn,
  'drag-in': dragIn,
  pop,
  'count-up': countUp,
  'select-highlight': selectHighlight,
  'alert-box': alertBox,
}

/** 渲染一个元素（含进场动画）；只读 ti.tStart / ti.tEnd 与元素自身数据 */
export function renderItem(ti: TimedItem, ctx: RenderCtx): string {
  return `<g>${PRESET_RENDERERS[ti.preset](ti, ctx)}</g>`
}

/** 静态成稿（没有动画）：测试和“动画被过滤时的退化效果”对照用 */
export function renderItemStatic(ti: TimedItem, ctx: RenderCtx): string {
  return `<g>${itemBody(ti, ctx)}</g>`
}
