// 从大版块里取出子结构：一个导入模块常常包着很多版块（真实模板里单块近 8 万字符），
// 整块收藏算不上组件。这里提供画布点选和按结构重复度给出拆分建议所需的纯函数。
import { sanitizeHtml, splitDecls } from './sanitize'
import { backgroundPhotos, extractSlots, isPhotoSlot, skeleton, type ImageSlot, type Parse } from './slots'

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

/** 可从外层继承、抽出后会丢失的样式 */
const INHERIT = ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'word-break', 'white-space', 'word-spacing']
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

/** 取出元素的 HTML，并把它从外层继承的文字样式写到自身，单独使用时外观不变 */
export function fragmentHtml(el: Element, root: Element): string {
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
  return clone.outerHTML
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

/** SVG 轮播：同一个外层 SVG 里叠着多张背景照片（秀米的滑动相册） */
export function isCarousel(html: string, parse: Parse = defaultParse): boolean {
  if (!/<svg/i.test(html) || !/background-image/i.test(html)) return false
  const root = parse(`<!doctype html><html><body><section id="__f">${html}</section></body></html>`).getElementById('__f')!
  return Array.from(root.querySelectorAll('svg')).some((s) => !s.parentElement?.closest('svg') && Array.from(s.querySelectorAll('[style*="background-image"]')).filter((e) => /url\(/i.test(e.getAttribute('style') ?? '')).length >= 2)
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
    const raw = fragmentHtml(el, root)
    if (raw.length < MIN_CHARS || !isDecorated(el)) return
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
