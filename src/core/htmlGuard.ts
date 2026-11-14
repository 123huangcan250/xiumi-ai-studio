import DOMPurify from 'isomorphic-dompurify'
import type { Config, UponSanitizeElementHook } from 'dompurify'

const SVG = 'http://www.w3.org/2000/svg'
const animations = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
const numericAttributes = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-dashoffset', 'stroke-dasharray'])
const colorAttributes = new Set(['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'])
const config: Config = {
  ADD_TAGS: ['foreignObject', 'use', ...animations],
  HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
  ADD_ATTR: ['attributeName', 'attributeType', 'repeatCount', 'repeatDur', 'keyTimes', 'keySplines', 'keyPoints', 'calcMode', 'values', 'dur', 'begin', 'end', 'from', 'to', 'by', 'type', 'path', 'additive', 'accumulate', 'restart'],
  FORBID_TAGS: ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'noscript', 'template', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'canvas'],
  FORBID_ATTR: ['class'],
  SANITIZE_DOM: true,
}

function numeric(value: string): boolean {
  const parts = value.trim().split(/[;,\s]+/)
  return parts.length > 0 && parts.every(part => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:%|px|em|rem)?$/i.test(part))
}
function color(value: string, document: Document): boolean {
  // A literal CSS color only: no paint servers, CSS variables, escapes or functions other than rgb/hsl.
  if (!/^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d\s.,%+/-]+\))$/i.test(value.trim())) return false
  const probe = document.createElement('span')
  probe.style.color = value
  return probe.style.color !== ''
}
function valuesSafe(el: Element, attribute: string): boolean {
  for (const name of ['values', 'from', 'to', 'by']) {
    const value = el.getAttribute(name)
    if (value === null) continue
    if (colorAttributes.has(attribute)) {
      if (!value.split(';').every(v => color(v, el.ownerDocument))) return false
    } else if (!numeric(value)) return false
  }
  const path = el.getAttribute('path')
  return path === null || numeric(path.replace(/[MmZzLlHhVvCcSsQqTtAa]/g, ' '))
}
function uniqueIds(root: DocumentFragment): Map<string, Element> {
  const groups = new Map<string, Element[]>()
  for (const el of root.querySelectorAll('[id]')) {
    const id = el.getAttribute('id')!
    const group = groups.get(id) ?? []
    group.push(el); groups.set(id, group)
  }
  const ids = new Map<string, Element>()
  for (const [id, group] of groups) {
    if (!id || /\s/.test(id) || group.length !== 1) group.forEach(el => el.removeAttribute('id'))
    else ids.set(id, group[0])
  }
  return ids
}
const clock = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:h|min|s|ms)?$/i
function timingSafe(value: string, ids: Map<string, Element>): boolean {
  return value.split(';').every(raw => {
    const term = raw.trim()
    if (term === 'indefinite' || clock.test(term) || /^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(term)) return true
    const match = /^(.*)\.(click|begin|end)([+-].+)?$/.exec(term)
    return !!match && ids.has(match[1]) && (!match[3] || clock.test(match[3]))
  })
}
function localTarget(value: string, ids: Map<string, Element>): Element | undefined {
  return value.startsWith('#') ? ids.get(value.slice(1)) : undefined
}
const animationPolicy: UponSanitizeElementHook = (node, data) => {
  if (!animations.has(data.tagName)) return
  const el = node as Element
  const attribute = (el.getAttribute('attributeName') ?? '').toLowerCase()
  const remoteTarget = ['href', 'xlink:href'].some(name => {
    const value = el.getAttribute(name)
    return value !== null && !value.startsWith('#')
  })
  if (el.namespaceURI !== SVG || remoteTarget || (data.tagName !== 'animatemotion' && !numericAttributes.has(attribute) && !colorAttributes.has(attribute)) || !valuesSafe(el, attribute)) el.remove()
}
function pruneReferences(root: DocumentFragment, ids: Map<string, Element>): void {
  // Reverse dependencies propagate removals without repeatedly scanning the whole tree.
  const dependents = new Map<string, Set<() => void>>()
  const removed: string[] = []
  const removeNode = (el: Element) => {
    if (!root.contains(el)) return
    for (const node of [el, ...el.querySelectorAll('[id]')]) {
      const id = node.getAttribute('id')
      if (id && ids.get(id) === node) { ids.delete(id); removed.push(id) }
    }
    el.remove()
  }
  const depend = (id: string, invalid: () => void) => {
    if (!ids.has(id)) { invalid(); return }
    const callbacks = dependents.get(id) ?? new Set<() => void>()
    callbacks.add(invalid); dependents.set(id, callbacks)
  }
  for (const el of root.querySelectorAll('*')) {
    if (!root.contains(el)) continue
    const animation = animations.has(el.localName.toLowerCase())
    const remove = () => removeNode(el)
    for (const name of ['href', 'xlink:href']) {
      const value = el.getAttribute(name)
      if (value === null) continue
      if (animation || (el.namespaceURI === SVG && el.localName === 'use')) {
        if (localTarget(value, ids)?.namespaceURI !== SVG) { remove(); break }
        depend(value.slice(1), remove)
      } else if (value.startsWith('#')) depend(value.slice(1), () => el.removeAttribute(name))
    }
    if (!root.contains(el)) continue
    if (animation) {
      for (const name of ['begin', 'end']) {
        const value = el.getAttribute(name)
        if (value === null) continue
        if (!timingSafe(value, ids)) { remove(); break }
        for (const term of value.split(';')) {
          const match = /^(.*)\.(click|begin|end)([+-].+)?$/.exec(term.trim())
          if (match) depend(match[1], remove)
        }
      }
    }
    for (const name of ['fill', 'stroke', 'clip-path', 'mask', 'filter']) {
      const value = el.getAttribute(name) ?? ''
      for (const ref of value.matchAll(/url\(\s*(?:(["'])#([^"']+)\1|#([^\s)]+))\s*\)/gi)) {
        depend(ref[2] ?? ref[3], () => {
          const remaining = (el.getAttribute(name) ?? '').split(ref[0]).join('').trim()
          if (remaining) el.setAttribute(name, remaining)
          else el.removeAttribute(name)
        })
      }
      const style = (el as HTMLElement | SVGElement).style
      const styled = style?.getPropertyValue(name)
      if (styled) {
        for (const ref of styled.matchAll(/url\(\s*(?:(["'])#([^"']+)\1|#([^\s)]+))\s*\)/gi)) {
          depend(ref[2] ?? ref[3], () => {
            const remaining = style.getPropertyValue(name).split(ref[0]).join('').trim()
            if (remaining) style.setProperty(name, remaining, style.getPropertyPriority(name))
            else style.removeProperty(name)
          })
        }
      }
    }
  }
  for (let index = 0; index < removed.length; index++) {
    for (const invalid of dependents.get(removed[index]) ?? []) invalid()
  }
}

/** Parse first. Policy only removes nodes/attributes; a final purification protects the reparse boundary. */
export function guardedHtml(html: string): string {
  // The hook sees parsed values before DOMPurify removes unsafe attributes: do not silently retarget an invalid animation.
  DOMPurify.addHook('uponSanitizeElement', animationPolicy)
  try {
    const fragment = DOMPurify.sanitize(html, { ...config, RETURN_DOM_FRAGMENT: true })
    pruneReferences(fragment, uniqueIds(fragment))
    return DOMPurify.sanitize(fragment, config)
  } finally {
    DOMPurify.removeHook('uponSanitizeElement', animationPolicy)
  }
}
