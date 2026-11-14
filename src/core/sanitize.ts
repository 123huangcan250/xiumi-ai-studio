import { guardedHtml } from './htmlGuard'

// 原文 HTML 清洗：用于导入公众号推文和“原文片段”模块的就地编辑。
// 白名单保留标签与内联样式，移除脚本、事件、class/id、隐藏元素与外部资源；
// 图片统一为 https 的微信图片地址（data-src 懒加载 → src）。

const TAGS = new Set([
  'section', 'p', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'br', 'img', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'colgroup', 'col', 'figure', 'figcaption', 'pre', 'code', 'sup', 'sub', 'hr', 'font',
])
const SVG_TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'image', 'foreignobject',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'animate', 'animatetransform', 'animatemotion', 'set', 'use', 'pattern',
])
/** 整块移除（含内容） */
const DROP = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'noscript', 'template', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'canvas'])
/** 微信专有组件：替换为提示文字 */
const WX_WIDGETS: Record<string, string> = {
  'mp-common-profile': '公众号名片', 'mpvoice': '音频', 'mp-common-mpaudio': '音频', 'qqmusic': '音乐', 'mpvideosnap': '视频号',
  'mp-common-videosnap': '视频号', 'mpprofile': '公众号名片', 'mp-miniprogram': '小程序', 'mp-common-product': '商品卡片',
}
const ATTRS = new Set(['style', 'src', 'href', 'alt', 'colspan', 'rowspan', 'width', 'height', 'align', 'valign', 'color', 'size', 'face'])
const SVG_ATTR_BAD = /^on|^(href|xlink:href)$/i

const isWxImage = (u: string) => /^https?:\/\/[^/]*(qpic\.cn|qlogo\.cn)\//i.test(u)
/** 秀米图床：官方说明外站请求会被拦截，导入时要转存到本地，所以清洗阶段先保留地址 */
export const isXiumiImage = (u: string) => /^https?:\/\/([\w-]+\.)*(xiumi\.us|xiumius\.cn)\//i.test(u)
const isKnownImage = (u: string) => isWxImage(u) || isXiumiImage(u)
const isLocalMedia = (u: string) => /^\/media\/[\w.-]+(\?[\w=&:%.-]*)?$/.test(u)
const normalizeImg = (u: string) => u.replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://')

/** 按分号拆分样式声明，括号和引号内的分号不算（data URI 里有分号） */
export function splitDecls(style: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** 过滤样式声明：去掉隐藏、固定定位、脚本表达式；url() 只保留微信、秀米、本地素材和内嵌图片 */
export function cleanStyle(style: string, lazyBg?: string): string {
  const out: string[] = []
  for (const decl of splitDecls(style)) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim().toLowerCase()
    let v = decl.slice(i + 1).trim()
    if (!k || !v) continue
    if (/expression|javascript:|behavior|@import|-moz-binding/i.test(v)) continue
    if (k === 'visibility' && /hidden/i.test(v)) continue
    if (k === 'position' && /fixed|sticky/i.test(v)) continue
    if (k.startsWith('--')) continue
    if (/url\(/i.test(v)) {
      const urls = [...v.matchAll(/url\((['"]?)(.*?)\1\)/gi)].map((m) => m[2])
      if (!urls.every((u) => isKnownImage(normalizeImg(u)) || isLocalMedia(u) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)/i.test(u))) continue
      v = v.replace(/url\((['"]?)(.*?)\1\)/gi, (_m, _q, u) => `url("${isKnownImage(normalizeImg(u)) ? normalizeImg(u) : u}")`)
    }
    out.push(`${k}: ${v}`)
  }
  if (lazyBg && isKnownImage(normalizeImg(lazyBg)) && !out.some((d) => d.startsWith('background-image'))) out.push(`background-image: url("${normalizeImg(lazyBg)}")`)
  return out.join('; ')
}

function isHidden(el: Element) {
  const st = (el.getAttribute('style') ?? '').replace(/\s/g, '').toLowerCase()
  return st.includes('display:none') || (el.tagName.toLowerCase() === 'p' && st.includes('visibility:hidden') && !(el.textContent ?? '').trim())
}

/** 原地清洗 DOM 子树 */
export function sanitizeTree(root: Element) {
  const doc = root.ownerDocument
  const walk = (el: Element, inSvg: boolean) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase()
      const svg = inSvg || tag === 'svg'
      if (DROP.has(tag) || isHidden(child) || tag.startsWith('mp-style') ) {
        child.remove()
        continue
      }
      if (WX_WIDGETS[tag]) {
        const p = doc.createElement('p')
        p.setAttribute('style', 'color: #999999; font-size: 13px; text-align: center')
        p.textContent = `［原文此处为${WX_WIDGETS[tag]}，导入时已移除］`
        child.replaceWith(p)
        continue
      }
      if (svg) {
        if (!SVG_TAGS.has(tag)) {
          child.remove()
          continue
        }
        for (const a of Array.from(child.attributes)) {
          if (SVG_ATTR_BAD.test(a.name) && !(a.name.endsWith('href') && isKnownImage(normalizeImg(a.value)))) child.removeAttribute(a.name)
          else if (a.name === 'class' || a.name === 'id') child.removeAttribute(a.name)
          else if (a.name === 'style') child.setAttribute('style', cleanStyle(a.value))
        }
        // foreignObject 内部是 HTML（秀米等编辑器的 SVG 版式把标题文字放在这里），按 HTML 规则清洗
        walk(child, tag !== 'foreignobject')
        continue
      }
      let node: Element = child
      if (!TAGS.has(tag)) {
        // div 等未知容器改为 section；其余未知标签只保留内容
        if (['div', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'center'].includes(tag)) {
          const sec = doc.createElement('section')
          for (const a of Array.from(child.attributes)) sec.setAttribute(a.name, a.value)
          while (child.firstChild) sec.appendChild(child.firstChild)
          child.replaceWith(sec)
          node = sec
        } else {
          // 先清洗内容，再把内容提升到原位置
          const box = doc.createElement('section')
          while (child.firstChild) box.appendChild(child.firstChild)
          walk(box, false)
          child.replaceWith(...Array.from(box.childNodes))
          continue
        }
      }
      const lazyBg = node.getAttribute('data-lazy-bgimg') ?? undefined
      if (node.tagName.toLowerCase() === 'img') {
        const raw = node.getAttribute('data-src') || node.getAttribute('src') || ''
        const src = normalizeImg(raw)
        const ok = /^data:image\/(png|jpe?g|gif|webp)/i.test(src) || /^\/media\//.test(src) || /^https:\/\//.test(src)
        if (!ok) {
          node.remove()
          continue
        }
        node.setAttribute('src', src)
        const w = node.getAttribute('width')
        if (w && /^\d+$/.test(w) && !/width/.test(node.getAttribute('style') ?? '')) node.setAttribute('style', `${node.getAttribute('style') ?? ''};width:${w}px`)
      }
      for (const a of Array.from(node.attributes)) {
        const name = a.name.toLowerCase()
        if (!ATTRS.has(name)) node.removeAttribute(a.name)
        else if (name === 'href' && !/^https?:\/\//i.test(a.value)) node.removeAttribute(a.name)
        else if (name === 'src' && node.tagName.toLowerCase() !== 'img') node.removeAttribute(a.name)
      }
      if (node.hasAttribute('style') || lazyBg) {
        const st = cleanStyle(node.getAttribute('style') ?? '', lazyBg)
        if (st) node.setAttribute('style', st)
        else node.removeAttribute('style')
      }
      walk(node, false)
    }
  }
  walk(root, false)
  // 去掉注释节点
  const it = doc.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */)
  const comments: Node[] = []
  while (it.nextNode()) comments.push(it.currentNode)
  comments.forEach((c) => c.parentNode?.removeChild(c))
}

/** 字符串版本：parse 用浏览器 DOMParser 或 jsdom */
export function sanitizeHtml(html: string, parse: (s: string) => Document): string {
  const doc = parse(`<!doctype html><html><body><section id="__root">${html}</section></body></html>`)
  const root = doc.getElementById('__root')!
  sanitizeTree(root)
  return root.innerHTML
}

/** Final parse-based boundary for stored HTML; imported layout normalization remains separate. */
export function guardHtml(html: string): string {
  return guardedHtml(html)
}
