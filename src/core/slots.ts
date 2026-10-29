// 模板槽位：把原文片段（导入推文的 HTML）里的文字与图片识别为可替换的“槽位”。
// 槽位按文档顺序编号（文字 t0、t1…，图片 i0、i1…），同一段 HTML 每次识别结果相同，因此不需要另存标记。
// 表单改字换图、AI 修改导入内容、套用模板生成新推文，都只替换槽位里的文字和图片地址，结构与样式保持原样。
import { variantUrl } from './compiler'
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
  /** 是否把 **文字** 转为加粗 */
  bold?: boolean
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

function readText(el: Element): string {
  let s = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) s += n.textContent ?? ''
    else if (n.nodeType === 1) {
      if (tagOf(n as Element) === 'br') s += '\n'
      else n.childNodes.forEach(walk)
    }
  }
  walk(el)
  return cleanText(s)
}

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

export function extractSlots(html: string, parse: Parse = defaultParse): Slot[] {
  return scan(rootOf(html, parse)).map((h) => h.slot)
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

function writeText(node: Node, value: string, role: SlotRole, doc: Document, split: boolean, bold: boolean) {
  const v = value.replace(/\r/g, '').trim()
  if (node.nodeType === 3) {
    node.textContent = v.replace(/\*\*/g, '').replace(/\s*\n+\s*/g, ' ')
    return
  }
  const el = node as Element
  if (!v) {
    el.remove()
    return
  }
  const lines = v.split(/\n+/).map((s) => s.trim()).filter(Boolean)
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
  const { parse = defaultParse, ratios, split = true, bold = true } = opts
  const root = rootOf(html, parse)
  const doc = root.ownerDocument
  for (const { slot, node } of scan(root)) {
    const v = values[slot.id]
    if (v === undefined || v === null) continue
    if (slot.kind === 'image') {
      // 照片比照片位少：移除这个照片位和它的相框，不保留模板里的旧照片
      if (v === '') {
        frameOf(node as Element, root).remove()
        continue
      }
      if (typeof v !== 'object' || !SAFE_SRC.test(v.src)) continue
      const img = node as Element
      const r = ratioOf(img, slot.src, ratios)
      img.setAttribute('src', r && v.src.startsWith('/media/') ? variantUrl(v.src, fitOf(r)) : v.src)
      img.removeAttribute('height')
      continue
    }
    if (typeof v === 'string') writeText(node, v, slot.role, doc, split, bold)
  }
  return root.innerHTML
}

/** 结构指纹：去掉文字和图片地址后的 HTML，用于合并样式相同的模板部件 */
export function skeleton(html: string, parse: Parse = defaultParse): string {
  const root = rootOf(html, parse)
  for (const t of textNodes(root)) t.textContent = ''
  root.querySelectorAll('img').forEach((img) => img.setAttribute('src', ''))
  return root.innerHTML
}
