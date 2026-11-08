// 导入公众号推文：从文章页或粘贴的富文本中提取正文，
// 生成“保留原样式”的原文片段模块，或转成 Markdown 交给排版引擎重新设计。
import { createBlock } from './blocks'
import { carouselsIn, INHERIT, keepInset } from './fragments'
import { isXiumiImage, sanitizeTree, splitDecls } from './sanitize'
import type { Block, ContentSource, SourceKind } from './types'

export interface ImportedArticle {
  title: string
  account: string
  author: string
  digest: string
  cover: string
  /** 已清洗的正文根节点 */
  root: Element
  source: ContentSource
}

const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? ''
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * 判断内容来源（只是预填，用户可以在导入界面修改）：
 * 文章页算公众号；还有秀米图床的图片说明是从秀米复制的（已发布的文章图片都在微信图床）；
 * 其余看微信图床的图片和秀米留下的标记，用秀米排版后发布的文章两者都有，算公众号。
 */
export function detectSource(doc: Document, url = ''): SourceKind {
  if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(url) || doc.querySelector('#js_content')) return 'wechat'
  const imgs = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('data-src') || i.getAttribute('src') || '')
  const bg = Array.from(doc.querySelectorAll('[style*="url("]')).some((e) => /xiumi\.us|xiumius\.cn/i.test(e.getAttribute('style') ?? ''))
  if (bg || imgs.some((u) => isXiumiImage(u.replace(/^\/\//, 'https://')))) return 'xiumi'
  if (imgs.some((u) => /qpic\.cn|qlogo\.cn/i.test(u))) return 'wechat'
  return Array.from(doc.querySelectorAll('[powered-by]')).some((e) => /xiumi/i.test(e.getAttribute('powered-by') ?? '')) ? 'xiumi' : 'other'
}

/** doc 可以是完整文章页，也可以是只包含正文的片段；url 是抓取时的链接，粘贴时没有 */
export function extractArticle(doc: Document, url = ''): ImportedArticle {
  const kind = detectSource(doc, url)
  const content = doc.querySelector('#js_content') ?? doc.querySelector('.rich_media_content') ?? doc.body
  const root = content.cloneNode(true) as Element
  sanitizeTree(root)
  const scriptTitle = doc.documentElement.innerHTML.match(/var\s+msg_title\s*=\s*['"]([^'"]+)['"]/)?.[1]
  const title = meta(doc, 'meta[property="og:title"]') || text(doc.querySelector('#activity-name')) || scriptTitle || text(doc.querySelector('h1')) || ''
  const account = text(doc.querySelector('#js_name')) || meta(doc, 'meta[property="og:article:author"]')
  return {
    title,
    account,
    source: { kind, title, url, account },
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
  for (const d of splitDecls(style)) {
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
const ownText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())

/** 超过这个大小的版块即使没有轮播也往里拆 */
const SPLIT_MIN = 20_000

/**
 * 能拆开的外壳：拆开后每块各套一份外壳，所以外壳的样式不能依赖整体。
 * 固定高度、变换、网格、阴影、分开写的边框、整张背景图都会被切断，这些外壳不拆；
 * 平铺的纹理（repeat / repeat-y）拆开后只是在每块里从头再铺。
 */
function shellOk(el: Element) {
  if (!['section', 'div'].includes(el.tagName.toLowerCase())) return false
  const st = el.getAttribute('style') ?? ''
  if (/transform|display:\s*(inline-)?grid|box-shadow|border-(style|width|color|image)\s*:/i.test(st)) return false
  if (/(^|;)\s*(height|max-height)\s*:\s*\d/i.test(st)) return false
  if (/background(-image)?\s*:[^;]*url\(/i.test(st) && !/background-repeat\s*:\s*repeat(-y)?\s*(;|!|$)|background\s*:[^;]*\brepeat-y\b/i.test(st)) return false
  return true
}

/** 横向排列的几栏不能拆：横排的弹性布局，或几个并排的行内块 */
function isRow(el: Element) {
  const st = el.getAttribute('style') ?? ''
  if (/display:\s*(inline-)?flex/i.test(st) && !/flex-(flow|direction):\s*column/i.test(st)) return true
  const cols = Array.from(el.children).filter((k) => /display:\s*inline-block/i.test(k.getAttribute('style') ?? '') && !/width:\s*100%/i.test(k.getAttribute('style') ?? ''))
  return cols.length >= 2
}

/**
 * 拆开卡片得到的模块 → 卡片里的原始内容（不带卡片外壳，带上外壳传下来的文字样式）。
 * 批量加入组件库时用它：模块的外壳按位置调整过内外边距，同样的结构放在卡片不同位置会被当成不同组件；
 * 只有外壳的纯文字段落也会被当成带装饰的版块。
 */
export const cardContent = new WeakMap<Block, string>()

const propOf = (d: string) => d.slice(0, d.indexOf(':')).trim().toLowerCase()

/**
 * 给卡片里的内容补上外壳传下来的文字样式（里层外壳优先）。只有一个元素时写到它自己身上，
 * 和模块内拆分建议（fragmentHtml）的结果一致，两种方式收藏同样的结构能识别为重复；多个元素时外包一层。
 */
function withInheritedText(html: string, shells: Element[], doc: Document): string {
  const box = doc.createElement('section')
  box.innerHTML = html
  const only = box.children.length === 1 && !ownText(box) ? box.children[0] : null
  const own = new Set(splitDecls(only?.getAttribute('style') ?? '').map(propOf))
  const inherited: string[] = []
  for (let i = shells.length - 1; i >= 0; i--) {
    for (const d of splitDecls(shells[i].getAttribute('style') ?? '')) {
      const k = propOf(d)
      if (INHERIT.includes(k) && !own.has(k)) {
        own.add(k)
        inherited.push(d.trim())
      }
    }
  }
  // 和 fragmentHtml 一样：外壳留出的左右空白补在外面，插入后不会撑满整行
  if (!inherited.length) return keepInset(html, shells)
  const target = only ?? box
  target.setAttribute('style', [...inherited, (target.getAttribute('style') ?? '').trim()].filter(Boolean).join('; '))
  return keepInset(only ? only.outerHTML : box.outerHTML, shells)
}

/**
 * 秀米常把一整节（标题、正文、图片、轮播）放在同一张卡片里，卡片外面再套几层单栏外壳，
 * 顶层只有这一个节点，整节就成了一个模块，里面的轮播无法单独选中。
 * 大版块或含轮播的版块：穿过单栏外壳找到卡片，按卡片里的子节点再切分，每块套回外壳。
 * 返回 null 表示不拆。
 */
function splitSection(el: Element, maxPlainRun: number, depth: number, force = false): Block<'html'>[] | null {
  if (depth > 3) return null
  const shells: Element[] = []
  let cur = el
  for (let i = 0; i < 12; i++) {
    if (!shellOk(cur)) return null
    shells.push(cur)
    if (cur.children.length !== 1 || ownText(cur)) break
    cur = cur.children[0]
  }
  const kids = Array.from(cur.children).filter((k) => !isEmpty(k))
  if (kids.length < 2 || isRow(cur)) return null
  // 轮播要和同一张卡片里的标题、正文分开，才能单独选中和收藏
  if (!force && el.outerHTML.length < SPLIT_MIN && !carouselsIn(cur).length) return null
  const pieces = splitLayer(cur, maxPlainRun, depth + 1) as Block<'html'>[]
  if (pieces.length < 2) return null
  for (const b of pieces) if (!cardContent.has(b)) cardContent.set(b, withInheritedText(b.props.html, shells, cur.ownerDocument)) // 里层卡片已经记过的不覆盖
  keepCollapsedMargins(pieces, cur.ownerDocument)
  pieces.forEach((b, i) => (b.props.html = wrapPiece(b.props.html, shells, i === 0, i === pieces.length - 1)))
  return pieces
}

/** 竖直外边距，只认 px 和 0（其他单位返回 NaN），后写的声明覆盖先写的 */
function verticalMargins(el: Element): [number, number] {
  const px = (s: string) => (/^(0|-?\d*\.?\d+px)$/i.test(s) ? parseFloat(s) || 0 : NaN)
  let top = 0
  let bottom = 0
  for (const d of splitDecls(el.getAttribute('style') ?? '')) {
    const i = d.indexOf(':')
    if (i < 0) continue
    const k = d.slice(0, i).trim().toLowerCase()
    const v = d.slice(i + 1).replace(/!important/i, '').trim()
    if (k === 'margin') {
      const [t, , b] = expand(v)
      top = px(t)
      bottom = px(b)
    } else if (k === 'margin-top') top = px(v)
    else if (k === 'margin-bottom') bottom = px(v)
  }
  return [top, bottom]
}

const BLOCK_TAGS = new Set(['section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol'])
/** 新的格式化上下文：子元素的外边距不会穿过它合并 */
const OWN_CONTEXT = /display:\s*(?!block)[a-z-]+|overflow(-y)?:\s*(hidden|auto|scroll|clip)|float:\s*(left|right)|position:\s*(absolute|fixed)/i

/**
 * 元素一侧的外边距：自己的，以及穿过它合并上来的子元素外边距（自己这一侧没有内边距、边框、固定高度时）。
 * 无法确定（非 px 单位、负值）时返回 NaN。
 */
function edgeMargin(el: Element, side: 'top' | 'bottom', depth = 0): { own: number; nested: number } {
  const own = verticalMargins(el)[side === 'top' ? 0 : 1]
  if (!(own >= 0)) return { own: NaN, nested: NaN }
  const st = el.getAttribute('style') ?? ''
  const pad = new RegExp(`padding(-${side})?\\s*:\\s*([^;]+)`, 'gi')
  const padded = Array.from(st.matchAll(pad)).some((m) => {
    const v = m[1] ? m[2].trim() : (expand(m[2])[side === 'top' ? 0 : 2] ?? '')
    return !/^0(px)?$/i.test(v.trim())
  })
  const bordered = new RegExp(`border(-${side})?(-width)?\\s*:\\s*(?!0(px)?\\s*(;|$)|none)`, 'i').test(st)
  if (depth > 6 || padded || bordered || OWN_CONTEXT.test(st) || /(^|;)\s*(min-)?height\s*:\s*\d/i.test(st)) return { own, nested: 0 }
  const nodes = Array.from(el.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && (n.textContent ?? '').trim()))
  const edge = side === 'top' ? nodes[0] : nodes[nodes.length - 1]
  if (!edge || edge.nodeType !== 1 || !BLOCK_TAGS.has((edge as Element).tagName.toLowerCase())) return { own, nested: 0 }
  const inner = edgeMargin(edge as Element, side, depth + 1)
  return { own, nested: Math.max(inner.own, inner.nested) }
}

/**
 * 同一张卡片里相邻版块的上下外边距会合并（10px 和 10px 只留 10px，也会穿过没有内边距的外壳）；
 * 拆开后各自在一份卡片里，不再合并，间距会变大。调整后一块的上边距，让间距和合并时一样。
 */
function keepCollapsedMargins(pieces: Block<'html'>[], doc: Document) {
  const boxes = pieces.map((p) => {
    const box = doc.createElement('div')
    box.innerHTML = p.props.html
    return box
  })
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1].lastElementChild
    const next = boxes[i].firstElementChild
    if (!prev || !next) continue
    const b = edgeMargin(prev, 'bottom')
    const t = edgeMargin(next, 'top')
    const below = Math.max(b.own, b.nested)
    const above = Math.max(t.own, t.nested)
    if (!(below > 0) || !(above > 0)) continue
    // 合并时的间距是两者较大值；拆开后是下边距加上（自己的上边距和穿上来的子元素上边距合并后的值）。
    // 自己的上边距为负时，和子元素正边距合并的结果是两者相加。
    const want = Math.max(below, above) - below
    const own = want - t.nested <= 0 ? want - t.nested : want
    next.setAttribute('style', `${(next.getAttribute('style') ?? '').trim().replace(/;?$/, ';')} margin-top: ${own}px`)
    pieces[i].props.html = boxes[i].innerHTML
  }
}

/** 没有文字的版块按内容命名 */
function styledLabel(el: Element) {
  const t = text(el).slice(0, 12)
  if (t) return t
  const svg = carouselsIn(el)[0]
  if (svg) {
    const urls = new Set(Array.from(svg.querySelectorAll('[style*="background-image"]')).map((e) => (e.getAttribute('style') ?? '').match(/url\(([^)]*)\)/i)?.[1] ?? ''))
    urls.delete('')
    return `轮播（${urls.size} 张）`
  }
  return el.querySelector('img') ? '原文图片' : '原文版块'
}

/**
 * 保留原样式：按顶层子节点切分为“原文片段”模块。
 * 连续的普通段落合并为一块，带装饰或图片的版块单独成块；空白段落并入前一块。
 */
export function articleToHtmlBlocks(root: Element, maxPlainRun = 6, force = false): Block[] {
  const { layer, wrappers } = contentLayer(root)
  const blocks = splitLayer(layer, maxPlainRun, 0, force) as Block<'html'>[]
  if (wrappers.length) blocks.forEach((b, i) => (b.props.html = wrapPiece(b.props.html, wrappers, i === 0, i === blocks.length - 1)))
  return blocks
}

/** force：用户手动拆开时，最外层的卡片不论大小都拆（里层仍按常规条件） */
function splitLayer(layer: Element, maxPlainRun: number, depth = 0, force = false): Block[] {
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
      const parts = splitSection(el, maxPlainRun, depth, force)
      if (parts) blocks.push(...parts)
      // 用版块里的文字作名称，便于在画布和模板列表中辨认
      else blocks.push(createBlock('html', { html: el.outerHTML, label: styledLabel(el) }))
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

/**
 * 画布上手动拆开一个原文片段模块（以前导入、整节都在一个模块里的版块）：
 * 和导入时的拆分规则相同，但最外层的卡片不论大小都拆。拆不开返回 null。
 */
export function splitHtmlBlock(block: Block<'html'>, parse: (s: string) => Document): Block<'html'>[] | null {
  const root = parse(`<!doctype html><html><body><section id="__split">${block.props.html}</section></body></html>`).getElementById('__split')
  if (!root) return null
  const pieces = articleToHtmlBlocks(root, 6, true) as Block<'html'>[]
  if (pieces.length < 2) return null
  const { source } = block.props
  return pieces.map((b) => ({ ...b, props: { ...b.props, ...(source && { source }) } }))
}
