// 微信 HTML 编译器：文档 JSON → 全内联样式 HTML。
// 画布、手机预览、复制、草稿箱都使用同一份输出，保证所见即所得。
import { guardHtml } from './sanitize'
import { resolveTheme } from './themes'
import type { Block, Doc, ImageRef, RichNode, RichText, Theme } from './types'

export interface CompileOptions {
  /** 把（已附加裁切参数的）图片地址映射为最终地址：绝对 URL / base64 / mmbiz URL */
  mapImage?: (url: string) => string
  /** 非公众号文章链接的处理方式；微信会过滤外链，默认转成文字 */
  externalLinks?: 'text' | 'keep'
}

// 只允许经过验证、在公众号编辑器中通用的属性；其他属性直接丢弃。
const ALLOWED_CSS = new Set([
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'font-size', 'font-weight', 'font-family', 'font-style', 'color', 'background-color',
  'line-height', 'letter-spacing', 'text-align', 'text-indent', 'text-decoration',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-radius', 'border-collapse',
  'width', 'max-width', 'height', 'display', 'vertical-align', 'box-sizing', 'overflow',
  'word-break', 'white-space', 'box-shadow', 'opacity',
])
const UNSAFE_VALUE = /(expression|javascript:|url\(|var\(|@import|<|>)/i

export function css(decls: Record<string, string | number | undefined | false>): string {
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
const safeColor = (c: unknown) => (typeof c === 'string' && COLOR_RE.test(c.trim()) ? c.trim() : undefined)

/** 给本地素材附加裁切参数（服务器用 sharp 生成对应尺寸） */
export function variantUrl(src: string, fit?: string, w = 1080): string {
  if (!src.startsWith('/media/')) return src
  const q = new URLSearchParams()
  if (fit) q.set('fit', fit)
  q.set('w', String(w))
  return `${src.split('?')[0]}?${q}`
}

class Ctx {
  t: Theme
  opts: CompileOptions
  constructor(t: Theme, opts: CompileOptions) {
    this.t = t
    this.opts = opts
  }
  get c() {
    return this.t.colors
  }
  img(ref: ImageRef | undefined, fit?: string, w?: number) {
    if (!ref?.src) return ''
    const url = variantUrl(ref.src, fit, w)
    return this.opts.mapImage ? this.opts.mapImage(url) : url
  }
  /**
   * 正文样式：字号/行距/字距/颜色由根节点继承，这里只写差异项，
   * 以控制草稿箱接口的 2 万字符上限。font-size:0 的分栏容器内需先用 reset() 恢复。
   */
  text(extra: Record<string, string | number | undefined | false> = {}) {
    return css(extra)
  }
  reset(size = this.t.fontSize) {
    const t = this.t
    return css({ 'font-size': size, 'line-height': t.lineHeight, 'letter-spacing': t.letterSpacing })
  }
  /** 段落：margin-top/bottom 合并为 margin 简写；两端对齐由根节点继承 */
  p(inner: string, extra: Record<string, string | number | undefined | false> = {}) {
    const { 'margin-top': mt, 'margin-bottom': mb, 'text-align': align, ...rest } = extra
    const unit = (v: unknown) => (typeof v === 'number' && v !== 0 ? `${v}px` : v || 0)
    const margin = rest.margin ?? (mt || mb ? `${unit(mt)} 0 ${unit(mb)}` : 0)
    return `<p style="${css({ ...rest, margin, 'text-align': align === 'justify' ? undefined : align })}">${inner}</p>`
  }
  /** 标题字体与正文相同则省略，避免重复长字体栈 */
  get headingFont() {
    return this.t.fontHeading === this.t.fontBody ? undefined : this.t.fontHeading
  }
  /** 装饰性空元素：写入 &nbsp; 防止被编辑器当作空节点删除 */
  spacer(extra: Record<string, string | number | undefined | false>) {
    return `<section style="${css({ 'font-size': 0, 'line-height': 0, overflow: 'hidden', ...extra })}">&nbsp;</section>`
  }
}

// ---------- 富文本 ----------

function renderInline(n: RichNode, ctx: Ctx): string {
  if (n.type === 'hardBreak') return '<br>'
  if (n.type !== 'text') return (n.content ?? []).map((x) => renderInline(x, ctx)).join('')
  let html = esc(n.text ?? '')
  let linkHref: string | undefined
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case 'bold':
        html = `<strong style="${css({ 'font-weight': 700, color: ctx.c.primary })}">${html}</strong>`
        break
      case 'italic':
        html = `<em style="${css({ 'font-style': 'italic' })}">${html}</em>`
        break
      case 'underline':
        html = `<span style="${css({ 'text-decoration': 'underline' })}">${html}</span>`
        break
      case 'strike':
        html = `<span style="${css({ 'text-decoration': 'line-through' })}">${html}</span>`
        break
      case 'highlight':
        html = `<span style="${css({ 'background-color': safeColor(m.attrs?.color) ?? ctx.c.primarySoft, padding: '0 2px' })}">${html}</span>`
        break
      case 'textStyle': {
        const color = safeColor(m.attrs?.color)
        if (color) html = `<span style="${css({ color })}">${html}</span>`
        break
      }
      case 'link':
        linkHref = String(m.attrs?.href ?? '')
        break
    }
  }
  if (linkHref) {
    const wechat = /^https?:\/\/mp\.weixin\.qq\.com\//.test(linkHref)
    if (wechat || ctx.opts.externalLinks === 'keep') {
      html = `<a href="${esc(linkHref)}" style="${css({ color: ctx.c.primary, 'text-decoration': 'underline' })}">${html}</a>`
    } else {
      html = `${html}<span style="${css({ color: ctx.c.muted, 'font-size': ctx.t.smallSize })}">（${esc(linkHref)}）</span>`
    }
  }
  return html
}

export function renderRich(rich: RichText | undefined, ctx: Ctx, align = 'justify', spacing?: number): string {
  const gap = spacing ?? ctx.t.paragraphSpacing
  const blocks = rich?.content ?? []
  const out: string[] = []
  blocks.forEach((n, i) => {
    const last = i === blocks.length - 1
    const mb = last ? 0 : gap
    const nodeAlign = n.attrs?.textAlign ?? align
    if (n.type === 'paragraph') {
      const inner = (n.content ?? []).map((x) => renderInline(x, ctx)).join('')
      out.push(ctx.p(inner || '<br>', { 'margin-bottom': mb, 'text-align': nodeAlign }))
    } else if (n.type === 'heading') {
      const inner = (n.content ?? []).map((x) => renderInline(x, ctx)).join('')
      out.push(ctx.p(inner, { 'margin-bottom': mb, 'font-weight': 700, 'font-size': ctx.t.h2Size - 1, color: ctx.c.primary }))
    } else if (n.type === 'bulletList' || n.type === 'orderedList') {
      // 微信对 ul/ol 的缩进处理不稳定，统一渲染为带符号的段落
      ;(n.content ?? []).forEach((li, j) => {
        const marker = n.type === 'bulletList' ? '●' : `${j + 1}.`
        const inner = (li.content ?? []).map((x) => (x.content ?? []).map((y) => renderInline(y, ctx)).join('')).join('<br>')
        const isLast = j === (n.content?.length ?? 0) - 1
        out.push(
          ctx.p(
            `<span style="${css({ color: ctx.c.primary, 'font-size': n.type === 'bulletList' ? 9 : ctx.t.fontSize, 'margin-right': 8, 'vertical-align': n.type === 'bulletList' ? 'middle' : false })}">${marker}</span>${inner}`,
            { 'margin-bottom': isLast ? mb : 6, 'padding-left': 4 },
          ),
        )
      })
    } else if (n.type === 'blockquote') {
      out.push(
        `<section style="${css({ 'border-left': `3px solid ${ctx.c.border}`, 'padding-left': 12, 'margin-bottom': mb })}">${renderRich(n, ctx, align, 8)}</section>`,
      )
    }
  })
  return out.join('')
}

// ---------- 模块 ----------

type Renderer<T extends Block['type']> = (b: Extract<Block, { type: T }>, ctx: Ctx) => string
type Renderers = { [K in Exclude<Block['type'], 'html'>]: Renderer<K> }

const R: Renderers = {
  cover(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const v = p.variant === 'auto' ? t.coverVariant : p.variant
    const img = p.image ? `<img src="${esc(ctx.img(p.image, '16:10'))}" alt="" style="${css({ width: '100%', display: 'block', 'border-radius': v === 'band' ? 0 : t.imageRadius })}">` : ''
    const title = (extra: Record<string, any> = {}) =>
      ctx.p(esc(p.title), { 'font-size': t.h1Size, 'font-weight': 700, 'line-height': 1.4, 'font-family': ctx.headingFont, 'letter-spacing': 1, ...extra })
    const sub = (extra: Record<string, any> = {}) => (p.subtitle ? ctx.p(esc(p.subtitle), { color: c.muted, 'font-size': t.fontSize - 1, ...extra }) : '')
    const meta = (extra: Record<string, any> = {}) => (p.meta ? ctx.p(esc(p.meta), { color: c.muted, 'font-size': t.smallSize, 'letter-spacing': 1, ...extra }) : '')
    const kicker = (extra: Record<string, any> = {}) => (p.kicker ? ctx.p(esc(p.kicker), { 'font-size': t.smallSize, 'letter-spacing': 2, 'font-weight': 700, ...extra }) : '')

    if (v === 'band') {
      return (
        `<section style="${css({ 'background-color': c.primary, padding: '28px 22px 24px', 'border-radius': `${t.radius}px ${t.radius}px 0 0` })}">` +
        kicker({ color: '#fff', opacity: 0.85, 'margin-bottom': 10 }) +
        title({ color: '#fff' }) +
        (p.subtitle ? ctx.p(esc(p.subtitle), { color: '#fff', opacity: 0.9, 'font-size': t.fontSize - 1, 'margin-top': 10 }) : '') +
        `</section>` +
        (img ? `<section style="${css({ 'border-bottom': `4px solid ${c.accent}` })}">${img}</section>` : ctx.spacer({ height: 4, 'background-color': c.accent })) +
        meta({ 'margin-top': 10, 'text-align': 'right' })
      )
    }
    if (v === 'hero') {
      return (
        img +
        `<section style="${css({ 'background-color': c.primarySoft, padding: '20px 18px', 'border-radius': img ? `0 0 ${t.radius}px ${t.radius}px` : t.radius })}">` +
        (p.kicker ? `<p style="${ctx.text({ margin: '0 0 12px' })}"><span style="${css({ display: 'inline-block', 'background-color': c.primary, color: '#fff', 'font-size': t.smallSize, 'line-height': 1.6, padding: '2px 10px', 'border-radius': Math.max(t.radius, 4), 'letter-spacing': 1 })}">${esc(p.kicker)}</span></p>` : '') +
        title({ color: c.text }) +
        sub({ 'margin-top': 8 }) +
        meta({ 'margin-top': 12 }) +
        `</section>`
      )
    }
    // minimal
    return (
      kicker({ color: c.accent, 'margin-bottom': 14 }) +
      title({ color: c.text, 'font-size': t.h1Size + 2 }) +
      ctx.spacer({ width: 40, height: 3, 'background-color': c.primary, margin: '16px 0' }) +
      sub({ 'margin-bottom': 6 }) +
      meta({ 'margin-bottom': img ? 18 : 0 }) +
      img
    )
  },

  heading(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const v = p.variant === 'auto' ? t.headingVariant : p.variant
    const sub = p.subtitle ? ctx.p(esc(p.subtitle), { color: c.muted, 'font-size': t.smallSize + 1, 'margin-top': 4, 'text-align': v === 'pill' || v === 'underline' ? 'center' : 'left' }) : ''
    const titleStyle = { 'font-size': t.h2Size, 'font-weight': 700, 'font-family': ctx.headingFont, 'line-height': 1.5 }
    if (v === 'number') {
      // 大号衬线序号 + 标题，下方双色细线
      return (
        ctx.p(
          (p.index ? `<span style="${css({ 'font-size': 34, 'font-weight': 400, color: c.primary, 'font-family': 'Georgia,serif', 'margin-right': 12, 'vertical-align': 'middle', 'line-height': 1.1, 'letter-spacing': 0 })}">${esc(p.index)}</span>` : '') +
            `<span style="${css({ ...titleStyle, color: c.text, 'vertical-align': 'middle' })}">${esc(p.title)}</span>`,
          { 'padding-bottom': 6 },
        ) +
        ctx.spacer({ width: 44, height: 3, 'background-color': c.primary }) +
        ctx.spacer({ height: 1, 'background-color': c.border }) +
        sub
      )
    }
    if (v === 'bar') {
      return (
        `<section style="${css({ 'border-left': `4px solid ${c.primary}`, 'padding-left': 12, 'background-color': c.primarySoft, padding: '8px 12px', 'border-radius': `0 ${t.radius}px ${t.radius}px 0` })}">` +
        ctx.p(
          (p.index ? `<span style="${css({ color: c.primary, 'font-weight': 700, 'margin-right': 8, 'font-size': t.h2Size })}">${esc(p.index)}</span>` : '') +
            `<span style="${css({ ...titleStyle, color: c.text })}">${esc(p.title)}</span>`,
        ) +
        `</section>` +
        sub
      )
    }
    if (v === 'pill') {
      return (
        `<section style="${css({ 'text-align': 'center' })}">` +
        `<p style="${ctx.text({ margin: 0, 'text-align': 'center' })}"><span style="${css({ display: 'inline-block', 'background-color': c.primary, color: '#fff', 'border-radius': 999, padding: '6px 22px', 'font-size': t.h2Size - 1, 'font-weight': 700, 'line-height': 1.5, 'box-shadow': `0 3px 0 ${c.accent}` })}">${p.index ? esc(p.index) + ' · ' : ''}${esc(p.title)}</span></p>` +
        `</section>` +
        sub
      )
    }
    // underline
    return (
      (p.index ? ctx.p(`— ${esc(p.index)} —`, { 'text-align': 'center', color: c.accent, 'font-size': t.smallSize, 'letter-spacing': 3, 'margin-bottom': 4 }) : '') +
      ctx.p(esc(p.title), { ...titleStyle, color: c.text, 'text-align': 'center' }) +
      ctx.spacer({ width: 32, height: 3, 'background-color': c.primary, margin: '10px auto 0' }) +
      sub
    )
  },

  paragraph(b, ctx) {
    return renderRich(b.props.content, ctx, b.props.align)
  },

  card(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const v = p.variant === 'auto' ? t.cardVariant : p.variant
    const body = renderRich(p.content, ctx, 'justify', 10)
    if (v === 'accent') {
      return (
        `<section style="${css({ 'background-color': c.primarySoft, 'border-radius': t.radius, padding: '16px 18px' })}">` +
        (p.title ? `<p style="${ctx.text({ margin: '0 0 10px' })}"><span style="${css({ display: 'inline-block', 'background-color': c.accent, color: '#fff', 'font-weight': 700, 'font-size': t.fontSize - 1, 'line-height': 1.6, padding: '2px 12px', 'border-radius': 999 })}">${esc(p.title)}</span></p>` : '') +
        body +
        `</section>`
      )
    }
    const box =
      v === 'fill'
        ? { 'background-color': c.surface, 'border-radius': t.radius, padding: '16px 18px', border: `1px solid ${c.surface}` }
        : { border: `1px solid ${c.border}`, 'border-top': `3px solid ${c.primary}`, 'border-radius': t.radius, padding: '14px 16px', 'background-color': '#fff' }
    return (
      `<section style="${css(box)}">` +
      (p.title
        ? ctx.p(`<span style="${css({ color: c.accent, 'font-size': 10, 'margin-right': 6, 'vertical-align': 'middle' })}">■</span>${esc(p.title)}`, { 'font-weight': 700, color: c.primary, 'font-size': t.fontSize + 1, 'margin-bottom': 8, 'font-family': ctx.headingFont })
        : '') +
      body +
      `</section>`
    )
  },

  quote(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const v = p.variant === 'auto' ? t.quoteVariant : p.variant
    const source = (align: string) => (p.source ? ctx.p(`—— ${esc(p.source)}`, { 'font-size': t.smallSize + 1, color: c.muted, 'text-align': align, 'margin-top': 8 }) : '')
    if (v === 'mark') {
      return (
        `<section style="${css({ 'background-color': c.surface, 'border-radius': t.radius, padding: '6px 18px 16px' })}">` +
        ctx.p('“', { 'font-size': 44, 'line-height': 1.1, color: c.primary, 'font-family': 'Georgia,serif', height: 34, overflow: 'hidden' }) +
        ctx.p(esc(p.text), { 'font-size': t.fontSize + 1, 'font-family': ctx.headingFont, color: c.text }) +
        source('right') +
        `</section>`
      )
    }
    if (v === 'center') {
      return (
        ctx.p(`<span style="${css({ color: c.border })}">———</span><span style="${css({ color: c.primary, margin: '0 10px' })}">❝</span><span style="${css({ color: c.border })}">———</span>`, { 'text-align': 'center', 'margin-bottom': 10 }) +
        ctx.p(esc(p.text), { 'text-align': 'center', 'font-size': t.fontSize + 2, 'font-family': ctx.headingFont, color: c.primary, 'line-height': 1.8, padding: '0 12px' }) +
        source('center')
      )
    }
    return (
      `<section style="${css({ 'border-left': `3px solid ${c.primary}`, 'padding-left': 14 })}">` +
      ctx.p(esc(p.text), { 'font-size': t.fontSize + 1, 'font-family': ctx.headingFont, color: c.text }) +
      source('left') +
      `</section>`
    )
  },

  imageText(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const img = p.image
      ? `<img src="${esc(ctx.img(p.image, '3:4', 720))}" alt="" style="${css({ width: '100%', display: 'block', 'border-radius': t.imageRadius })}">`
      : ctx.spacer({ height: 160, 'background-color': c.primarySoft, 'border-radius': t.imageRadius })
    const imgCol = `<section style="${css({ display: 'inline-block', width: '40%', 'vertical-align': 'top', 'box-sizing': 'border-box' })}">${img}</section>`
    const textCol =
      `<section style="${css({ display: 'inline-block', width: '55%', 'vertical-align': 'top', 'box-sizing': 'border-box' })}${ctx.reset(t.fontSize - 1)}">` +
      (p.title ? ctx.p(esc(p.title), { 'font-weight': 700, color: c.primary, 'font-size': t.fontSize + 1, 'margin-bottom': 6, 'font-family': ctx.headingFont }) : '') +
      renderRich(p.content, ctx, 'left', 8) +
      `</section>`
    const gap = `<section style="${css({ display: 'inline-block', width: '5%', 'font-size': 0 })}">&nbsp;</section>`
    return `<section style="${css({ 'font-size': 0, 'white-space': 'normal' })}">${p.imagePosition === 'right' ? textCol + gap + imgCol : imgCol + gap + textCol}</section>`
  },

  image(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    if (!p.image) return ctx.p('（请选择图片）', { color: c.muted, 'text-align': 'center', 'background-color': c.surface, padding: '40px 0' })
    const radius = p.variant === 'rounded' ? 12 : t.imageRadius
    // 竖图通栏会占满整屏，裁成 4:5
    const portrait = (p.image.height ?? 0) > (p.image.width ?? 0) * 1.1
    const img = `<img src="${esc(ctx.img(p.image, portrait ? '4:5' : undefined))}" alt="${esc(p.image.alt ?? '')}" style="${css({ width: '100%', display: 'block', 'border-radius': radius })}">`
    const framed = p.variant === 'framed'
    const cap = p.caption ? ctx.p(`<span style="${css({ color: c.primary, 'margin-right': 4 })}">▲</span>${esc(p.caption)}`, { 'font-size': t.smallSize, color: c.muted, 'text-align': 'center', 'margin-top': 8 }) : ''
    return framed
      ? `<section style="${css({ padding: 8, border: `1px solid ${c.border}`, 'background-color': '#fff', 'box-shadow': '0 2px 8px rgba(0,0,0,0.06)' })}">${img}</section>${cap}`
      : img + cap
  },

  gallery(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    if (!p.images.length) return ctx.p('（相册：请添加图片）', { color: c.muted, 'text-align': 'center', 'background-color': c.surface, padding: '40px 0' })
    const cols = p.columns
    const fit = cols === 1 ? undefined : cols === 2 ? '4:3' : '1:1'
    const gapPct = cols === 1 ? 0 : 2
    const w = (100 - gapPct * (cols - 1)) / cols
    const rows: string[] = []
    for (let i = 0; i < p.images.length; i += cols) {
      const cells = p.images.slice(i, i + cols).map((im, j) => {
        const img = `<img src="${esc(ctx.img(im, fit, cols === 1 ? 1080 : 720))}" alt="" style="${css({ width: '100%', display: 'block', 'border-radius': t.imageRadius })}">`
        return `<section style="${css({ display: 'inline-block', width: `${w}%`, 'vertical-align': 'top', 'margin-left': j === 0 ? 0 : `${gapPct}%` })}">${img}</section>`
      })
      const last = i + cols >= p.images.length
      rows.push(`<section style="${css({ 'font-size': 0, 'margin-bottom': last ? 0 : cols === 1 ? 10 : 6 })}">${cells.join('')}</section>`)
    }
    const cap = p.caption ? ctx.p(esc(p.caption), { 'font-size': t.smallSize, color: c.muted, 'text-align': 'center', 'margin-top': 8 }) : ''
    return rows.join('') + cap
  },

  timeline(b, ctx) {
    const { t, c } = ctx
    const items = b.props.items
    return items
      .map((it, i) => {
        const last = i === items.length - 1
        return (
          `<section style="${css({ 'border-left': `2px solid ${last ? 'transparent' : c.border}`, 'margin-left': 6, 'padding-left': 16, 'padding-bottom': last ? 0 : 16 })}">` +
          `<p style="${ctx.text({ margin: 0, 'line-height': 1.6 })}"><span style="${css({ display: 'inline-block', 'background-color': c.primary, color: '#fff', 'font-size': t.smallSize, 'font-weight': 700, 'line-height': 1.7, padding: '0 8px', 'border-radius': Math.min(t.radius + 2, 10), 'margin-right': 8 })}">${esc(it.time)}</span><span style="${css({ 'font-weight': 700, color: c.text, 'font-size': t.fontSize })}">${esc(it.title)}</span></p>` +
          (it.desc ? ctx.p(esc(it.desc), { color: c.muted, 'font-size': t.fontSize - 1, 'margin-top': 4 }) : '') +
          `</section>`
        )
      })
      .join('')
  },

  table(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const cell = (extra: Record<string, any>) =>
      css({ padding: '8px 10px', 'font-size': t.fontSize - 1, 'line-height': 1.6, 'text-align': 'center', 'border-bottom': `1px solid ${c.border}`, ...extra })
    const head = `<tr>${p.headers.map((h) => `<th style="${cell({ 'background-color': c.primary, color: '#fff', 'font-weight': 700, 'border-bottom': `1px solid ${c.primary}` })}">${esc(h)}</th>`).join('')}</tr>`
    const body = p.rows
      .map((r, i) => `<tr>${r.map((v, j) => `<td style="${cell({ color: j === 0 ? c.text : c.primary, 'font-weight': j === 0 ? 400 : 700, 'background-color': i % 2 ? c.surface : '#fff' })}">${esc(v)}</td>`).join('')}</tr>`)
      .join('')
    const cap = p.caption ? ctx.p(esc(p.caption), { 'font-size': t.smallSize, color: c.muted, 'text-align': 'center', 'margin-top': 8 }) : ''
    return `<table style="${css({ width: '100%', 'border-collapse': 'collapse', 'border-radius': t.radius, overflow: 'hidden' })}"><thead>${head}</thead><tbody>${body}</tbody></table>${cap}`
  },

  profile(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    const avatar = p.image
      ? `<img src="${esc(ctx.img(p.image, '1:1', 240))}" alt="" style="${css({ width: 64, height: 64, display: 'block', 'border-radius': 999, border: `2px solid ${c.primary}` })}">`
      : `<p style="${css({ margin: 0, width: 64, height: 64, 'line-height': 64, 'border-radius': 999, 'background-color': c.primary, color: '#fff', 'text-align': 'center', 'font-size': 24, 'font-weight': 700 })}">${esc(p.name.slice(0, 1))}</p>`
    return (
      `<section style="${css({ 'background-color': c.surface, 'border-radius': t.radius, padding: 16, border: `1px solid ${c.border}` })}">` +
      `<section style="${css({ 'font-size': 0 })}">` +
      `<section style="${css({ display: 'inline-block', width: 64, 'vertical-align': 'middle' })}">${avatar}</section>` +
      `<section style="${css({ display: 'inline-block', width: '70%', 'vertical-align': 'middle', 'padding-left': 14, 'box-sizing': 'border-box' })}${ctx.reset()}">` +
      ctx.p(esc(p.name), { 'font-weight': 700, 'font-size': t.fontSize + 2, color: c.text, 'line-height': 1.5 }) +
      ctx.p(esc(p.role), { 'font-size': t.smallSize + 1, color: c.primary, 'line-height': 1.5 }) +
      `</section></section>` +
      (p.bio ? ctx.p(esc(p.bio), { 'margin-top': 12, 'font-size': t.fontSize - 1, color: c.text }) : '') +
      `</section>`
    )
  },

  divider(b, ctx) {
    const { c } = ctx
    const v = b.props.variant === 'auto' ? ctx.t.dividerVariant : b.props.variant
    if (v === 'line') return ctx.spacer({ height: 1, 'background-color': c.border, margin: '6px 0' })
    if (v === 'space') return ctx.spacer({ height: 24 })
    if (v === 'dots') return ctx.p(`<span style="${css({ color: c.primary })}">●</span><span style="${css({ color: c.accent, margin: '0 10px' })}">●</span><span style="${css({ color: c.primary })}">●</span>`, { 'text-align': 'center', 'font-size': 8, 'letter-spacing': 0 })
    return ctx.p(
      `<span style="${css({ color: c.border })}">━━━━━</span><span style="${css({ color: c.primary, margin: '0 10px', 'font-size': 12 })}">◆</span><span style="${css({ color: c.border })}">━━━━━</span>`,
      { 'text-align': 'center', 'font-size': 12, 'letter-spacing': 0 },
    )
  },

  ending(b, ctx) {
    const { t, c } = ctx
    const p = b.props
    // END 标记 + 结尾语 + 引导语，署名放在浅底信息条中
    return (
      `<section style="${css({ 'text-align': 'center' })}">` +
      ctx.p(
        `<span style="${css({ color: c.border })}">———</span><span style="${css({ color: c.muted, margin: '0 12px', 'letter-spacing': 4, 'font-size': t.smallSize })}">END</span><span style="${css({ color: c.border })}">———</span>`,
        { 'text-align': 'center', 'margin-bottom': 14 },
      ) +
      (p.text ? ctx.p(esc(p.text), { 'text-align': 'center', 'font-size': t.h2Size, 'font-weight': 700, color: c.primary, 'font-family': ctx.headingFont, 'letter-spacing': 2 }) : '') +
      (p.note ? ctx.p(esc(p.note), { 'text-align': 'center', 'font-size': t.smallSize + 1, color: c.muted, 'margin-top': 6 }) : '') +
      (p.image ? `<section style="${css({ width: '36%', margin: '16px auto 0' })}"><img src="${esc(ctx.img(p.image, '1:1', 480))}" alt="" style="${css({ width: '100%', display: 'block' })}"></section>` : '') +
      (p.author
        ? `<section style="${css({ 'background-color': c.surface, 'border-radius': t.radius, padding: '10px 14px', 'margin-top': 18 })}">` +
          ctx.p(esc(p.author), { 'text-align': 'center', 'font-size': t.smallSize, color: c.muted, 'white-space': 'pre-wrap', 'line-height': 1.8 }) +
          `</section>`
        : '') +
      `</section>`
    )
  },
}

/** 原文片段：存储时已清洗，输出前再做一次字符串级防护 */
function renderHtml(b: Extract<Block, { type: 'html' }>, ctx: Ctx): string {
  const map = ctx.opts.mapImage
  const html = guardHtml(b.props.html)
  return map ? html.replace(/(<img\b[^>]*\ssrc=")([^"]+)(")/gi, (_m, a, u, z) => a + esc(map(u.replace(/&amp;/g, '&'))) + z) : html
}

export function compileBlock(block: Block, theme: Theme, opts: CompileOptions = {}): string {
  const ctx = new Ctx(theme, opts)
  if (block.type === 'html') return renderHtml(block, ctx)
  const render = R[block.type as Exclude<Block['type'], 'html'>] as Renderer<Exclude<Block['type'], 'html'>>
  return render(block as never, ctx)
}

export interface CompileResult {
  html: string
  charCount: number
  warnings: string[]
}

/** 根节点样式：正文字体、字号、行距、颜色等由此继承（画布中的每个模块也包在同样的根样式里） */
export function rootStyle(theme: Theme): string {
  return css({ 'font-family': theme.fontBody, 'font-size': theme.fontSize, color: theme.colors.text, 'line-height': theme.lineHeight, 'letter-spacing': theme.letterSpacing, 'text-align': 'justify', 'background-color': theme.colors.bg, 'word-break': 'break-word' })
}

/** 编译整篇文章为微信 HTML */
/** 模块之间的间距：相邻的原文片段保持原文连续（不插入间距） */
export function blockGap(block: Block, next: Block | undefined, theme: Theme): number {
  if (!next) return 0
  return block.type === 'html' && next.type === 'html' ? 0 : theme.blockSpacing
}

export function compileDoc(doc: Doc, opts: CompileOptions = {}): CompileResult {
  const theme = resolveTheme(doc)
  const failed: number[] = []
  const parts = doc.blocks.map((b, i) => {
    let inner: string
    try {
      inner = compileBlock(b, theme, opts)
    } catch {
      // 单个模块数据损坏时跳过，不影响整篇输出
      failed.push(i + 1)
      return ''
    }
    return `<section style="${css({ 'margin-bottom': blockGap(b, doc.blocks[i + 1], theme) })}">${inner}</section>`
  })
  const html =
    `<section style="${rootStyle(theme)}">` +
    parts.join('') +
    `</section>`
  const warnings = lintWechatHtml(html)
  if (failed.length) warnings.unshift(`第 ${failed.join('、')} 个模块数据异常，已跳过输出`)
  return { html, charCount: html.length, warnings }
}

/** 针对公众号编辑器已知限制的静态检查（不等于真机验证） */
export function lintWechatHtml(html: string): string[] {
  const w: string[] = []
  if (/<script/i.test(html)) w.push('包含 <script>，微信会移除')
  if (/<style/i.test(html)) w.push('包含 <style>，微信会移除，样式需内联')
  if (/\sclass=/i.test(html)) w.push('包含 class 属性，样式不会生效')
  if (/\sid=/i.test(html)) w.push('包含 id 属性')
  if (/position\s*:\s*(absolute|fixed)/i.test(html)) w.push('使用了绝对/固定定位，部分情况下会被微信过滤')
  if (/var\(/i.test(html)) w.push('使用了 CSS 变量')
  if (/src="(http:\/\/(localhost|127\.0\.0\.1)|\/media\/)/i.test(html)) w.push('含本地图片地址，粘贴到微信后无法显示，请使用“内嵌图片”或“上传到微信”')
  if (/<a\s[^>]*href="(?!https?:\/\/mp\.weixin\.qq\.com)/i.test(html)) w.push('含非公众号外链，可能被微信过滤')
  if (html.length >= 20000) w.push(`HTML 长度 ${html.length} 字符，超过草稿箱接口 20,000 字符上限（复制粘贴不受此限）`)
  return w
}
