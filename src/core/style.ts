// 内联样式工具：编译器和套件模块共用。

// 只允许经过验证、在公众号编辑器中通用的属性；其他属性直接丢弃。
const ALLOWED_CSS = new Set([
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'font-size', 'font-weight', 'font-family', 'font-style', 'color', 'background-color',
  'line-height', 'letter-spacing', 'text-align', 'text-indent', 'text-decoration',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-radius', 'border-collapse',
  'width', 'max-width', 'height', 'display', 'vertical-align', 'box-sizing', 'overflow', 'overflow-x',
  'word-break', 'white-space', 'box-shadow', 'opacity',
])
const UNSAFE_VALUE = /(expression|javascript:|url\(|var\(|@import|<|>)/i

export type Decls = Record<string, string | number | undefined | false>

export function css(decls: Decls): string {
  let out = ''
  for (const [k, v] of Object.entries(decls)) {
    if (v === undefined || v === false || v === '') continue
    if (!ALLOWED_CSS.has(k)) continue
    const val = v === 0 ? '0' : typeof v === 'number' && k !== 'line-height' && k !== 'opacity' && k !== 'font-weight' ? `${v}px` : String(v)
    if (UNSAFE_VALUE.test(val)) continue
    // 样式写在 style="..." 中：字体名的双引号必须换成单引号，否则会截断属性
    out += `${k}:${val.replace(/"/g, "'")};`
  }
  return out
}

export function esc(s: unknown): string {
  return (s === null || s === undefined ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i
export const safeColor = (c: unknown) => (typeof c === 'string' && COLOR_RE.test(c.trim()) ? c.trim() : undefined)
