// 模板槽位：把原文片段（导入推文的 HTML）里的文字与图片识别为可替换的“槽位”。
// 槽位按文档顺序编号（文字 t0、t1…，图片 i0、i1…），同一段 HTML 每次识别结果相同，因此不需要另存标记。
// 表单改字换图、AI 修改导入内容、套用模板生成新推文，都只替换槽位里的文字和图片地址，结构与样式保持原样。
import { variantUrl } from './compiler'
import { splitDecls } from './sanitize'
import type { ImageRef } from './types'

export type SlotRole = 'title' | 'body' | 'caption' | 'label' | 'number'

export interface TextSlot {
  id: string
  kind: 'text'
  role: SlotRole
  text: string
  /** 建议最大字数；0 表示不限（正文） */
  max: number
  /** 位于 SVG 图形中：空间固定，超出会被裁掉 */
  tight: boolean
}
export interface ImageSlot {
  id: string
  kind: 'image'
  src: string
  /** 装饰图（图标、花边、动图贴纸、内嵌小图）：套用模板时保留原图 */
  decor: boolean
}
export type Slot = TextSlot | ImageSlot
export type Parse = (s: string) => Document
/** 字符串：新文字（"" 表示删除这一行；图片槽位写 "" 表示连同相框移除）；ImageRef：新图片；null / undefined：保持原样 */
export type SlotValues = Record<string, string | ImageRef | null | undefined>

export interface FillOptions {
  parse?: Parse
  /** 模板原图的高宽比（按原图地址）：新照片按此比例居中裁切，避免变形 */
  ratios?: Record<string, number>
  /** 正文槽位的多行文字是否复制段落元素（false 时用换行） */
  split?: boolean
  /** 表单编辑时保留空格和空行；模板填充默认归一化。 */
  preserveWhitespace?: boolean
  /** 是否把 **文字** 转为加粗 */
  bold?: boolean
  /** 保留用户输入的空格（行首、行尾、连续空格写成不换行空格）；表单改字用，其余场景仍然去掉多余空白 */
  keepSpaces?: boolean
}

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

/** 行内标签：不打断一段文字（img 单独识别为图片槽位） */
const INLINE = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'font', 'a', 'sup', 'sub', 'code', 'br', 'tspan', 'img'])
/** 结构容器：本身不作为文字槽位，向下查找 */
const STRUCT = new Set(['svg', 'g', 'foreignobject', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'figure', 'colgroup'])
const NUMBER_RE = /^(第?[0-9０-９一二三四五六七八九十]{1,3}[章节部篇期]?|0?\d{1,2}[.、]?|part\s*\d{1,2}|no\.?\s*\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]{1,4})$/i
const SENTENCE_END = /[。！？；…，,.!?;]$/

const tagOf = (n: Element) => n.localName.toLowerCase()
const INVISIBLE = /[\s\u00a0\u200b\u200c\ufeff]|\u200d/g
const hasText = (n: Node) => (n.textContent ?? '').replace(INVISIBLE, '') !== ''

/** 与识别时一致的空白归一：表单回填时用它判断文字是否被外部修改 */
export function cleanText(s: string): string {
  return s
    .replace(/[\u200b\u200c\ufeff]|\u200d/g, '')
    .replace(/[ \t\r\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function readText(el: Element, preserveWhitespace = false): string {
  let s = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) s += n.textContent ?? ''
    else if (n.nodeType === 1) {
      if (tagOf(n as Element) === 'br') s += '\n'
      else n.childNodes.forEach(walk)
    }
  }
  walk(el)
  return preserveWhitespace ? s.replace(/\u00a0/g, ' ') : cleanText(s)
}

const NBSP_MARK = '\u0001'
const BR_MARK = '\u0002'

/**
 * 文字槽位在表单里显示的内容：和 HTML 的显示效果一致（源码里的换行、缩进折叠成一个空格，行首行尾的空白不显示），
 * 但不换行空格（&nbsp;）每个都算一个空格，用户输入的空格因此不会被吞掉。
 */
function readRaw(node: Node): string {
  let s = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) s += (n.textContent ?? '').replace(/[\u200b\u200c\ufeff]|\u200d/g, '').replace(/\u00a0/g, NBSP_MARK)
    else if (n.nodeType === 1) {
      if (tagOf(n as Element) === 'br') s += BR_MARK
      else n.childNodes.forEach(walk)
    }
  }
  walk(node)
  return s
    .split(BR_MARK)
    .map((line) => line.replace(/[ \t\r\n\f\v]+/g, ' ').replace(/^ | $/g, '').replaceAll(NBSP_MARK, ' '))
    .join('\n')
}

/** 表单写回后的文字：制表符当空格；完整编辑模式还保留空行。 */
export function editableText(s: string, preserveWhitespace = false): string {
  return s
    .replace(/\r/g, '')
    .replace(/[\t\f\v]/g, ' ')
    .split('\n')
    .filter((l) => preserveWhitespace || l.trim())
    .join('\n')
}

/** 每个文字槽位保留空格的文字（键为槽位 id） */
export function slotRawTexts(html: string, parse: Parse = defaultParse): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { slot, node } of scan(rootOf(html, parse))) if (slot.kind === 'text') out[slot.id] = readRaw(node)
  return out
}

/** 行首、行尾、连续的空格写成不换行空格，页面上才会显示出来 */
const keepSpace = (line: string) => line.replace(/ {2,}/g, (m) => '\u00a0'.repeat(m.length)).replace(/^ /, '\u00a0').replace(/ $/, '\u00a0')

function textNodes(el: Node): Text[] {
  const out: Text[] = []
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      if (hasText(n)) out.push(n as Text)
    } else n.childNodes.forEach(walk)
  }
  walk(el)
  return out
}

function isContainer(el: Element) {
  if (STRUCT.has(tagOf(el))) return false
  for (const d of Array.from(el.querySelectorAll('*'))) if (!INLINE.has(tagOf(d)) && hasText(d)) return false
  return true
}

function fontSize(el: Element | null): number {
  for (let cur = el; cur; cur = cur.parentElement) {
    const m = (cur.getAttribute('style') ?? '').match(/font-size:\s*([\d.]+)px/i)
    if (m) return Number(m[1])
    const attr = cur.getAttribute('font-size')
    if (attr && /^[\d.]+(px)?$/.test(attr)) return parseFloat(attr)
  }
  return 0
}

function isBold(el: Element | null, stop: Node): boolean {
  for (let cur = el; cur; cur = cur.parentElement) {
    if (['strong', 'b'].includes(tagOf(cur)) || /font-weight:\s*(bold|[6-9]00)/i.test(cur.getAttribute('style') ?? '')) return true
    if (cur === stop) break
  }
  return false
}

const longest = (list: Text[]) => list.reduce((a, b) => ((b.textContent ?? '').trim().length > (a.textContent ?? '').trim().length ? b : a))

function textSlot(id: string, node: Node, ctx: Element): TextSlot {
  const text = node.nodeType === 3 ? cleanText(node.textContent ?? '') : readText(node as Element)
  const main = node.nodeType === 3 ? (node as Text) : longest(textNodes(node))
  const host = main.parentElement ?? ctx
  const tight = !!ctx.closest('svg')
  const size = fontSize(host)
  const len = [...text].length
  let role: SlotRole
  if (NUMBER_RE.test(text)) role = 'number'
  else if (len <= 14 && /^[\x20-\x7e·•|｜]+$/.test(text)) role = 'label'
  else if (len <= 30 && !text.includes('\n') && !SENTENCE_END.test(text) && (size >= 16 || isBold(host, node) || tight)) role = 'title'
  else if (len <= 40 && size > 0 && size <= 13) role = 'caption'
  else role = 'body'
  const max = tight
    ? Math.max(len, 2)
    : { number: Math.min(16, len + 4), label: Math.min(16, len + 4), title: Math.min(40, Math.max(6, Math.ceil(len * 1.5))), caption: Math.max(20, Math.ceil(len * 1.5)), body: 0 }[role]
  return { id, kind: 'text', role, text, max, tight }
}

function isDecorImg(img: Element) {
  const src = img.getAttribute('src') ?? ''
  // 内嵌小图、动图贴纸；公众号里的 PNG 多是花边、标题字图和图标，照片几乎都是 JPG
  if (/^data:/i.test(src) || /wx_fmt=(gif|png)|mmbiz_(gif|png)|\.gif(\?|$)/i.test(src)) return true
  // 自身或外层容器很窄：图标、小装饰（三栏照片约 33%，仍算照片位）
  for (let cur: Element | null = img, depth = 0; cur && depth < 4; cur = cur.parentElement, depth++) {
    const st = cur.getAttribute('style') ?? ''
    const px = st.match(/(?:^|;)\s*(?:max-)?width:\s*([\d.]+)px/i)?.[1]
    if (px && Number(px) > 0 && Number(px) < 120) return true
    const pct = st.match(/(?:^|;)\s*width:\s*([\d.]+)%/i)?.[1]
    if (pct && Number(pct) < 24) return true
  }
  return false
}

interface Hit {
  slot: Slot
  node: Node
}

/** 深度优先、按文档顺序识别槽位 */
function scan(root: Element): Hit[] {
  const hits: Hit[] = []
  let t = 0
  let im = 0
  const addImg = (img: Element) => hits.push({ slot: { id: `i${im++}`, kind: 'image', src: img.getAttribute('src') ?? '', decor: isDecorImg(img) }, node: img })
  const visit = (el: Element) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        // 与块级元素混排的散落文字
        if (hasText(n)) hits.push({ slot: textSlot(`t${t++}`, n, el), node: n })
        continue
      }
      if (n.nodeType !== 1) continue
      const c = n as Element
      if (tagOf(c) === 'img') addImg(c)
      else if (hasText(c) && isContainer(c)) {
        hits.push({ slot: textSlot(`t${t++}`, c, c), node: c })
        c.querySelectorAll('img').forEach(addImg)
      } else visit(c)
    }
  }
  visit(root)
  return hits
}

function rootOf(html: string, parse: Parse): Element {
  return parse(`<!doctype html><html><body><section id="__slots">${html}</section></body></html>`).getElementById('__slots')!
}

export function extractSlots(html: string, parse: Parse = defaultParse, preserveWhitespace = false): Slot[] {
  return scan(rootOf(html, parse)).map(({ slot, node }) => slot.kind === 'text' && preserveWhitespace
    ? { ...slot, text: node.nodeType === 3 ? (node.textContent ?? '').replace(/\u00a0/g, ' ') : readText(node as Element, true) }
    : slot)
}

/** 兼容已有调用方；与 setSlotAlign 共用槽位隔离和外层布局处理。 */
export function setSlotAlignment(html: string, id: string, align: Align, parse: Parse = defaultParse): string {
  return setSlotAlign(html, id, align, parse)
}

/** 原图比例：优先用测得的比例，其次用 width/height 属性 */
function ratioOf(img: Element, src: string, ratios?: Record<string, number>): number | undefined {
  const r = ratios?.[src]
  if (r) return r
  const w = Number(img.getAttribute('width'))
  const h = Number(img.getAttribute('height'))
  return w > 0 && h > 0 ? h / w : undefined
}

/**
 * 照片槽位：非装饰图，且原图不是细长条或小图标。
 * ratios 由浏览器测得：值为高宽比，0 表示原图太小（图标）。
 */
export function isPhotoSlot(s: ImageSlot, ratios?: Record<string, number>) {
  if (s.decor) return false
  const r = ratios?.[s.src]
  return r === undefined || (r >= 0.45 && r <= 2.2)
}

export const fitOf = (ratio: number) => `100:${Math.min(999, Math.max(1, Math.round(ratio * 100)))}`

function inlineNodes(line: string, doc: Document, svgText: boolean, bold: boolean): Node[] {
  if (svgText) return [doc.createTextNode(line.replace(/\*\*/g, '').replace(/\n+/g, ' '))]
  const out: Node[] = []
  line.split('\n').forEach((part, i) => {
    if (i) out.push(doc.createElement('br'))
    const segs = bold ? part.split('**') : [part]
    segs.forEach((seg, j) => {
      if (!seg) return
      if (j % 2) {
        const s = doc.createElement('strong')
        s.textContent = seg
        out.push(s)
      } else out.push(doc.createTextNode(seg))
    })
  })
  return out
}

/** 把一段文字写进容器：沿用最长那段文字所在的样式，其余文字清空，变空的行内元素移除 */
function setLine(el: Element, line: string, doc: Document, bold: boolean) {
  const texts = textNodes(el)
  if (!texts.length) return
  const hadText = Array.from(el.querySelectorAll('*')).filter((e) => INLINE.has(tagOf(e)) && tagOf(e) !== 'br' && hasText(e))
  const main = longest(texts)
  for (const t of texts) if (t !== main) t.textContent = ''
  el.querySelectorAll('br').forEach((b) => b.remove())
  main.replaceWith(...inlineNodes(line, doc, !!main.parentElement?.closest('text'), bold))
  for (const e of hadText.reverse()) if (e.isConnected && !hasText(e) && !e.querySelector('img, svg, br')) e.remove()
}

function writeText(node: Node, value: string, role: SlotRole, doc: Document, split: boolean, bold: boolean, keep = false, preserveWhitespace = false) {
  keep ||= preserveWhitespace
  const v = keep ? editableText(value, preserveWhitespace) : value.replace(/\r/g, '').trim()
  const tidy = (line: string) => (keep ? keepSpace(line) : line)
  if (node.nodeType === 3) {
    if (preserveWhitespace && !node.parentElement?.closest('svg')) {
      const span = doc.createElement('span')
      node.parentNode!.replaceChild(span, node)
      span.append(...inlineNodes(v.split('\n').map(tidy).join('\n'), doc, false, bold))
    } else node.textContent = tidy(v.replace(/\*\*/g, '').replace(/\s*\n+\s*/g, ' '))
    return
  }
  const el = node as Element
  if (!v.trim()) {
    el.remove()
    return
  }
  const lines = preserveWhitespace ? v.split('\n').map(tidy) : v.split(/\n+/).map((x) => (keep ? x : x.trim())).filter((x) => x.trim()).map(tidy)
  // 正文多段：复制段落元素，每段沿用相同样式
  if (split && lines.length > 1 && role === 'body' && tagOf(el) === 'p') {
    let prev = el
    for (const line of lines.slice(1)) {
      const c = el.cloneNode(true) as Element
      setLine(c, line, doc, bold)
      prev.after(c)
      prev = c
    }
    setLine(el, lines[0], doc, bold)
  } else setLine(el, lines.join('\n'), doc, bold)
}

/**
 * 照片的“图片框”：从照片向外，只包住这一张照片和它的装饰（相框、底纹、角标图标）的最外层容器。
 * 遇到文字、其他照片或图形文字时停止。
 */
function frameOf(img: Element, root: Element): Element {
  let el = img
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    const photos = Array.from(p.querySelectorAll('img')).filter((x) => !isDecorImg(x))
    if (hasText(p) || photos.length > 1 || p.querySelector('text, foreignObject')) break
    el = p
  }
  return el
}

/**
 * 每个照片位的图片框 HTML：照片比模板多时，把多出的照片放进同款相框。
 * 只取有装饰的框（外层容器，或照片自带边框、圆角、阴影）；光秃的照片交给相册排列。
 */
export function extractFrames(html: string, opts: { parse?: Parse; ratios?: Record<string, number> } = {}): string[] {
  const root = rootOf(html, opts.parse ?? defaultParse)
  return scan(root).flatMap(({ slot, node }) => {
    if (slot.kind !== 'image' || !isPhotoSlot(slot, opts.ratios)) return []
    const f = frameOf(node as Element, root)
    const decorated = f !== node || /border|radius|shadow|padding/i.test(f.getAttribute('style') ?? '')
    return decorated ? [f.outerHTML] : []
  })
}

const SAFE_SRC = /^(\/media\/[\w.-]+(\?[\w=&:%-]*)?|https:\/\/[^\s"'<>]+)$/

/** 按槽位替换文字和图片，返回新的 HTML（结构与样式不变） */
export function fillSlots(html: string, values: SlotValues, opts: FillOptions = {}): string {
  const { parse = defaultParse, ratios, split = true, bold = true, keepSpaces = false } = opts
  const root = rootOf(html, parse)
  const doc = root.ownerDocument
  const emptied: Element[] = []
  for (const { slot, node } of scan(root)) {
    const v = values[slot.id]
    if (v === undefined || v === null) continue
    if (slot.kind === 'image') {
      // 照片比照片位少：移除这个照片位和它的相框，不保留模板里的旧照片
      if (v === '') {
        const frame = frameOf(node as Element, root)
        if (frame.parentElement) emptied.push(frame.parentElement)
        frame.remove()
        continue
      }
      if (typeof v !== 'object' || !SAFE_SRC.test(v.src)) continue
      const img = node as Element
      const r = ratioOf(img, slot.src, ratios)
      img.setAttribute('src', r && v.src.startsWith('/media/') ? variantUrl(v.src, fitOf(r)) : v.src)
      img.removeAttribute('height')
      continue
    }
    if (typeof v === 'string') {
      // 删掉的图注、标题行：它的外框（引号装饰、色条）可能也随之变空
      if (!v.trim() && node.parentElement && slot.role !== 'body') emptied.push(node.parentElement)
      writeText(node, v, slot.role, doc, split, bold, keepSpaces, opts.preserveWhitespace)
    }
  }
  // 照片位、图注移除后，只剩编号标签（IMG 01）、图标和空框的区域一并移除：向外找到不含中文、不含照片的最外层
  for (const start of emptied) {
    let top: Element | null = null
    for (let el: Element | null = start; el && el !== root && el.isConnected; el = el.parentElement) {
      if (/[一-鿿]/.test(el.textContent ?? '') || Array.from(el.querySelectorAll('img')).some((x) => !isDecorImg(x))) break
      top = el
    }
    top?.remove()
  }
  return root.innerHTML
}

/** 大型容器里装的一项：一段段文字（沿用容器正文的段落样式），或一段现成的模块 HTML */
export type NestPiece = { lines: string[] } | { html: string }

/**
 * 把内容装进容器：先按 values 清理容器里的其他文字和照片位，再在第一个正文位的位置依次放入各项。
 * 容器没有正文位时返回 null，由调用方改为逐项排列。
 */
export function nestInto(html: string, pieces: NestPiece[], values: SlotValues, opts: FillOptions = {}): string | null {
  const { parse = defaultParse } = opts
  const body = extractSlots(html, parse).find((s) => s.kind === 'text' && s.role === 'body')
  if (!body) return null
  // 记号里带中文：清理空照片区域时不会把正文位当作空区域删掉
  const MARK = '@@嵌入内容@@'
  const root = rootOf(fillSlots(html, { ...values, [body.id]: MARK }, { ...opts, split: false }), parse)
  const doc = root.ownerDocument
  const hit = scan(root).find((h) => h.slot.kind === 'text' && h.slot.text === MARK)
  if (!hit || hit.node.nodeType !== 1) return null
  const anchor = hit.node as Element
  for (const p of pieces) {
    if ('lines' in p) {
      for (const line of p.lines) {
        const c = anchor.cloneNode(true) as Element
        setLine(c, line, doc, true)
        anchor.before(c)
      }
    } else {
      const box = doc.createElement('section')
      box.innerHTML = p.html
      anchor.before(box)
    }
  }
  anchor.remove()
  return root.innerHTML
}

/** 删除第 index 张图：照片连同相框一起删，装饰图只删图片本身 */
export function removeImage(html: string, index: number, parse: Parse = defaultParse): string {
  const root = rootOf(html, parse)
  const hit = scan(root).filter((h) => h.slot.kind === 'image')[index]
  if (!hit) return html
  const img = hit.node as Element
  ;((hit.slot as ImageSlot).decor ? img : frameOf(img, root)).remove()
  return root.innerHTML
}

const BG_URL = /background-image:\s*url\((['"]?)(.*?)\1\)/i
const bgUrlOf = (el: Element) => (el.getAttribute('style') ?? '').match(BG_URL)?.[2] ?? ''
/** 以背景图嵌入的照片（秀米的 SVG 轮播、拼图等）：JPG 或已换成本地素材，且内部没有文字；PNG/GIF 背景多为纹理花边，不算 */
function isBackgroundPhoto(el: Element) {
  return /wx_fmt=jpe?g|mmbiz_jpg|\.jpe?g(\?|$)|^\/media\//i.test(bgUrlOf(el)) && !hasText(el)
}

export interface BackgroundPhoto {
  src: string
  /** 同一张图被用了几次：轮播为了循环会重复同一张 */
  count: number
}

/** 片段里以背景图嵌入的照片，同一张图只列一次 */
export function backgroundPhotos(html: string, parse: Parse = defaultParse): BackgroundPhoto[] {
  if (!/background-image/i.test(html)) return []
  const seen = new Map<string, BackgroundPhoto>()
  for (const el of Array.from(rootOf(html, parse).querySelectorAll('[style*="background-image"]'))) {
    if (!isBackgroundPhoto(el)) continue
    const src = bgUrlOf(el)
    const hit = seen.get(src)
    if (hit) hit.count++
    else seen.set(src, { src, count: 1 })
  }
  return [...seen.values()]
}

/** 替换一张背景图（用到这张图的位置全部替换），按 SVG 的 viewBox 或传入的比例裁切，避免留白或错位 */
export function setBackgroundPhoto(html: string, src: string, ref: { src: string }, opts: { parse?: Parse; ratio?: number } = {}): string {
  if (!SAFE_SRC.test(ref.src)) return html
  const root = rootOf(html, opts.parse ?? defaultParse)
  for (const el of Array.from(root.querySelectorAll('[style*="background-image"]'))) {
    if (bgUrlOf(el) !== src || !isBackgroundPhoto(el)) continue
    const box = el.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const ratio = box?.length === 4 && box[2] > 0 ? box[3] / box[2] : opts.ratio
    const base = ref.src.split('?')[0]
    const url = ratio && base.startsWith('/media/') ? variantUrl(base, fitOf(ratio)) : ref.src
    el.setAttribute('style', (el.getAttribute('style') ?? '').replace(BG_URL, `background-image: url("${url}")`))
  }
  return root.innerHTML
}

/** 背景图照片的外框：向外扩到含文字或含普通照片的容器为止（整个轮播一起算） */
function backgroundFrameOf(el: Element, root: Element): Element {
  let top = el
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    if (hasText(p) || Array.from(p.querySelectorAll('img')).some((x) => !isDecorImg(x))) break
    top = p
  }
  return top
}

/**
 * 移除以背景图嵌入的旧照片（连同只装这些照片的外框）。这类照片无法替换，
 * 在编辑器里常显示为“未经允许不可引用”，套用模板时不应带进新推文。
 */
export function removeBackgroundPhotos(html: string, parse: Parse = defaultParse): { html: string; removed: number } {
  if (!/background-image/i.test(html)) return { html, removed: 0 }
  const root = rootOf(html, parse)
  let removed = 0
  for (const el of Array.from(root.querySelectorAll('[style*="background-image"]'))) {
    if (!el.isConnected || !isBackgroundPhoto(el)) continue
    backgroundFrameOf(el, root).remove()
    removed++
  }
  return { html: removed ? root.innerHTML : html, removed }
}

/** 结构指纹：去掉文字和图片地址后的 HTML，用于合并样式相同的模板部件 */
export function skeleton(html: string, parse: Parse = defaultParse): string {
  const root = rootOf(html, parse)
  for (const el of Array.from(root.querySelectorAll('[style*="background-image"]'))) {
    if (isBackgroundPhoto(el)) el.setAttribute('style', (el.getAttribute('style') ?? '').replace(BG_URL, 'background-image: url()'))
  }
  for (const t of textNodes(root)) t.textContent = ''
  root.querySelectorAll('img').forEach((img) => img.setAttribute('src', ''))
  return root.innerHTML
}

export type Align = 'left' | 'center' | 'right' | 'justify'
const FLEX_ALIGN: Record<Align, string> = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'flex-start' }

const styleOf = (el: Element) => el.getAttribute('style') ?? ''
const declOf = (el: Element, prop: string) => {
  for (const d of splitDecls(styleOf(el)).reverse()) {
    const i = d.indexOf(':')
    if (i > 0 && d.slice(0, i).trim().toLowerCase() === prop) return d.slice(i + 1).replace(/!important/i, '').trim().toLowerCase()
  }
  return ''
}
function setDecl(el: Element, prop: string, value: string) {
  const rest = splitDecls(styleOf(el)).filter((d) => d.slice(0, Math.max(0, d.indexOf(':'))).trim().toLowerCase() !== prop)
  el.setAttribute('style', [...rest.map((d) => d.trim()), `${prop}: ${value}`].join('; '))
}

/** 槽位本身是块时直接使用；裸文字和行内槽位另加容器，不能改到兄弟段落。 */
function alignHost(node: Node): Element | null {
  if (node.nodeType !== 1) return null
  const el = node as Element
  return INLINE.has(tagOf(el)) || declOf(el, 'display') === 'inline' ? null : el
}

/** 从文字所在的块向外，第一个明确设置的对齐；没有设置时为 null（跟随外层，页面上多半是左对齐） */
function alignOf(host: Element, root: Element): Align | null {
  for (let el: Element | null = host; el && el !== root; el = el.parentElement) {
    const a = declOf(el, 'text-align')
    if (a === 'center') return 'center'
    if (a === 'right' || a === 'end') return 'right'
    if (a === 'left' || a === 'start') return 'left'
    if (a === 'justify') return 'justify'
    const j = /flex/.test(declOf(el, 'display')) ? declOf(el, 'justify-content') : ''
    if (j === 'center') return 'center'
    if (j === 'flex-end' || j === 'end' || j === 'right') return 'right'
  }
  return null
}

/** 每个文字槽位的对齐状态：alignable 为 false 的（SVG 图形内的文字）不能调整 */
export function slotAligns(html: string, parse: Parse = defaultParse): Record<string, { alignable: boolean; align: Align | null }> {
  const root = rootOf(html, parse)
  const out: Record<string, { alignable: boolean; align: Align | null }> = {}
  for (const { slot, node } of scan(root)) {
    if (slot.kind !== 'text') continue
    const host = node.nodeType === 1 ? node as Element : node.parentElement
    out[slot.id] = { alignable: !slot.tight, align: !slot.tight && host ? alignOf(host, root) : null }
  }
  return out
}

const isRowFlex = (el: Element) => /flex/.test(declOf(el, 'display')) && !/column/.test(declOf(el, 'flex-direction'))
const fixedWidth = (el: Element) => /^\d+(\.\d+)?px$/.test(declOf(el, 'width')) || /fit-content|max-content/.test(declOf(el, 'width'))
/** 宽度由内容或固定尺寸决定的盒子：它在外层里靠左靠右，要由外层来摆 */
const shrinkBox = (el: Element) => /inline-(block|flex)/.test(declOf(el, 'display')) || fixedWidth(el)

/**
 * 设置文字槽位的对齐：写在文字所在的块上（text-align）。
 * 文字外面如果是宽度被内容撑开的盒子（行内块、固定宽度、弹性布局里的一项），只改文字所在的块看不出变化，
 * 所以沿着只装着这块文字的外层逐层向外设置：文字的 text-align、弹性容器的 justify-content，固定宽度的块级盒子用左右外边距摆放。
 */
export function setSlotAlign(html: string, id: string, align: Align, parse: Parse = defaultParse): string {
  const root = rootOf(html, parse)
  const hit = scan(root).find(({ slot }) => slot.id === id && slot.kind === 'text' && !slot.tight)
  if (!hit) return html
  let host = alignHost(hit.node)
  if (!host) {
    host = root.ownerDocument.createElement('section')
    hit.node.parentNode!.insertBefore(host, hit.node)
    host.append(hit.node)
  }
  const apply = (el: Element) => {
    setDecl(el, 'text-align', align)
    if (isRowFlex(el)) setDecl(el, 'justify-content', FLEX_ALIGN[align])
  }
  // 装饰图、空盒子和裸文字同样是兄弟内容，不应随当前槽位移动。
  const loneIn = (parent: Element, child: Element) => Array.from(parent.childNodes).every((n) => n === child || (n.nodeType !== 1 && !hasText(n)))
  apply(host)
  let child = host
  for (;;) {
    const parent = child.parentElement
    if (!parent || parent === root || parent.closest('svg') || !loneIn(parent, child)) break
    const wrapped = shrinkBox(child) || isRowFlex(parent)
    if (!wrapped && !shrinkBox(parent)) break
    // 固定宽度的块级盒子：靠外边距摆在外层里
    if (fixedWidth(child) && !/inline|flex/.test(declOf(child, 'display')) && !isRowFlex(parent)) {
      setDecl(child, 'margin-left', align === 'left' || align === 'justify' ? '0' : 'auto')
      setDecl(child, 'margin-right', align === 'right' ? '0' : 'auto')
    }
    apply(parent)
    child = parent
  }
  return root.innerHTML
}
