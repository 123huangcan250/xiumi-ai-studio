import { applyImageWidths } from './imageResize'
// 清华电机 · 德国实践套件：大型文本框、轮播、图片框、双图 / 三图 / 四图。
// 视觉语言：清华紫做框架；德国国旗的黑红金只做细条和图注标记；
// 电机系的签名是一组“三相正弦波”——三条相位差 120° 的波形，分别用黑、红、金。
// 版式全部是内联样式 + 行内块；轮播用横向滚动（已发布的公众号推文里常见的写法），SVG 只用于装饰波形。
import { css, esc, type Decls } from './style'
import type { Block, BlockPropsMap, ImageRef, PicItem, Theme } from './types'

export const KIT = {
  purple: '#660874',
  purpleSoft: '#F7F2F8',
  line: '#E3D6E7',
  dash: '#CDB9D3',
  black: '#000000',
  red: '#DD0000',
  gold: '#FFCE00',
  /** 正文：14 号黑色 */
  text: '#000000',
  /** 图注：12 号灰色 */
  caption: '#888888',
  faint: '#B5A9BA',
  bodySize: 14,
  captionSize: 12,
  titleSize: 17,
} as const

export const KIT_TYPES = ['box', 'carousel', 'frame', 'photos'] as const
export type KitType = (typeof KIT_TYPES)[number]

export interface KitCtx {
  img(ref: ImageRef | undefined, fit?: string, w?: number): string
  /** 画布模式：空图片位和空图注显示占位提示 */
  hints: boolean
  inBox: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const pad2 = (n: number) => String(n).padStart(2, '0')
const p = (inner: string, d: Decls) => `<p style="${css({ margin: 0, ...d })}">${inner}</p>`

/** 装饰性空元素：写入 &nbsp; 防止被编辑器当作空节点删除 */
const spacer = (d: Decls) => `<section style="${css({ 'font-size': 0, 'line-height': 0, overflow: 'hidden', ...d })}">&nbsp;</section>`

/** 通栏三色条：黑、红、金三等分 */
export function flagStrip(h = 3): string {
  const cell = (c: string, w: string) => `<section style="${css({ display: 'inline-block', width: w, height: h, 'background-color': c, 'vertical-align': 'top', overflow: 'hidden' })}">&nbsp;</section>`
  return `<section style="${css({ 'font-size': 0, 'line-height': 0 })}">${cell(KIT.black, '33.33%')}${cell(KIT.red, '33.34%')}${cell(KIT.gold, '33.33%')}</section>`
}

/** 图注前的微型国旗短条（一个元素：左边框黑、底色红、右边框金） */
function flagDash(gap = 6): string {
  return `<span style="${css({ display: 'inline-block', width: 15, height: 3, 'border-left': `5px solid ${KIT.black}`, 'border-right': `5px solid ${KIT.gold}`, 'background-color': KIT.red, 'box-sizing': 'border-box', 'vertical-align': 'middle', 'margin-right': gap, 'font-size': 0, 'line-height': 0, overflow: 'hidden' })}">&nbsp;</span>`
}

/** 竖排国旗色块（与国旗同向：黑在上、金在下） */
function flagChip(w = 5, h = 7): string {
  return `<section style="${css({ display: 'inline-block', width: w, 'vertical-align': 'middle' })}">${[KIT.black, KIT.red, KIT.gold].map((c) => spacer({ height: h, 'background-color': c })).join('')}</section>`
}

/** 三相正弦波：相位依次相差 120°；只给一种颜色时是单相波 */
export function phaseWave(w = 96, h = 16, colors: readonly string[] = [KIT.black, KIT.red, KIT.gold]): string {
  // 一个半周期，读起来像示波器上的三相波形，而不是麻花
  const P = Math.max(24, Math.round(w / 1.5))
  const mid = h / 2
  const amp = mid - 1.5
  const path = (shift: number, color: string) => {
    let x = -P + shift
    let d = `M${r2(x)} ${mid} Q${r2(x + P / 4)} ${r2(mid - 2 * amp)} ${r2(x + P / 2)} ${mid}`
    for (x += P / 2; x < w; x += P / 2) d += ` T${r2(x + P / 2)} ${mid}`
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round"></path>`
  }
  const paths = colors.map((c, i) => path((i * P) / 3, c)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="${css({ display: 'inline-block', 'vertical-align': 'middle', width: w, height: h })}">${paths}</svg>`
}

/** 文本框底部的系标：左侧文字，右侧三相波 */
function mark(padding: string): string {
  return (
    `<section style="${css({ 'font-size': 0, 'line-height': 0, padding })}">` +
    `<section style="${css({ display: 'inline-block', width: '50%', 'vertical-align': 'middle', 'font-size': 9, 'line-height': 1.4, 'letter-spacing': 2, color: KIT.faint })}">TSINGHUA · EEA</section>` +
    `<section style="${css({ display: 'inline-block', width: '50%', 'vertical-align': 'middle', 'text-align': 'right', 'line-height': 0 })}">${phaseWave()}</section>` +
    `</section>`
  )
}

const HINT = `<span style="${css({ color: '#C4B5C9' })}">图注（可留空）</span>`

/** 图注：12 号灰色，前面是国旗短条；没有图注时不输出（画布中显示占位） */
function capLine(ctx: KitCtx, text: string, d: Decls = {}): string {
  if (!text && !ctx.hints) return ''
  return p(flagDash() + (text ? esc(text) : HINT), { 'margin-top': 6, 'font-size': KIT.captionSize, color: KIT.caption, 'line-height': 1.6, 'letter-spacing': 0.3, 'text-align': 'left', ...d })
}

/** 空图片位的占位图（只在画布中出现），比例与相框一致，可直接拖入素材 */
function placeholder(ratio: string, label: string): string {
  const [w, h] = ratio.split(':').map(Number)
  const W = 400
  const H = Math.round((W * h) / w)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#F4EEF6"/>` +
    `<rect x="7" y="7" width="${W - 14}" height="${H - 14}" fill="none" stroke="#C9B3D0" stroke-width="2" stroke-dasharray="9 7"/>` +
    `<text x="50%" y="50%" fill="#9A7FA3" font-size="26" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">＋ ${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 图片位：有图输出图片；空位在画布中显示占位图，导出时为空 */
function pic(ctx: KitCtx, image: ImageRef | undefined, slot: number, fit: string | undefined, w = 1080, ratio = fit ?? '4:3'): string {
  const style = css({ width: '100%', display: 'block' })
  if (image?.src) return applyImageWidths(`<img src="${esc(ctx.img(image, fit, w))}" alt="" style="${style}">`, image)
  if (ctx.hints) return `<img src="${placeholder(ratio, `图片 ${slot + 1}`)}" data-slot="${slot}" alt="" style="${style}">`
  return ''
}

const portrait = (im?: ImageRef) => !!im && (im.height ?? 0) > (im.width ?? 0) * 1.1

// ---------- 大型文本框 ----------

const labelStyle = (color: string): Decls => ({ 'font-size': 10, 'letter-spacing': 2, 'line-height': 1.5, color, 'font-weight': 700 })
const titleStyle = (color: string): Decls => ({ 'font-size': KIT.titleSize, 'font-weight': 700, color, 'line-height': 1.5, 'letter-spacing': 1 })

export interface BoxParts {
  /** 外框样式 */
  outer: string
  header: string
  /** 内容区样式：14 号黑色正文，框内模块都继承它 */
  body: string
  footer: string
}

/** 文本框拆成外框、页眉、内容区、页脚，画布在内容区里放可拖动的子模块 */
export function boxParts(props: BlockPropsMap['box'], _ctx?: KitCtx): BoxParts {
  const body = { 'font-size': KIT.bodySize, color: KIT.text, 'line-height': 1.75, 'letter-spacing': 0.5 }
  const label = esc(props.label)
  const title = esc(props.title)
  if (props.variant === 'rule') {
    return {
      outer: css({ 'border-top': `3px solid ${KIT.purple}`, 'border-bottom': `1px solid ${KIT.line}`, 'background-color': '#ffffff' }),
      header:
        title || label
          ? `<section style="${css({ 'font-size': 0, padding: '14px 0 12px' })}">` +
            `<section style="${css({ display: 'inline-block', width: '6%', 'vertical-align': 'middle' })}">${flagChip()}</section>` +
            `<section style="${css({ display: 'inline-block', width: '94%', 'vertical-align': 'middle' })}">` +
            (label ? p(label, labelStyle(KIT.faint)) : '') +
            (title ? p(title, titleStyle(KIT.purple)) : '') +
            `</section></section>`
          : spacer({ height: 14 }),
      body: css({ ...body, padding: '2px 0 4px' }),
      footer: mark('12px 0 12px'),
    }
  }
  if (props.variant === 'paper') {
    return {
      outer: css({ 'background-color': KIT.purpleSoft }),
      header:
        flagStrip(4) +
        (title || label
          ? `<section style="${css({ padding: '18px 16px 2px', 'text-align': 'center' })}">` +
            (label ? p(`— ${label} —`, { ...labelStyle(KIT.purple), 'letter-spacing': 3, 'text-align': 'center', opacity: 0.7 }) : '') +
            (title ? p(title, { ...titleStyle(KIT.purple), 'text-align': 'center', 'margin-top': label ? 4 : 0 }) : '') +
            `<section style="${css({ 'line-height': 0, 'margin-top': 10, 'text-align': 'center' })}">${phaseWave(56, 10, [KIT.purple])}</section>` +
            `</section>`
          : ''),
      body: css({ ...body, padding: '16px 16px 4px' }),
      footer: mark('12px 16px 14px'),
    }
  }
  // plate：紫色铭牌页眉 + 三色条
  return {
    outer: css({ border: `1px solid ${KIT.line}`, 'background-color': '#ffffff' }),
    header:
      (title || label
        ? `<section style="${css({ 'background-color': KIT.purple, padding: '12px 16px 13px' })}">` +
          (label ? p(label, labelStyle(KIT.gold)) : '') +
          (title ? p(title, { ...titleStyle('#ffffff'), 'margin-top': label ? 3 : 0 }) : '') +
          `</section>`
        : '') + flagStrip(3),
    body: css({ ...body, padding: '18px 16px 4px' }),
    footer: mark('12px 16px 12px'),
  }
}

/** 文本框内的模块统一为 14 号黑色正文、12 号灰色注释、清华紫强调色，间距收紧 */
export function boxTheme(t: Theme): Theme {
  return {
    ...t,
    fontSize: KIT.bodySize,
    smallSize: KIT.captionSize,
    lineHeight: 1.75,
    letterSpacing: 0.5,
    paragraphSpacing: 12,
    blockSpacing: 16,
    h1Size: Math.min(t.h1Size, 20),
    h2Size: 16,
    colors: { ...t.colors, primary: KIT.purple, primarySoft: KIT.purpleSoft, text: KIT.text, muted: KIT.caption, border: KIT.line, surface: '#FAF7FB' },
  }
}

// ---------- 图片模块 ----------

function carousel(b: Block<'carousel'>, ctx: KitCtx): string {
  const { pics, ratio, variant, label } = b.props
  let slots = pics.map((it, slot) => ({ it, slot })).filter(({ it }) => it.image?.src || ctx.hints)
  if (!slots.length) {
    if (!ctx.hints) return ''
    slots = [{ it: { caption: '' }, slot: 0 }]
  }
  const n = slots.length
  const head =
    label || n > 1
      ? `<section style="${css({ 'font-size': 0, 'line-height': 1.5, 'margin-bottom': 8 })}">` +
        `<section style="${css({ display: 'inline-block', width: '62%', 'vertical-align': 'middle' })}">${label ? p(flagDash() + esc(label), { 'font-size': 11, 'font-weight': 700, 'letter-spacing': 1.5, color: KIT.purple, 'line-height': 1.5 }) : '&nbsp;'}</section>` +
        `<section style="${css({ display: 'inline-block', width: '38%', 'vertical-align': 'middle', 'text-align': 'right' })}">${n > 1 ? p('‹ 左右滑动 ›', { 'font-size': 11, color: KIT.faint, 'letter-spacing': 1, 'line-height': 1.5, 'text-align': 'right' }) : '&nbsp;'}</section>` +
        `</section>`
      : ''
  const slide = ({ it, slot }: { it: PicItem; slot: number }, k: number) => {
    const num =
      n > 1
        ? `<span style="${css({ color: KIT.purple, 'font-weight': 700, 'letter-spacing': 0.5 })}">${pad2(k + 1)}</span><span style="${css({ color: '#BBBBBB', margin: '0 8px 0 3px' })}">/ ${pad2(n)}</span>`
        : ''
    const cap = it.caption ? esc(it.caption) : ctx.hints ? HINT : ''
    return (
      `<section style="${css({ display: n > 1 ? 'inline-block' : 'block', width: n > 1 ? `${r2(100 / n)}%` : undefined, 'vertical-align': 'top', 'box-sizing': 'border-box', 'padding-right': n > 1 && k < n - 1 ? 8 : 0, 'font-size': KIT.captionSize, 'line-height': 1.6, 'white-space': 'normal' })}">` +
      pic(ctx, it.image, slot, ratio, 720) +
      (num || cap ? p(num + cap, { 'margin-top': 8, 'font-size': KIT.captionSize, color: KIT.caption, 'line-height': 1.6, 'letter-spacing': 0.3, 'text-align': 'left' }) : '') +
      `</section>`
    )
  }
  if (n === 1) return head + slide(slots[0], 0)
  // 露出下一张的一角，提示可以滑动；轨道宽度按张数计算，首张靠左、末张靠右
  const track = n * (variant === 'peek' ? 84 : 100)
  return (
    head +
    `<section style="${css({ display: 'inline-block', width: '100%', 'vertical-align': 'top', 'overflow-x': 'auto', 'box-sizing': 'border-box' })}">` +
    `<section style="${css({ width: `${track}%`, 'max-width': `${track}% !important`, 'font-size': 0, 'line-height': 0, overflow: 'hidden', 'box-sizing': 'border-box' })}">` +
    slots.map(slide).join('') +
    `</section></section>`
  )
}

function frame(b: Block<'frame'>, ctx: KitCtx): string {
  const { image, caption, label, variant } = b.props
  const fit = portrait(image) ? '4:5' : undefined
  const img = pic(ctx, image, 0, fit, 1080, '4:3')
  if (!img) return ''
  const P = KIT.purple
  const labelSpan = label ? `<span style="${css({ 'font-size': 10, 'font-weight': 700, 'letter-spacing': 1.5, color: P })}">${esc(label)}</span>` : ''
  const capRow = (d: Decls = {}) => {
    const cap = capLine(ctx, caption, { 'margin-top': 0 })
    if (!cap && !labelSpan) return ''
    return (
      `<section style="${css({ 'font-size': 0, 'line-height': 1.5, ...d })}">` +
      `<section style="${css({ display: 'inline-block', width: '70%', 'vertical-align': 'top', 'font-size': KIT.captionSize })}">${cap || '&nbsp;'}</section>` +
      `<section style="${css({ display: 'inline-block', width: '30%', 'vertical-align': 'top', 'text-align': 'right', 'font-size': KIT.captionSize, 'line-height': 1.6 })}">${labelSpan || '&nbsp;'}</section>` +
      `</section>`
    )
  }

  if (variant === 'circuit') {
    // 电路板走线角框：左上、右下两个直角，端点是焊盘圆点
    const pad = (align: 'top' | 'bottom') =>
      `<section style="${css({ display: 'inline-block', width: 8, height: 8, border: `2px solid ${P}`, 'border-radius': 8, 'background-color': '#ffffff', 'box-sizing': 'border-box', 'vertical-align': align, overflow: 'hidden', 'margin-top': align === 'top' ? -3 : undefined, 'margin-bottom': align === 'bottom' ? -3 : undefined })}">&nbsp;</section>`
    const corner = (sides: Decls) => `<section style="${css({ display: 'inline-block', width: 40, height: 14, 'box-sizing': 'border-box', 'vertical-align': 'bottom', overflow: 'hidden', ...sides })}">&nbsp;</section>`
    const line = `2px solid ${P}`
    return (
      `<section style="${css({ 'font-size': 0, 'line-height': 0 })}">${corner({ 'border-top': line, 'border-left': line, 'vertical-align': 'top' })}${pad('top')}</section>` +
      `<section style="${css({ margin: '-7px 7px 0', 'line-height': 0 })}">${img}</section>` +
      `<section style="${css({ 'font-size': 0, 'line-height': 0, 'text-align': 'right', 'margin-top': -7 })}">${pad('bottom')}${corner({ 'border-bottom': line, 'border-right': line })}</section>` +
      capRow({ margin: '6px 7px 0' })
    )
  }
  if (variant === 'ticket') {
    // 车票：图片下方是虚线撕口和票根（行程 + 系标）
    return (
      `<section style="${css({ border: `1px solid ${KIT.line}`, 'background-color': '#ffffff', 'box-sizing': 'border-box' })}">` +
      img +
      `<section style="${css({ 'border-top': `1px dashed ${KIT.dash}`, padding: '9px 12px 10px', 'font-size': 0, 'line-height': 1.5 })}">` +
      `<section style="${css({ display: 'inline-block', width: '60%', 'vertical-align': 'middle' })}">${label ? p(esc(label), { 'font-size': 11, 'font-weight': 700, 'letter-spacing': 1.5, color: P, 'line-height': 1.5 }) : '&nbsp;'}</section>` +
      `<section style="${css({ display: 'inline-block', width: '40%', 'vertical-align': 'middle', 'text-align': 'right' })}">${p(flagDash(5) + 'TSINGHUA EEA', { 'font-size': 9, 'letter-spacing': 1.5, color: KIT.faint, 'line-height': 1.6, 'text-align': 'right' })}</section>` +
      `</section></section>` +
      capLine(ctx, caption, { 'margin-top': 8 })
    )
  }
  // flag：顶部三色条 + 细边框，图注与德文地名并排
  return (
    `<section style="${css({ border: `1px solid ${KIT.line}`, 'background-color': '#ffffff', 'box-sizing': 'border-box' })}">` +
    flagStrip(4) +
    `<section style="${css({ padding: '8px 8px 9px' })}">${img}${capRow({ 'margin-top': 8 })}</section>` +
    `</section>`
  )
}

/** 双图 / 三图 / 四图的版式：每格的宽度（%）与裁切比例，按行排列 */
export function photoRows(count: 2 | 3 | 4, layout: 'even' | 'feature', ratio: string): { w: number; fit: string; drop?: number }[][] {
  if (layout === 'feature') {
    if (count === 2) return [[{ w: 49, fit: '3:4' }, { w: 49, fit: '3:4', drop: 36 }]]
    if (count === 3) return [[{ w: 100, fit: '16:9' }], [{ w: 49, fit: '4:3' }, { w: 49, fit: '4:3' }]]
    return [[{ w: 100, fit: '16:9' }], [{ w: 32, fit: '1:1' }, { w: 32, fit: '1:1' }, { w: 32, fit: '1:1' }]]
  }
  if (count === 3) return [[{ w: 32, fit: ratio }, { w: 32, fit: ratio }, { w: 32, fit: ratio }]]
  if (count === 4) return [[{ w: 49, fit: ratio }, { w: 49, fit: ratio }], [{ w: 49, fit: ratio }, { w: 49, fit: ratio }]]
  return [[{ w: 49, fit: ratio }, { w: 49, fit: ratio }]]
}

function photos(b: Block<'photos'>, ctx: KitCtx): string {
  const { count, layout, ratio, pics } = b.props
  const items = Array.from({ length: count }, (_, i) => pics[i] ?? { caption: '' })
  if (!ctx.hints && !items.some((x) => x.image?.src)) return ''
  let slot = 0
  return photoRows(count, layout, ratio)
    .map((row, ri) => {
      const cells = row.map((c, ci) => {
        const i = slot++
        const it = items[i]
        const inner = pic(ctx, it.image, i, c.fit, c.w > 60 ? 1080 : 720) + capLine(ctx, it.caption)
        return (
          `<section style="${css({ display: 'inline-block', width: `${c.w}%`, 'vertical-align': 'top', 'box-sizing': 'border-box', 'margin-left': ci ? '2%' : undefined, 'padding-top': c.drop, 'font-size': KIT.captionSize, 'line-height': 1.6 })}">` +
          (inner || '&nbsp;') +
          `</section>`
        )
      })
      return `<section style="${css({ 'font-size': 0, 'line-height': 0, 'margin-top': ri ? 10 : undefined })}">${cells.join('')}</section>`
    })
    .join('')
}

export const KIT_RENDERERS: { [K in Exclude<KitType, 'box'>]: (b: Block<K>, ctx: KitCtx) => string } = { carousel, frame, photos }

/** 还没放图片的图片位数量（用于导出前提示） */
export function kitEmptySlots(b: Block): number {
  if (b.type === 'frame') return b.props.image?.src ? 0 : 1
  if (b.type === 'carousel') return b.props.pics.filter((x) => !x.image?.src).length
  if (b.type === 'photos') return Array.from({ length: b.props.count }, (_, i) => b.props.pics[i]).filter((x) => !x?.image?.src).length
  return 0
}
