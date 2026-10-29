// 参考风格学习：从用户有权使用的参考文章 HTML 中提取设计参数，生成原创主题。
// 只提取数值型设计令牌（颜色、字号、行距、间距、圆角、装饰倾向），不复制任何 HTML 结构或素材。
import { lum, sat, tint as mix, toHex } from './color'
import { THEMES } from './themes'
import type { Theme } from './types'

export interface StyleReport {
  sampleCount: number
  colors: { color: string; count: number }[]
  backgrounds: { color: string; count: number }[]
  fontSizes: { size: number; count: number }[]
  lineHeight: number
  letterSpacing: number
  paragraphSpacing: number
  radius: number
  traits: { borderLeft: number; pill: number; centered: number; images: number; tables: number }
}

function parseStyle(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().replace(/\s*!important/, '')
  }
  return out
}

const px = (v?: string) => {
  if (!v) return undefined
  const m = v.match(/^([\d.]+)(px|em|rem|pt)?/)
  if (!m) return undefined
  const n = Number(m[1])
  return m[2] === 'em' || m[2] === 'rem' ? n * 15 : m[2] === 'pt' ? n * 1.333 : n
}

function tally<T>(map: Map<T, number>, k: T | undefined, w = 1) {
  if (k !== undefined) map.set(k, (map.get(k) ?? 0) + w)
}
const top = <T>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
const median = (a: number[], d: number) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : d)

/** root：已解析的参考文章 DOM（浏览器 DOMParser 或 jsdom） */
export function analyzeStyle(root: ParentNode): StyleReport {
  const colors = new Map<string, number>()
  const bgs = new Map<string, number>()
  const sizes = new Map<number, number>()
  const lhs: number[] = []
  const lss: number[] = []
  const margins: number[] = []
  const radii: number[] = []
  const traits = { borderLeft: 0, pill: 0, centered: 0, images: 0, tables: 0 }
  const els = Array.from(root.querySelectorAll('[style]'))
  for (const el of els) {
    const st = parseStyle(el.getAttribute('style') ?? '')
    const text = (el.textContent ?? '').trim().length
    tally(colors, st.color && toHex(st.color), Math.min(text, 200) || 1)
    tally(bgs, (st['background-color'] || st.background) && toHex((st['background-color'] || st.background).split(' ')[0]))
    const fs = px(st['font-size'])
    if (fs && fs >= 9 && fs <= 48) tally(sizes, Math.round(fs), Math.min(text, 300) || 1)
    const lh = st['line-height']
    if (lh) {
      const n = Number(lh)
      if (n > 1 && n < 3) lhs.push(n)
      else if (fs && px(lh)) lhs.push(px(lh)! / fs)
    }
    const ls = px(st['letter-spacing'])
    if (ls !== undefined && ls < 5) lss.push(ls)
    if (el.tagName === 'P') {
      const mb = px(st['margin-bottom'] ?? st.margin?.split(/\s+/)[2])
      if (mb !== undefined && mb < 60) margins.push(mb)
    }
    const r = px(st['border-radius'])
    if (r !== undefined) {
      if (r >= 50) traits.pill++
      else radii.push(r)
    }
    if (st['border-left']) traits.borderLeft++
    if (st['text-align'] === 'center') traits.centered++
  }
  traits.images = root.querySelectorAll('img').length
  traits.tables = root.querySelectorAll('table').length
  return {
    sampleCount: els.length,
    colors: top(colors).slice(0, 8).map(([color, count]) => ({ color, count })),
    backgrounds: top(bgs).filter(([c]) => c !== '#ffffff').slice(0, 6).map(([color, count]) => ({ color, count })),
    fontSizes: top(sizes).slice(0, 6).map(([size, count]) => ({ size, count })),
    lineHeight: Math.round(median(lhs, 1.75) * 100) / 100,
    letterSpacing: Math.round(median(lss, 0.5) * 10) / 10,
    paragraphSpacing: median(margins, 16),
    radius: median(radii, 4),
    traits,
  }
}

/** 由分析报告生成一套新的原创主题 */
export function themeFromReport(r: StyleReport, name: string): Theme {
  const base = THEMES[0]
  const chroma = [...r.colors, ...r.backgrounds].map((x) => x.color).filter((c) => sat(c) > 0.25 && lum(c) > 0.08 && lum(c) < 0.85)
  const primary = chroma[0] ?? '#3A5BA0'
  const accent = chroma.find((c) => c !== primary && Math.abs(lum(c) - lum(primary)) > 0.05) ?? mix(primary, 0.35)
  const text = r.colors.map((x) => x.color).find((c) => lum(c) < 0.3) ?? '#2B2B2B'
  const body = r.fontSizes.find((f) => f.size >= 13 && f.size <= 18)?.size ?? 15
  const larger = r.fontSizes.map((f) => f.size).filter((s) => s > body).sort((a, b) => a - b)
  const radius = Math.min(16, r.radius)
  const t = r.traits
  return {
    ...base,
    id: `custom-${Date.now().toString(36)}`,
    name,
    description: `由参考文章提取的设计参数生成（${r.sampleCount} 个样式样本）`,
    colors: {
      primary, accent, text,
      primarySoft: mix(primary, 0.9),
      muted: mix(text, 0.45),
      bg: '#FFFFFF',
      surface: r.backgrounds.find((b) => lum(b.color) > 0.9)?.color ?? mix(primary, 0.95),
      border: mix(primary, 0.78),
    },
    fontSize: body,
    h2Size: larger[0] ?? body + 3,
    h1Size: larger[larger.length - 1] && larger[larger.length - 1] > body + 4 ? larger[larger.length - 1] : body + 9,
    lineHeight: Math.min(2.2, Math.max(1.5, r.lineHeight)),
    letterSpacing: Math.min(2, Math.max(0, r.letterSpacing)),
    paragraphSpacing: Math.min(32, Math.max(8, r.paragraphSpacing)),
    blockSpacing: Math.min(40, Math.max(18, r.paragraphSpacing + 10)),
    radius,
    imageRadius: radius,
    headingVariant: t.pill > 2 ? 'pill' : t.borderLeft > 2 ? 'bar' : t.centered > 6 ? 'underline' : 'number',
    quoteVariant: t.borderLeft > 0 ? 'line' : t.centered > 6 ? 'center' : 'mark',
    cardVariant: r.backgrounds.length > 1 ? 'fill' : 'border',
    dividerVariant: t.centered > 6 ? 'ornament' : 'line',
    coverVariant: t.images > 3 ? 'hero' : 'minimal',
  }
}
