// 粘贴来的富文本尺寸还原：浏览器复制网页时会把百分比换算成复制那一刻的像素值
// （width: 18% → 129.234px），版面就被钉死在来源页面的宽度上，放进更窄的画布或手机里会被裁掉、挤向一侧。
// 这里按来源宽度把这些像素值换回百分比；作者本来就写成像素的尺寸（图标、间距）保持不变。
import { splitDecls } from './sanitize'

export interface BoxMetrics {
  /** 包含块的内容宽度：百分比的宽度、内外边距都相对它计算 */
  cbw: number
  /** 元素自己的宽高（含边框） */
  width: number
  height: number
  /** 父元素的内容高度，以及父元素的高度是否确定（写了 height 或 aspect-ratio） */
  parentHeight: number
  parentDefinite: boolean
}

const PX = /^(-?\d*\.?\d+)px$/i
/** 换算出来的像素值几乎都带小数；整数多半是作者写的 */
const frac = (v: number) => Math.abs(v - Math.round(v)) > 0.02
const pct = (v: number, base: number) => `${+((v / base) * 100).toFixed(4)}%`

type Kind = 'width' | 'space'

function fluidLen(value: string, cbw: number, kind: Kind): string {
  const m = value.match(PX)
  if (!m || cbw <= 0) return value
  const v = Number(m[1])
  if (!v) return value
  if (frac(v)) return pct(v, cbw)
  if (kind !== 'width') return value
  // 整数宽度：撑满包含块，或者是较大的整百分比（50% 之类），也是换算来的
  if (Math.abs(v - cbw) <= 1) return '100%'
  const p = (v / cbw) * 100
  return v >= 100 && Math.abs(p - Math.round(p)) < 0.005 ? pct(v, cbw) : value
}

const WIDTHS = new Set(['width', 'min-width', 'max-width'])
const SPACES = new Set(['margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom'])
const SHORTHANDS = new Set(['margin', 'padding'])

/** 换算一个元素的内联样式；没有需要换算的值时原样返回 */
export function fluidStyle(style: string, m: BoxMetrics): string {
  let changed = false
  let ratio = ''
  const out: string[] = []
  const hasRatio = /(^|;)\s*aspect-ratio\s*:/i.test(style)
  for (const decl of splitDecls(style)) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim().toLowerCase()
    const v = decl.slice(i + 1).trim()
    let next = v
    if (WIDTHS.has(k)) next = fluidLen(v, m.cbw, 'width')
    else if (SPACES.has(k)) next = fluidLen(v, m.cbw, 'space')
    else if (SHORTHANDS.has(k)) next = v.split(/\s+/).map((part) => fluidLen(part, m.cbw, 'space')).join(' ')
    else if (k === 'height') {
      const h = Number(v.match(PX)?.[1])
      if (h && frac(h)) {
        // 父元素高度确定时原本就是百分比高度；否则改用宽高比，高度跟着宽度走
        if (m.parentDefinite && m.parentHeight > 0) next = Math.abs(h - m.parentHeight) <= 0.5 ? '100%' : pct(h, m.parentHeight)
        else if (m.width > 0) {
          changed = true
          if (!hasRatio) ratio = `aspect-ratio: ${+m.width.toFixed(3)} / ${+h.toFixed(3)}`
          continue
        }
      }
    }
    if (next !== v) changed = true
    out.push(`${k}: ${next}`)
  }
  if (!changed) return style
  if (ratio) out.push(ratio)
  return out.join('; ')
}

const pxWidth = (el: Element) => Number((el.getAttribute('style') ?? '').match(/(?:^|;)\s*width\s*:\s*(-?\d*\.?\d+)px/i)?.[1] ?? 0)
const weight = (el: Element) => (el.textContent ?? '').trim().length + el.querySelectorAll('img').length * 200
/** 小于这个宽度的不会是正文栏宽 */
const MIN_COLUMN = 240

/**
 * 找出来源页面的正文宽度：沿着“装着大部分内容的那个子元素”一路往下，第一个写了像素宽度的元素。
 * 找不到（来源没有写死宽度）返回 null，这时不换算。
 */
export function sourceColumn(root: Element): { el: Element; width: number } | null {
  let cur = root
  for (let depth = 0; depth < 40; depth++) {
    if (cur !== root && pxWidth(cur) >= MIN_COLUMN) return { el: cur, width: pxWidth(cur) }
    const kids = Array.from(cur.children)
    if (!kids.length) return null
    const total = weight(cur)
    const main = kids.reduce((a, b) => (weight(b) > weight(a) ? b : a))
    if (kids.length > 1 && weight(main) < total * 0.6) {
      // 内容分散在几个并列的版块里：取它们当中最常见的宽度
      const count = new Map<number, Element[]>()
      for (const k of kids) {
        const w = pxWidth(k)
        if (w >= MIN_COLUMN) count.set(w, [...(count.get(w) ?? []), k])
      }
      const best = [...count].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0]
      return best ? { el: best[1][0], width: best[0] } : null
    }
    cur = main
  }
  return null
}

const num = (v: string) => parseFloat(v) || 0

/** 内容区尺寸：行内元素没有自己的盒子，往上找到第一个块级祖先 */
function contentBox(el: Element, stop: Element, view: Window) {
  let cur = el
  let cs = view.getComputedStyle(cur)
  while (cur !== stop && cur.parentElement && /^(inline|contents)$/.test(cs.display)) {
    cur = cur.parentElement
    cs = view.getComputedStyle(cur)
  }
  return {
    width: cur.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight),
    height: cur.clientHeight - num(cs.paddingTop) - num(cs.paddingBottom),
  }
}

const DEFINITE = /(^|;)\s*(height\s*:\s*-?[\d.]|aspect-ratio\s*:)/i

/**
 * 换算一棵已经挂到页面上、按来源宽度排好版的树。先全部量完再改：改动一个元素会影响后面元素的尺寸。
 * SVG 内部用的是 viewBox 坐标，本身就会跟着缩放，不处理。
 */
export function fluidizeTree(host: Element): number {
  const view = host.ownerDocument.defaultView
  if (!view) return 0
  const jobs: { el: Element; style: string }[] = []
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const style = child.getAttribute('style') ?? ''
      if (/\dpx/i.test(style)) {
        const box = contentBox(el, host, view)
        // 布局尺寸不受旋转影响；SVG 元素没有 offsetWidth，退回到外接矩形
        const rect = child.getBoundingClientRect()
        const html = child as HTMLElement
        const next = fluidStyle(style, {
          cbw: box.width,
          width: html.offsetWidth || rect.width,
          height: html.offsetHeight || rect.height,
          parentHeight: box.height,
          parentDefinite: el !== host && DEFINITE.test(el.getAttribute('style') ?? ''),
        })
        if (next !== style) jobs.push({ el: child, style: next })
      }
      if (child.tagName.toLowerCase() !== 'svg') walk(child)
    }
  }
  walk(host)
  for (const j of jobs) j.el.setAttribute('style', j.style)
  return jobs.length
}
