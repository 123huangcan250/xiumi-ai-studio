// 从大版块里取出子结构：一个导入模块常常包着很多版块（真实模板里单块近 8 万字符），
// 整块收藏算不上组件。这里提供画布点选和按结构重复度给出拆分建议所需的纯函数。
import { sanitizeHtml, splitDecls } from './sanitize'
import { backgroundPhotos, extractSlots, isPhotoSlot, skeleton, type ImageSlot, type Parse } from './slots'

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

/** 可从外层继承、抽出后会丢失的样式 */
export const INHERIT = ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'word-break', 'white-space', 'word-spacing']
const INLINE = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'font', 'a', 'sup', 'sub', 'code', 'br'])
/** 真正画出东西的样式（box-sizing: border-box、background-repeat 之类不算） */
const VISUAL = /background-image\s*:\s*(url|linear|radial)|background\s*:|background-color\s*:\s*(?!transparent)|box-shadow\s*:|border(-(top|right|bottom|left))?\s*:[^;]*\b(solid|dashed|dotted|double)|border-style\s*:\s*(solid|dashed|dotted|double)/i

const tagOf = (el: Element) => el.localName.toLowerCase()
const hasOwnText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
const isBlank = (el: Element) => !(el.textContent ?? '').replace(/[\s\u00a0\u200b]/g, '') && !el.querySelector('img, svg, table, hr') && !/background-image/i.test(el.getAttribute('style') ?? '') && !['img', 'svg', 'table', 'hr'].includes(tagOf(el))

/** 向外穿过只有一个子元素、没有自己文字的外壳：它们往往带内边距或底色，属于组件的一部分 */
function climbWrappers(el: Element, root: Element): Element {
  let cur = el
  for (let p = cur.parentElement; p && p !== root; p = p.parentElement) {
    if (Array.from(p.children).filter((c) => !isBlank(c)).length !== 1 || hasOwnText(p)) break
    cur = p
  }
  return cur
}

const isGrid = (el: Element) => /display:\s*(inline-)?grid/i.test(el.getAttribute('style') ?? '')

/**
 * 点中的元素对应的可收藏结构：SVG 内部按最外层 SVG 算，行内文字按所在的块算；
 * 网格拼贴（秀米的拼图标题）的碎片单独取出来没有意义，按整个网格算。
 */
export function pickElement(target: Element, root: Element): Element | null {
  let el = target
  for (let s = el.closest('svg'); s && root.contains(s); s = s.parentElement?.closest('svg') ?? null) el = s
  while (el !== root && INLINE.has(tagOf(el))) el = el.parentElement!
  if (el === root || !root.contains(el)) return null
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (isGrid(p)) el = p
  return climbWrappers(el, root)
}

/** 向外一层：取上一级结构；已经是整个模块时返回 null */
export function expandPick(el: Element, root: Element): Element | null {
  const p = el.parentElement
  if (!p || p === root || !root.contains(p)) return null
  return pickElement(p, root)
}

/**
 * 外层给内容留出的左右空白：每层的内边距、左右边框和外边距（只认 px，后写的覆盖先写的），逐层相加。
 * 片段取出来单独插入时没有这些外层，会撑满整行，比原来在大版块里宽。
 */
export function horizontalInset(ancestors: Element[]): [number, number] {
  const px = (v = '') => {
    const m = v.trim().match(/^(-?\d*\.?\d+)px$/i)
    return m ? parseFloat(m[1]) : 0
  }
  const sides = (v: string) => {
    const [t, r = t, , l = r] = v.trim().split(/\s+/)
    return [px(l), px(r)]
  }
  const borderWidth = (v: string) => (/\b(none|hidden)\b/i.test(v) ? 0 : px(v.split(/\s+/).find((t) => /^\d*\.?\d+px$/i.test(t))))
  let left = 0
  let right = 0
  for (const a of ancestors) {
    const box = { padding: [0, 0], margin: [0, 0], border: [0, 0] }
    for (const d of splitDecls(a.getAttribute('style') ?? '')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      const k = d.slice(0, i).trim().toLowerCase()
      const v = d.slice(i + 1).replace(/!important/i, '').trim()
      const m = k.match(/^(padding|margin)(?:-(left|right))?$/)
      if (m) {
        const key = m[1] as 'padding' | 'margin'
        if (!m[2]) box[key] = sides(v)
        else box[key][m[2] === 'left' ? 0 : 1] = px(v)
      } else if (k === 'border') box.border = [borderWidth(v), borderWidth(v)]
      else if (k === 'border-width') box.border = sides(v)
      else if (k === 'border-left' || k === 'border-right') box.border[k === 'border-left' ? 0 : 1] = borderWidth(v)
      else if (k === 'border-left-width' || k === 'border-right-width') box.border[k === 'border-left-width' ? 0 : 1] = px(v)
    }
    left += box.padding[0] + box.margin[0] + box.border[0]
    right += box.padding[1] + box.margin[1] + box.border[1]
  }
  return [Math.max(0, Math.round(left * 100) / 100), Math.max(0, Math.round(right * 100) / 100)]
}

/** 用一层左右内边距补上外层留出的空白，插入后宽度和原来一样 */
export function keepInset(html: string, ancestors: Element[]): string {
  const [l, r] = horizontalInset(ancestors)
  if (!l && !r) return html
  return `<section style="padding-left: ${l}px; padding-right: ${r}px; box-sizing: border-box">${html}</section>`
}

/** 取出元素的 HTML，并把它从外层继承的文字样式写到自身、外层留出的左右空白补在外面，单独使用时外观不变 */
export function fragmentHtml(el: Element, root: Element, inset = true): string {
  const own = new Set(splitDecls(el.getAttribute('style') ?? '').map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase()))
  const inherited: string[] = []
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    for (const d of splitDecls(p.getAttribute('style') ?? '')) {
      const k = d.slice(0, d.indexOf(':')).trim().toLowerCase()
      if (INHERIT.includes(k) && !own.has(k)) {
        own.add(k)
        inherited.push(d.trim())
      }
    }
  }
  const clone = el.cloneNode(true) as Element
  const style = [...inherited, (el.getAttribute('style') ?? '').trim()].filter(Boolean).join('; ')
  if (style) clone.setAttribute('style', style)
  if (!inset) return clone.outerHTML
  const ancestors: Element[] = []
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) ancestors.push(p)
  return keepInset(clone.outerHTML, ancestors)
}

const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table'
const isRowItem = (el: Element) => {
  const p = el.parentElement
  const ps = p?.getAttribute('style') ?? ''
  return (/display\s*:\s*(inline-)?flex/i.test(ps) && !/flex-direction\s*:\s*column/i.test(ps)) || /display\s*:\s*inline-(block|flex)/i.test(el.getAttribute('style') ?? '')
}

/**
 * 编辑大版块时插入组件的位置：光标所在的那一段（跳出行内文字、SVG 轮播和横排的一栏），组件放在它后面。
 * 光标不在版块的内容里时返回 null。
 */
export function insertionAnchor(node: Node | null, root: Element): Element | null {
  let el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null
  if (!el || el === root || !root.contains(el)) return null
  for (let s = el.closest('svg'); s && root.contains(s); s = s.parentElement?.closest('svg') ?? null) el = s
  const text = el.closest(TEXT_BLOCK)
  if (text && text !== root && root.contains(text)) el = text
  while (el.parentElement && el.parentElement !== root && INLINE.has(tagOf(el))) el = el.parentElement
  while (el.parentElement && el.parentElement !== root && isRowItem(el)) el = el.parentElement
  return el
}

/**
 * 把组件放到 anchor 后面。收藏时补在外面的左右空白（见 keepInset）减去插入处外层已经留出的部分，
 * 放回原来的大版块里时宽度和原来一样，不会缩两次。返回插入的元素。
 */
export function placeFragment(anchor: Element, root: Element, html: string): Element[] {
  const doc = anchor.ownerDocument
  const tpl = doc.createElement('template')
  tpl.innerHTML = html.trim()
  let nodes = Array.from(tpl.content.children)
  const hostInset = (a: Element) => {
    const ancestors: Element[] = []
    for (let p = a.parentElement; p && p !== root; p = p.parentElement) ancestors.push(p)
    return horizontalInset(ancestors)
  }
  if (nodes.length === 1 && tagOf(nodes[0]) === 'section') {
    const wrap = nodes[0]
    const decls = splitDecls(wrap.getAttribute('style') ?? '').map((d) => [d.slice(0, d.indexOf(':')).trim().toLowerCase(), d.slice(d.indexOf(':') + 1).trim()])
    const pad = Object.fromEntries(decls)
    if (decls.length && decls.every(([k]) => ['padding-left', 'padding-right', 'box-sizing'].includes(k)) && wrap.children.length) {
      const num = (v?: string) => parseFloat(v ?? '') || 0
      const want = [num(pad['padding-left']), num(pad['padding-right'])]
      // 段落外面还有比原来更多的留白（如正文外包了一层内边距），而段落是这一层的最后一段：放到这一层外面，位置不变、宽度和原来一致
      const lastHere = (a: Element) => {
        for (let n = a.nextElementSibling; n; n = n.nextElementSibling) if (!isBlank(n)) return false
        return true
      }
      for (let [hl, hr] = hostInset(anchor); (hl > want[0] || hr > want[1]) && anchor.parentElement && anchor.parentElement !== root && lastHere(anchor) && !isRowItem(anchor.parentElement); [hl, hr] = hostInset(anchor)) {
        anchor = anchor.parentElement
      }
      const [hl, hr] = hostInset(anchor)
      const l = Math.max(0, want[0] - hl)
      const r = Math.max(0, want[1] - hr)
      if (!l && !r) nodes = Array.from(wrap.children)
      else wrap.setAttribute('style', `padding-left: ${l}px; padding-right: ${r}px; box-sizing: border-box`)
    }
  }
  if (!nodes.length) return []
  let after: Element = anchor
  for (const n of nodes) {
    after.after(n)
    after = n
  }
  return nodes
}

export interface FragmentStats {
  texts: number
  photos: number
  bgPhotos: number
  chars: number
}

export function fragmentStats(html: string, parse: Parse = defaultParse): FragmentStats {
  const slots = extractSlots(html, parse)
  return {
    texts: slots.filter((s) => s.kind === 'text').length,
    photos: slots.filter((s) => s.kind === 'image' && isPhotoSlot(s as ImageSlot)).length,
    bgPhotos: backgroundPhotos(html, parse).length,
    chars: html.length,
  }
}

/** 元素里的 SVG 轮播：同一个外层 SVG 里叠着多张背景照片（秀米的滑动相册），返回最外层 SVG */
export function carouselsIn(root: Element): Element[] {
  return Array.from(root.querySelectorAll('svg')).filter((s) => !s.parentElement?.closest('svg') && Array.from(s.querySelectorAll('[style*="background-image"]')).filter((e) => /url\(/i.test(e.getAttribute('style') ?? '')).length >= 2)
}

/** SVG 轮播：同一个外层 SVG 里叠着多张背景照片（秀米的滑动相册） */
export function isCarousel(html: string, parse: Parse = defaultParse): boolean {
  if (!/<svg/i.test(html) || !/background-image/i.test(html)) return false
  return carouselsIn(parse(`<!doctype html><html><body><section id="__f">${html}</section></body></html>`).getElementById('__f')!).length > 0
}

/** 组件的默认名称：优先用第一段文字，没有文字时按内容描述 */
export function fragmentLabel(html: string, parse: Parse = defaultParse): string {
  const first = extractSlots(html, parse).find((s) => s.kind === 'text')
  const text = first?.kind === 'text' ? first.text.replace(/\s+/g, ' ').slice(0, 14) : ''
  if (text) return text
  const stats = fragmentStats(html, parse)
  if (stats.bgPhotos) return `${isCarousel(html, parse) ? '轮播' : '背景图组件'}（${stats.bgPhotos} 张）`
  return stats.photos ? `图片框（${stats.photos} 张）` : '装饰组件'
}

export interface Fragment extends FragmentStats {
  html: string
  label: string
  /** 同样结构在本模块里出现的次数 */
  repeat: number
  /** 嵌套深度，界面缩进用 */
  depth: number
}

function isDecorated(el: Element) {
  if (['img', 'svg', 'table'].includes(tagOf(el)) || el.querySelector('img, svg, table')) return true
  return [el, ...Array.from(el.querySelectorAll('[style]'))].some((e) => VISUAL.test(e.getAttribute('style') ?? ''))
}

/** 不能再往里拆的版式：网格拼贴的碎片、横向排列的几栏，单独取出来都没有意义 */
function isAtomic(el: Element) {
  if (tagOf(el) === 'svg' || isGrid(el)) return true
  const kids = Array.from(el.children).filter((c) => !isBlank(c))
  if (kids.length < 2) return false
  const st = el.getAttribute('style') ?? ''
  if (/display:\s*(inline-)?flex/i.test(st) && !/flex-(flow|direction):\s*column/i.test(st)) return true
  return kids.every((k) => /display:\s*inline-block/i.test(k.getAttribute('style') ?? '') && /width:\s*(\d|[1-8]\d)(\.\d+)?%/i.test(k.getAttribute('style') ?? ''))
}

const MIN_CHARS = 160
const MAX_RESULTS = 24

/**
 * 拆分建议：沿版块层次向下，把带装饰的子结构列出来；结构相同的只列一次并记下重复次数，
 * 不进入 SVG，也不拆开网格拼贴和横向排列的几栏。结果按文档顺序。
 */
export function splitCandidates(html: string, parse: Parse = defaultParse): Fragment[] {
  const root = parse(`<!doctype html><html><body><section id="__f">${html}</section></body></html>`).getElementById('__f')!
  const out: Fragment[] = []
  const bySkeleton = new Map<string, Fragment>()

  const add = (el: Element, depth: number) => {
    // 大小按片段本身算，不算外面补的左右空白
    if (fragmentHtml(el, root, false).length < MIN_CHARS || !isDecorated(el)) return
    const raw = fragmentHtml(el, root)
    const clean = sanitizeHtml(raw, parse)
    // 和整个模块几乎一样的不重复列出；只比外壳小一圈的（如占满版块的轮播）仍要列出来
    if (clean.length > html.length * 0.98) return
    const key = skeleton(clean, parse)
    const hit = bySkeleton.get(key)
    if (hit) {
      hit.repeat++
      return
    }
    const f: Fragment = { ...fragmentStats(clean, parse), html: clean, repeat: 1, depth, label: fragmentLabel(clean, parse) }
    bySkeleton.set(key, f)
    out.push(f)
  }

  const visit = (el: Element, depth: number) => {
    if (depth > 4 || isAtomic(el)) return
    const kids = Array.from(el.children).filter((c) => !isBlank(c))
    if (kids.length === 1 && !hasOwnText(el)) {
      visit(kids[0], depth)
      return
    }
    for (const kid of kids) {
      add(kid, depth)
      if (kid.outerHTML.length > 1200) visit(kid, depth + 1)
    }
  }
  visit(root, 0)
  return out.slice(0, MAX_RESULTS)
}

/**
 * 导入时批量加入组件库用：大模块按拆分建议取第一层版块，小模块整块收藏，纯文字跳过。
 * 返回每个组件的 HTML 和名称。
 */
export function componentPieces(html: string, label: string, parse: Parse = defaultParse): { html: string; label: string }[] {
  const pieces = html.length > 4000 ? splitCandidates(html, parse).filter((c) => c.depth === 0) : []
  if (pieces.length >= 2) return pieces.map((c) => ({ html: c.html, label: c.label }))
  const root = parse(`<!doctype html><html><body><section id="__f">${html}</section></body></html>`).getElementById('__f')!
  return Array.from(root.children).some(isDecorated) ? [{ html, label }] : []
}
