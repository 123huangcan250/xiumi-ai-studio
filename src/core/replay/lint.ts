// wechat-svg-lint：导出前对回放 SVG 做硬约束检查。错误会阻止复制；警告只提示。
// 这是静态检查，不等于真机验证，真机项见 docs/edit-replay/COMPAT.md。

export interface LintResult {
  errors: string[]
  warnings: string[]
}

const FORBIDDEN_TAGS = ['script', 'style', 'foreignObject', 'animateMotion', 'filter', 'mask', 'iframe', 'video', 'audio', 'canvas', 'use', 'symbol', 'a', 'switch']
const FE = /<fe[A-Z]\w*/
/** 允许的行内 style 属性（只用基础属性） */
const STYLE_OK = new Set(['display', 'width', 'max-width', 'height', 'margin', 'margin-top', 'margin-bottom', 'line-height', 'font-size', 'vertical-align', 'background-color'])
const WX_IMAGE = /^https:\/\/mmbiz\.(qpic|qlogo)\.cn\//

export interface LintOptions {
  /** 方案 A：允许 id 与 url(#id)（需真机确认） */
  idsAllowed: boolean
}

export function lintReplaySvg(svg: string, opts: LintOptions): LintResult {
  const errors = new Set<string>()
  const warnings = new Set<string>()
  for (const t of FORBIDDEN_TAGS) if (new RegExp(`<${t}[\\s/>]`, 'i').test(svg)) errors.add(`包含禁用标签 <${t}>`)
  if (FE.test(svg)) errors.add('包含滤镜元素（fe*）')
  if (/\sclass\s*=/i.test(svg)) errors.add('包含 class 属性')
  if (/\son[a-z]+\s*=/i.test(svg)) errors.add('包含事件属性（on*）')
  if (/@keyframes|animation\s*:|transition\s*:/i.test(svg)) errors.add('包含 CSS 动画')
  for (const m of svg.matchAll(/\sstyle="([^"]*)"/gi)) {
    for (const decl of m[1].split(';')) {
      const k = decl.split(':')[0].trim().toLowerCase()
      if (k && !STYLE_OK.has(k)) errors.add(`行内 style 使用了非基础属性 ${k}`)
    }
  }
  const ids = /\sid\s*=/i.test(svg)
  const refs = /url\(\s*#/i.test(svg) || /\s(xlink:)?href="#/i.test(svg)
  const events = [...svg.matchAll(/\sbegin="([^"]*)"/g)].some((m) => /[A-Za-z_][\w-]*\.(click|touchstart|mouseover|begin|end)/.test(m[1]))
  if (!opts.idsAllowed) {
    if (ids) errors.add('包含 id 属性（当前为自动播放方案，不应依赖 id）')
    if (refs) errors.add('包含 url(#id) 引用（当前为自动播放方案，不应依赖 id）')
    if (events) errors.add('包含跨元素触发 begin="x.click"（当前为自动播放方案）')
  } else if (ids || refs || events) {
    warnings.add('点击开始方案依赖 id：2026-11-14 实测秀米→公众号会保留 id、同一个 SVG 内的跨元素触发有效；由文章开头的按钮触发其他 SVG 尚待确认（失败时显示静态成稿）')
  }
  for (const m of svg.matchAll(/<animate(?:Transform)?\b[^>]*>/g)) {
    const mode = m[0].match(/calcMode="(\w+)"/)?.[1] ?? 'linear'
    if (!['linear', 'spline', 'discrete'].includes(mode)) errors.add(`使用了 calcMode="${mode}"`)
  }
  let local = 0
  let inline = 0
  let foreign = 0
  for (const m of svg.matchAll(/\s(?:xlink:)?href="([^"]*)"/g)) {
    const u = m[1].replace(/&amp;/g, '&')
    if (u.startsWith('#')) continue
    if (WX_IMAGE.test(u)) continue
    if (u.startsWith('data:')) inline++
    else if (/^(\/media\/|https?:\/\/(localhost|127\.0\.0\.1))/.test(u)) local++
    else foreign++
  }
  if (local) errors.add(`有 ${local} 张图片还是本机地址，请用“上传到微信”导出`)
  if (foreign) errors.add(`有 ${foreign} 张图片不是公众号素材库地址（mmbiz.qpic.cn）`)
  if (inline) warnings.add(`有 ${inline} 张图片是内嵌数据，公众号后台是否转存待验证；建议配置接口后用“上传到微信”`)
  return { errors: [...errors], warnings: [...warnings] }
}

/** 估算发布后的体积：内嵌图片按上传后的微信地址长度计算 */
export function estimateBytes(svg: string): number {
  const s = svg.replace(/data:image\/[^"]+/g, 'https://mmbiz.qpic.cn/mmbiz_png/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/0?wx_fmt=png')
  return new TextEncoder().encode(s).length
}
