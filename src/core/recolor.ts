// 组件配色：不同模板的组件混排时颜色容易冲突。导入片段的颜色写死在内联样式和 SVG 属性里，
// 这里统计用到的颜色，并按“换色相、保留明暗”的方式统一到一组目标色，白、黑、灰不动。
// 图片（PNG 花边、GIF 贴纸、纹理背景）无法改色，单独计数提示用户。
import { fromHsl, hueDistance, toHsl } from './color'
import { splitDecls } from './sanitize'
import type { Parse } from './slots'
import type { Block, Theme } from './types'

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

const TOKEN = /url\([^)]*\)|#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\(\s*\d+(?:\.\d+)?[\s,]+\d+(?:\.\d+)?[\s,]+\d+(?:\.\d+)?(?:[\s,/]+[\d.]+%?)?\s*\)/gi
/** 可能写颜色的属性（含 SVG 动画的取值） */
const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'bgcolor', 'values', 'from', 'to', 'by']
/** 样式里不写颜色的属性：其中的 # 不是颜色 */
const NOT_COLOR = /^(transform|font-family|width|height|margin|padding|content)/

export interface ColorUse {
  hex: string
  /** 使用权重：底色和填充面积大，权重更高 */
  count: number
  /** 有色相；false 为白、黑、灰，配色时不动 */
  chroma: boolean
}

interface Parsed {
  hex: string
  /** 原写法里的透明度，替换时保留 */
  alpha?: string
}

function parseToken(tok: string): Parsed | null {
  const t = tok.toLowerCase()
  if (t.startsWith('#')) {
    const h = t.slice(1)
    if (h.length === 3 || h.length === 4) {
      const hex = '#' + [...h.slice(0, 3)].map((x) => x + x).join('')
      return h.length === 4 ? { hex, alpha: (parseInt(h[3] + h[3], 16) / 255).toFixed(2) } : { hex }
    }
    if (h.length === 6) return { hex: t }
    return { hex: t.slice(0, 7), alpha: (parseInt(h.slice(6), 16) / 255).toFixed(2) }
  }
  const nums = t.match(/[\d.]+%?/g)
  if (!nums || nums.length < 3) return null
  const hex = '#' + nums.slice(0, 3).map((x) => Math.min(255, Math.round(Number(x))).toString(16).padStart(2, '0')).join('')
  return nums[3] !== undefined ? { hex, alpha: nums[3] } : { hex }
}

const isChroma = (hex: string) => {
  const { s, l } = toHsl(hex)
  return s >= 0.12 && l > 0.04 && l < 0.985
}

function eachToken(value: string, fn: (tok: Parsed) => string | null): string {
  return value.replace(TOKEN, (m) => {
    if (m.toLowerCase().startsWith('url(')) return m
    const p = parseToken(m)
    return p ? (fn(p) ?? m) : m
  })
}

const rootOf = (html: string, parse: Parse) => parse(`<!doctype html><html><body><section id="__c">${html}</section></body></html>`).getElementById('__c')!

function visitColors(root: Element, onStyle: (el: Element, decls: string[]) => void, onAttr: (el: Element, name: string, value: string) => void) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const style = el.getAttribute('style')
    if (style) onStyle(el, splitDecls(style))
    for (const a of COLOR_ATTRS) {
      const v = el.getAttribute(a)
      if (v) onAttr(el, a, v)
    }
  }
}

const propOf = (decl: string) => decl.slice(0, decl.indexOf(':')).trim().toLowerCase()
const weight = (prop: string) => (/background|fill/.test(prop) ? 3 : 1)

/** 片段用到的颜色，按权重从高到低 */
export function collectColors(html: string, parse: Parse = defaultParse): ColorUse[] {
  const uses = new Map<string, number>()
  const add = (p: Parsed, w: number) => {
    if (p.alpha !== undefined && Number(p.alpha.replace('%', '')) < (p.alpha.endsWith('%') ? 15 : 0.15)) return
    uses.set(p.hex, (uses.get(p.hex) ?? 0) + w)
  }
  visitColors(
    rootOf(html, parse),
    (_el, decls) => {
      for (const d of decls) {
        const prop = propOf(d)
        if (!prop || NOT_COLOR.test(prop)) continue
        eachToken(d.slice(d.indexOf(':') + 1), (tok) => (add(tok, weight(prop)), null))
      }
    },
    (_el, name, v) => void eachToken(v, (tok) => (add(tok, weight(name)), null)),
  )
  return [...uses.entries()].map(([hex, count]) => ({ hex, count, chroma: isChroma(hex) })).sort((a, b) => b.count - a.count)
}

/** 按颜色表替换颜色（hex → hex），保留透明度；url() 里的内容不动 */
export function recolorHtml(html: string, map: Record<string, string>, parse: Parse = defaultParse): string {
  if (!Object.keys(map).length) return html
  const root = rootOf(html, parse)
  const swap = (p: Parsed) => {
    const to = map[p.hex]
    if (!to) return null
    if (p.alpha === undefined) return to
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(to.slice(i, i + 2), 16))
    return `rgba(${r}, ${g}, ${b}, ${p.alpha})`
  }
  visitColors(
    root,
    (el, decls) => {
      el.setAttribute(
        'style',
        decls
          .map((d) => {
            const i = d.indexOf(':')
            const prop = propOf(d)
            return i < 0 || !prop || NOT_COLOR.test(prop) ? d : d.slice(0, i + 1) + eachToken(d.slice(i + 1), swap)
          })
          .join(';'),
      )
    },
    (el, name, v) => el.setAttribute(name, eachToken(v, swap)),
  )
  return root.innerHTML
}

interface Cluster {
  rep: ColorUse
  total: number
  colors: ColorUse[]
}

/** 按色相分组（相差 45° 以内算一组，同一色系的深浅色相常差 30° 以上），面积最大的组在前 */
export function clusterHues(colors: ColorUse[]): Cluster[] {
  const groups: Cluster[] = []
  for (const c of colors.filter((x) => x.chroma)) {
    const h = toHsl(c.hex).h
    const hit = groups.find((g) => hueDistance(toHsl(g.rep.hex).h, h) <= 45)
    if (hit) {
      hit.colors.push(c)
      hit.total += c.count
    } else groups.push({ rep: c, total: c.count, colors: [c] })
  }
  return groups.sort((a, b) => b.total - a.total)
}

export interface TargetColors {
  primary: string
  accent: string
}

/**
 * 把片段的颜色统一到目标色：主色组换成 primary 的色相，其余色组换成 accent 的色相，
 * 明暗保持不变（浅底仍是浅底，深字仍是深字），对比度基本不变。目标色本身是灰色时不改。
 */
export function harmonize(colors: ColorUse[], target: TargetColors): Record<string, string> {
  const groups = clusterHues(colors)
  const p = toHsl(target.primary)
  if (!groups.length || p.s < 0.12) return {}
  const a = toHsl(target.accent)
  const accent = a.s >= 0.12 ? a : p
  const k = Math.min(1.3, Math.max(0.7, p.s / Math.max(0.01, toHsl(groups[0].rep.hex).s)))
  const map: Record<string, string> = {}
  groups.forEach((g, i) => {
    const t = i === 0 ? p : accent
    for (const c of g.colors) {
      const { s, l } = toHsl(c.hex)
      const next = fromHsl({ h: t.h, s: Math.min(1, s * k), l })
      if (next !== c.hex) map[c.hex] = next
    }
  })
  return map
}

/** 文档的主色：原文片段里面积最大的颜色；文档没有带颜色的片段时用主题色 */
export function docMainColors(blocks: Block[], theme: Pick<Theme, 'colors'>, parse: Parse = defaultParse): TargetColors {
  const html = blocks.flatMap((b) => (b.type === 'html' ? [b.props.html] : [])).join('')
  const groups = html ? clusterHues(collectColors(html, parse)) : []
  return { primary: groups[0]?.rep.hex ?? theme.colors.primary, accent: groups[1]?.rep.hex ?? theme.colors.accent }
}

/** 不能改色的图片数量：PNG、GIF 花边贴纸和纹理背景 */
export function fixedDecorCount(html: string, parse: Parse = defaultParse): number {
  const root = rootOf(html, parse)
  const raster = /wx_fmt=(gif|png)|mmbiz_(gif|png)|\.(gif|png)(\?|$)|^data:image\/(png|gif)/i
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => raster.test(i.getAttribute('src') ?? '')).length
  const bgs = Array.from(root.querySelectorAll('[style*="background-image"]')).filter((el) => raster.test((el.getAttribute('style') ?? '').match(/url\((['"]?)(.*?)\1\)/)?.[2] ?? '')).length
  return imgs + bgs
}
