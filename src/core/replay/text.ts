// 文字测量、断行与栅格化。浏览器在启动时注入 canvas 实现（measureText / toDataURL 都是同步的），
// Node 环境（单元测试、服务端）使用近似测量，且不能栅格化。

export const FONT_FAMILY = "'PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif"

export interface FontSpec {
  size: number
  weight: 400 | 700
  letterSpacing: number
}

export interface RasterSpec extends FontSpec {
  lines: string[]
  color: string
  /** 行高（px） */
  lineHeight: number
  width: number
  height: number
  align: 'left' | 'center' | 'right'
  /** 按行分段（关键词另用颜色和字重）；没有时整行用 color / weight */
  segments?: Segment[][]
}

export interface Segment {
  text: string
  color: string
  weight: 400 | 700
}

export interface ReplayEnv {
  measure: (text: string, font: FontSpec) => number
  /** 返回 2x 透明 PNG 的 data URL；无法栅格化时返回 null */
  rasterize: ((spec: RasterSpec) => string | null) | null
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 近似测量：全角字符 1em，半角按字形粗略取值；只用于没有 canvas 的环境 */
export function approxMeasure(text: string, font: FontSpec): number {
  let w = 0
  for (const ch of text) {
    if (WIDE.test(ch)) w += 1
    else if (ch === ' ') w += 0.3
    else if (/[A-Z]/.test(ch)) w += 0.66
    else if (/[0-9]/.test(ch)) w += 0.57
    else if (/[il.,:;'!|]/.test(ch)) w += 0.28
    else w += 0.52
  }
  const bold = font.weight === 700 ? 1.04 : 1
  return w * font.size * bold + font.letterSpacing * [...text].length
}

let env: ReplayEnv = { measure: approxMeasure, rasterize: null }

export function setReplayEnv(next: Partial<ReplayEnv>) {
  env = { ...env, ...next }
}
export function replayEnv(): ReplayEnv {
  return env
}

/** 不能出现在行首的标点 */
const NO_START = /^[，。、！？；：）》」』】,.!?;:)\]}%’”]/

/** 切成断行单位：中日韩字符逐字，拉丁字母和数字按词 */
function tokens(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’\-.%/]*|\s+|[\s\S]/g) ?? []
}

/** 按宽度断行；保留原文换行 */
export function wrapText(text: string, font: FontSpec, maxWidth: number, measure = env.measure): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const tok of tokens(para)) {
      const next = line + tok
      if (!line || measure(next.trimEnd(), font) <= maxWidth) {
        line = next
        continue
      }
      // 行首禁则：标点跟在上一行末尾
      if (NO_START.test(tok)) {
        line = next
        continue
      }
      if (/^\s+$/.test(tok)) {
        out.push(line.trimEnd())
        line = ''
        continue
      }
      // 单个拉丁词比整行还宽：按字符拆
      if (measure(tok, font) > maxWidth) {
        for (const ch of tok) {
          if (measure((line + ch).trimEnd(), font) > maxWidth && line) {
            out.push(line.trimEnd())
            line = ''
          }
          line += ch
        }
        continue
      }
      out.push(line.trimEnd())
      line = tok.trimStart()
    }
    out.push(line.trimEnd())
  }
  return out
}

/** 浏览器 canvas 实现：测量与 2x 栅格化，结果按内容缓存 */
export function canvasEnv(doc: Document): ReplayEnv {
  const canvas = doc.createElement('canvas')
  const g = canvas.getContext('2d')
  if (!g) return { measure: approxMeasure, rasterize: null }
  const fontOf = (f: FontSpec) => `${f.weight} ${f.size}px ${FONT_FAMILY}`
  const mcache = new Map<string, number>()
  const measure = (text: string, f: FontSpec) => {
    const key = `${f.size}|${f.weight}|${f.letterSpacing}|${text}`
    let w = mcache.get(key)
    if (w === undefined) {
      g.font = fontOf(f)
      w = g.measureText(text).width + f.letterSpacing * [...text].length
      if (mcache.size > 5000) mcache.clear()
      mcache.set(key, w)
    }
    return w
  }
  const rcache = new Map<string, string>()
  const rasterize = (s: RasterSpec) => {
    const key = JSON.stringify(s)
    const hit = rcache.get(key)
    if (hit) return hit
    const c = doc.createElement('canvas')
    const scale = 2
    c.width = Math.max(1, Math.ceil(s.width * scale))
    c.height = Math.max(1, Math.ceil(s.height * scale))
    const x = c.getContext('2d')
    if (!x) return null
    x.scale(scale, scale)
    x.font = fontOf(s)
    x.fillStyle = s.color
    x.textBaseline = 'alphabetic'
    if ('letterSpacing' in x) (x as any).letterSpacing = `${s.letterSpacing}px`
    s.lines.forEach((line, i) => {
      const segs = s.segments?.[i] ?? [{ text: line, color: s.color, weight: s.weight }]
      const widths = segs.map((g) => measure(g.text, { ...s, weight: g.weight }))
      const w = widths.reduce((a, b) => a + b, 0)
      let lx = s.align === 'center' ? (s.width - w) / 2 : s.align === 'right' ? s.width - w : 0
      const y = baseline(s.size, s.lineHeight) + i * s.lineHeight
      segs.forEach((g, j) => {
        x.font = fontOf({ ...s, weight: g.weight })
        x.fillStyle = g.color
        x.fillText(g.text, lx, y)
        lx += widths[j]
      })
    })
    const url = c.toDataURL('image/png')
    if (rcache.size > 800) rcache.clear()
    rcache.set(key, url)
    return url
  }
  return { measure, rasterize }
}

/** 行内基线位置：字号居中于行高 */
export function baseline(size: number, lineHeight: number): number {
  return (lineHeight - size) / 2 + size * 0.86
}
