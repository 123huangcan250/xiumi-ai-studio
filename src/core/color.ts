// 颜色工具：解析、亮度、饱和度、与白/黑混合。

export function toHex(c: string): string | undefined {
  c = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(c)) return c
  if (/^#[0-9a-f]{3}$/.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('')
  const m = c.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) < 0.5) return undefined
    return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')
  }
  return undefined
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** 相对亮度（0 黑 – 1 白，近似） */
export function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((x) => x / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function sat(hex: string) {
  const [r, g, b] = rgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** 与白色混合，w=0.9 得到很浅的底色 */
export function tint(hex: string, w: number) {
  return '#' + rgb(hex).map((x) => Math.round(x + (255 - x) * w).toString(16).padStart(2, '0')).join('')
}

/** 与黑色混合 */
export function shade(hex: string, w: number) {
  return '#' + rgb(hex).map((x) => Math.round(x * (1 - w)).toString(16).padStart(2, '0')).join('')
}

export interface Hsl {
  /** 0–360 */
  h: number
  s: number
  l: number
}

export function toHsl(hex: string): Hsl {
  const [r, g, b] = rgb(hex).map((x) => x / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: Math.min(1, s), l }
}

export function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

/** 两个色相的最短距离（度） */
export const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
