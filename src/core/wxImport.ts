// 导入公众号推文：从文章页或粘贴的富文本中提取正文，
// 生成“保留原样式”的原文片段模块，或转成 Markdown 交给排版引擎重新设计。
import { createBlock } from './blocks'
import { sanitizeTree } from './sanitize'
import type { Block } from './types'

export interface ImportedArticle {
  title: string
  account: string
  author: string
  digest: string
  cover: string
  /** 已清洗的正文根节点 */
  root: Element
}

const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? ''
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** doc 可以是完整文章页，也可以是只包含正文的片段 */
export function extractArticle(doc: Document): ImportedArticle {
  const content = doc.querySelector('#js_content') ?? doc.querySelector('.rich_media_content') ?? doc.body
  const root = content.cloneNode(true) as Element
  sanitizeTree(root)
  const scriptTitle = doc.documentElement.innerHTML.match(/var\s+msg_title\s*=\s*['"]([^'"]+)['"]/)?.[1]
  return {
    title: meta(doc, 'meta[property="og:title"]') || text(doc.querySelector('#activity-name')) || scriptTitle || text(doc.querySelector('h1')) || '',
    account: text(doc.querySelector('#js_name')) || meta(doc, 'meta[property="og:article:author"]'),
    author: meta(doc, 'meta[name="author"]'),
    digest: meta(doc, 'meta[name="description"]') || meta(doc, 'meta[property="og:description"]'),
    cover: (meta(doc, 'meta[property="og:image"]') || '').replace(/^http:\/\//, 'https://'),
    root,
  }
}

const BOXY = /background|border|box-shadow|border-radius|transform/i
/** 布局容器（网格/弹性/行内块/变换/SVG）内部依赖相对位置，必须整体保留 */
const LAYOUT = /display:\s*(grid|inline-grid|flex|inline-flex|inline-block)|transform/i

/**
 * 正文常被包在一层层只有一个子元素的 section 里（外层往往带整页背景色）：
 * 向下展开到真正的内容层，并记录途经的装饰性外壳，切分后再给每块套回外壳样式。
 */
export function contentLayer(root: Element): { layer: Element; wrappers: Element[] } {
  let cur = root
  const wrappers: Element[] = []
  for (let i = 0; i < 16; i++) {
    const kids = Array.from(cur.children)
    const ownText = Array.from(cur.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
    if (kids.length !== 1 || ownText) break
    const only = kids[0]
    const st = only.getAttribute('style') ?? ''
    if (!['section', 'p', 'span', 'div'].includes(only.tagName.toLowerCase()) || !only.children.length || LAYOUT.test(st)) break
    if (BOXY.test(st)) wrappers.push(only)
    cur = only
  }
  return { layer: cur, wrappers }
}

const expand = (v: string) => {
  const [t, r = t, b = t, l = r] = v.trim().split(/\s+/)
  return [t, r, b, l]
}

/** 外壳样式拆到多块时：上内边距/上边框/上圆角只留给第一块，下方的只留给最后一块 */
function pieceStyle(style: string, first: boolean, last: boolean): string {
  const decls = new Map<string, string>()
  for (const d of style.split(';')) {
    const i = d.indexOf(':')
    if (i > 0) decls.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim())
  }
  for (const prop of ['padding', 'margin']) {
    const v = decls.get(prop)
    if (!v) continue
    decls.delete(prop)
    const [t, r, b, l] = expand(v)
    decls.set(`${prop}-top`, t).set(`${prop}-right`, r).set(`${prop}-bottom`, b).set(`${prop}-left`, l)
  }
  const border = decls.get('border')
  if (border) {
    decls.delete('border')
    decls.set('border-left', border).set('border-right', border).set('border-top', border).set('border-bottom', border)
  }
  const radius = decls.get('border-radius')
  if (radius) {
    const r = radius.split(/\s+/)[0]
    decls.set('border-radius', `${first ? r : 0} ${first ? r : 0} ${last ? r : 0} ${last ? r : 0}`)
  }
  if (!first) for (const k of ['padding-top', 'margin-top']) if (decls.has(k)) decls.set(k, '0')
  if (!last) for (const k of ['padding-bottom', 'margin-bottom']) if (decls.has(k)) decls.set(k, '0')
  if (!first && decls.has('border-top')) decls.set('border-top', 'none')
  if (!last && decls.has('border-bottom')) decls.set('border-bottom', 'none')
  return [...decls].map(([k, v]) => `${k}: ${v}`).join('; ')
}

function wrapPiece(html: string, wrappers: Element[], first: boolean, last: boolean): string {
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const shell = wrappers[i].cloneNode(false) as Element
    shell.setAttribute('style', pieceStyle(shell.getAttribute('style') ?? '', first, last))
    shell.innerHTML = html
    html = shell.outerHTML
  }
  return html
}
/** 是否为“带装饰的版块”：独立成块，便于收藏为模板 */
function isStyled(el: Element) {
  if (BOXY.test(el.getAttribute('style') ?? '')) return true
  return !!el.querySelector('img, svg, table, [style*="background"], [style*="border"]')
}
const isEmpty = (el: Element) => !text(el) && !el.querySelector('img, svg, table, hr')

/**
 * 保留原样式：按顶层子节点切分为“原文片段”模块。
 * 连续的普通段落合并为一块，带装饰或图片的版块单独成块；空白段落并入前一块。
 */
export function articleToHtmlBlocks(root: Element, maxPlainRun = 6): Block[] {
  const { layer, wrappers } = contentLayer(root)
  const blocks = splitLayer(layer, maxPlainRun) as Block<'html'>[]
  if (wrappers.length) blocks.forEach((b, i) => (b.props.html = wrapPiece(b.props.html, wrappers, i === 0, i === blocks.length - 1)))
  return blocks
}

function splitLayer(layer: Element, maxPlainRun: number): Block[] {
  const blocks: Block[] = []
  let buf: string[] = []
  let plainCount = 0
  let label = ''
  const flush = () => {
    if (buf.length) blocks.push(createBlock('html', { html: buf.join(''), label: label || '原文段落' }))
    buf = []
    plainCount = 0
    label = ''
  }
  for (const node of Array.from(layer.childNodes)) {
    if (node.nodeType === 3) {
      const t = (node.textContent ?? '').trim()
      if (t) buf.push(`<p>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
      continue
    }
    if (node.nodeType !== 1) continue
    const el = node as Element
    if (isEmpty(el)) {
      // 空行保留在当前块末尾，维持原文节奏
      if (buf.length || !blocks.length) buf.push(el.outerHTML)
      else {
        const last = blocks[blocks.length - 1] as Block<'html'>
        last.props.html += el.outerHTML
      }
      continue
    }
    if (isStyled(el)) {
      flush()
      const hasImg = el.querySelector('img')
      // 用版块里的文字作名称，便于在画布和模板列表中辨认
      blocks.push(createBlock('html', { html: el.outerHTML, label: text(el).slice(0, 12) || (hasImg ? '原文图片' : '原文版块') }))
      continue
    }
    if (plainCount >= maxPlainRun) flush()
    if (!label) label = text(el).slice(0, 12)
    buf.push(el.outerHTML)
    plainCount++
  }
  flush()
  return blocks
}

/** 转为 Markdown：标题按字号/加粗/长度推断，图片保留地址，供重新设计 */
export function articleToMarkdown(a: ImportedArticle): { markdown: string; images: string[] } {
  const lines: string[] = [`# ${a.title || '未命名推文'}`]
  const images: string[] = []
  const fontSize = (el: Element) => {
    let cur: Element | null = el
    while (cur) {
      const m = (cur.getAttribute('style') ?? '').match(/font-size:\s*([\d.]+)px/)
      if (m) return Number(m[1])
      cur = cur.parentElement
    }
    return 15
  }
  const seen = new Set<Element>()
  const leaf = (el: Element) => {
    // 只处理“段落级”元素：p、标题、或没有块级子元素的 section
    if (seen.has(el)) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'img') {
      const src = el.getAttribute('src')
      if (src) {
        images.push(src)
        lines.push(`![](${src})`)
      }
      return
    }
    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => text(c).replace(/\|/g, '/')))
      if (rows.length) lines.push([`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n'))
      seen.add(el)
      return
    }
    const blockKids = Array.from(el.children).filter((c) => /^(p|section|h[1-6]|blockquote|ul|ol|table|figure|img)$/i.test(c.tagName) || c.querySelector('img'))
    if (blockKids.length && !/^h[1-6]$/.test(tag)) {
      for (const c of Array.from(el.children)) leaf(c)
      return
    }
    el.querySelectorAll('img').forEach((img) => leaf(img))
    const t = text(el)
    if (!t) return
    const bold = !!el.querySelector('strong, b') && text(el.querySelector('strong, b')) === t
    const heading = /^h[1-4]$/.test(tag) || (t.length <= 20 && !/[，。！？；,.!?;]$/.test(t) && (bold || fontSize(el) >= 17))
    if (tag === 'blockquote') lines.push(`> ${t}`)
    else if (tag === 'li') lines.push(`- ${t}`)
    else lines.push(heading ? `## ${t}` : t)
  }
  for (const c of Array.from(contentLayer(a.root).layer.children)) leaf(c)
  // 单独一行的章节序号（“01”）并入后面的标题；与文章标题重复的标题去掉
  const merged = lines.filter((l, i) => {
    if (/^## \d{1,2}$/.test(l)) return false
    return !(i > 0 && l.startsWith('## ') && a.title.startsWith(l.slice(3)))
  })
  return { markdown: merged.join('\n\n'), images: [...new Set(images)] }
}
