import { safeTextFont, safeTextSize } from '../core/textTypography'

const REGION = 'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,li,main,p,pre,section,td,th'
const INLINE = 'span,strong,b,em,i,u,s,strike,sub,sup,font,mark'
const PROTECTED = '[id],a,code,del,ins,abbr,cite,dfn,kbd,q,samp,time,var,svg,math,img,video,audio,canvas,iframe,object,embed,input,select,textarea,button,script,style,[contenteditable=false]'

/** Do not hand a range spanning structure or media to contentEditable commands. */
export function textRangeWithinRegion(root: HTMLElement, range: Range): boolean {
  const { startContainer, endContainer } = range
  if (range.collapsed || !root.contains(startContainer) || !root.contains(endContainer) || !range.toString().trim()) return false
  const start = startContainer.nodeType === Node.ELEMENT_NODE ? startContainer as Element : startContainer.parentElement
  const end = endContainer.nodeType === Node.ELEMENT_NODE ? endContainer as Element : endContainer.parentElement
  if (!start || !end) return false
  const protectedInside = (element: Element) => {
    const protectedElement = element.closest(PROTECTED)
    return !!protectedElement && root.contains(protectedElement)
  }
  if (protectedInside(start) || protectedInside(end)) return false
  const region = (element: Element) => element === root ? root : element.closest(REGION) ?? root
  if (region(start) !== region(end)) return false
  const unsafeAncestor = (element: Element) => {
    for (let current: Element | null = element; current && current !== root && !current.matches(REGION); current = current.parentElement) {
      if (!current.matches(INLINE)) return true
    }
    return false
  }
  if (unsafeAncestor(start) || unsafeAncestor(end)) return false
  return [...range.cloneContents().querySelectorAll('*')].every(element => element.matches(INLINE) && !element.matches(PROTECTED))
}

/** Apply the chosen property to cloned text, preserving marks and unrelated styles. */
export function styledSelectionHtml(root: HTMLElement, range: Range, property: 'fontFamily' | 'fontSize', value: string): string | null {
  const safe = property === 'fontFamily' ? safeTextFont(value) : safeTextSize(value)
  if (!safe || !textRangeWithinRegion(root, range)) return null
  const doc = root.ownerDocument
  const holder = doc.createElement('div')
  holder.append(range.cloneContents())
  // cloneContents omits a common inline ancestor. Carry its formatting into
  // the replacement so applying a family after a size does not erase the size.
  const common = range.commonAncestorContainer
  let ancestor = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement
  while (ancestor && ancestor !== root && !ancestor.matches(REGION)) {
    if (ancestor.matches(INLINE)) {
      const copy = ancestor.cloneNode(false) as Element
      copy.removeAttribute('id')
      copy.append(...holder.childNodes)
      holder.append(copy)
    }
    ancestor = ancestor.parentElement
  }
  for (const el of holder.querySelectorAll<HTMLElement>('*')) {
    el.style[property] = ''
    if (el.tagName === 'FONT') el.removeAttribute(property === 'fontSize' ? 'size' : 'face')
  }
  const walker = doc.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const text of texts) {
    if (!text.length) continue
    const span = doc.createElement('span')
    span.style[property] = safe
    text.replaceWith(span)
    span.append(text)
  }
  return holder.innerHTML
}

/** A start at a text boundary belongs to the following text, not the preceding block. */
export function restoreTextRange(root: HTMLElement, start: number, length: number): Range {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) if ((walker.currentNode as Text).length) nodes.push(walker.currentNode as Text)
  const point = (offset: number, end: boolean): [Node, number] => {
    for (const node of nodes) {
      if (offset < node.length || (end && offset === node.length)) return [node, offset]
      offset -= node.length
    }
    return [root, root.childNodes.length]
  }
  const range = doc.createRange()
  range.setStart(...point(start, false))
  range.setEnd(...point(start + length, true))
  return range
}

/** Keep spaces away from the transaction edge when the adjacent character
 * is in the same text run. At a markup boundary, preserve a single ordinary
 * space; decline runs whose visual collapse would otherwise be changed. */
export function preserveAdjacentText(range: Range, html: string): { range: Range; html: string } | null {
  const replacement = range.cloneRange()
  const before = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.textContent!.slice(0, range.startOffset).match(/[ \t]+$/)?.[0] ?? '' : ''
  const after = range.endContainer.nodeType === Node.TEXT_NODE
    ? range.endContainer.textContent!.slice(range.endOffset).match(/^[ \t]+/)?.[0] ?? '' : ''
  const doc = range.startContainer.ownerDocument!
  // Expanding an edit inside an inline wrapper may cause Chromium to replace
  // the entire wrapper and drop styling belonging to text outside the range.
  const hasPlainNeighbor = (node: Node, offset: number, leading: boolean) => {
    const parent = node.parentElement
    if (!parent || !parent.matches(REGION)) return false
    const side = doc.createRange()
    side.selectNodeContents(parent)
    if (leading) side.setEnd(node, offset)
    else side.setStart(node, offset)
    if (!side.toString().trim()) return false
    return [...side.cloneContents().querySelectorAll<HTMLElement>('*')].every(element =>
      element.matches(INLINE) && !element.matches(PROTECTED) &&
      !element.hidden && !element.style.display && !element.style.visibility)
  }
  if (before && !hasPlainNeighbor(range.startContainer, range.startOffset, true)) return null
  if (after && !hasPlainNeighbor(range.endContainer, range.endOffset, false)) return null
  const plain = (value: string) => {
    const span = doc.createElement('span')
    span.textContent = value
    return span.innerHTML
  }
  const space = '<span style="white-space:pre-wrap"> </span>'
  let prefix = '', suffix = ''
  if (before) {
    const offset = range.startOffset - before.length
    const previous = offset > 0 ? range.startContainer.textContent!.slice(0, offset).match(/[^\s]$/u)?.[0] : undefined
    if (!previous && before !== ' ') return null
    replacement.setStart(range.startContainer, offset - (previous?.length ?? 0))
    prefix = previous ? plain(previous + before) : space
  }
  if (after) {
    const offset = range.endOffset + after.length
    const next = range.endContainer.textContent!.slice(offset).match(/^[^\s]/u)?.[0]
    if (!next && after !== ' ') return null
    replacement.setEnd(range.endContainer, offset + (next?.length ?? 0))
    suffix = next ? plain(after + next) : space
  }
  return { range: replacement, html: prefix + html + suffix }
}
