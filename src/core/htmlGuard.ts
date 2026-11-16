import DOMPurify from 'isomorphic-dompurify'
import type { Config, UponSanitizeElementHook } from 'dompurify'

const SVG = 'http://www.w3.org/2000/svg'
const animations = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
const numericAttributes = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-dashoffset', 'stroke-dasharray'])
const visibilityValues = new Set(['visible', 'hidden', 'collapse'])
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
    if (attribute === 'visibility') {
      if (name === 'by' || !(name === 'values' ? value.split(';') : [value]).every(v => visibilityValues.has(v.trim()))) return false
    } else if (colorAttributes.has(attribute)) {
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
function timingTargets(value: string, resolve: (id: string) => Element | undefined): Element[] | null {
  const targets: Element[] = []
  for (const raw of value.split(';')) {
    const term = raw.trim()
    if (term === 'indefinite' || clock.test(term) || /^\d+:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(term)) continue
    if (/^(?:click|touchstart)(?:[+-].+)?$/.test(term)) {
      const offset = term.replace(/^(?:click|touchstart)/, '')
      if (offset && !clock.test(offset)) return null
      continue
    }
    const match = /^(.*)\.(click|touchstart|begin|end)([+-].+)?$/.exec(term)
    if (!match || (match[3] && !clock.test(match[3]))) return null
    const target = resolve(match[1])
    if (!target) return null
    targets.push(target)
  }
  return targets
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
  const visible = attribute === 'visibility' && (data.tagName === 'set' || data.tagName === 'animate')
  if (el.namespaceURI !== SVG || remoteTarget || (data.tagName !== 'animatemotion' && !visible && !numericAttributes.has(attribute) && !colorAttributes.has(attribute)) || !valuesSafe(el, attribute)) el.remove()
}

interface ReferencePruning {
  articleIds: Map<string, Element> | undefined
  dependents: Map<Element, Set<() => void>>
  removed: Set<Element>
}
function pruneReferences(root: DocumentFragment, ids: Map<string, Element>, { articleIds, dependents, removed }: ReferencePruning): void {
  // Only SVG animation references may leave their fragment, and only within the purified article.
  const animationTarget = (id: string) => {
    if (!articleIds) return ids.get(id)
    const target = articleIds.get(id)
    return target && (ids.get(id) === target || target.namespaceURI === SVG) && !removed.has(target) ? target : undefined
  }
  const removeNode = (el: Element) => {
    if (!root.contains(el)) return
    for (const node of [el, ...el.querySelectorAll('[id]')]) {
      const id = node.getAttribute('id')
      if (id && ids.get(id) === node) { ids.delete(id); removed.add(node) }
    }
    el.remove()
  }
  const depend = (target: Element | undefined, invalid: () => void) => {
    if (!target || removed.has(target)) { invalid(); return }
    const callbacks = dependents.get(target) ?? new Set<() => void>()
    callbacks.add(invalid); dependents.set(target, callbacks)
  }
  for (const el of root.querySelectorAll('*')) {
    if (!root.contains(el)) continue
    const animation = animations.has(el.localName.toLowerCase())
    const remove = () => removeNode(el)
    for (const name of ['href', 'xlink:href']) {
      const value = el.getAttribute(name)
      if (value === null) continue
      if (animation || (el.namespaceURI === SVG && el.localName === 'use')) {
        const target = animation && value.startsWith('#') ? animationTarget(value.slice(1)) : localTarget(value, ids)
        if (target?.namespaceURI !== SVG) { remove(); break }
        depend(target, remove)
      } else if (value.startsWith('#')) depend(localTarget(value, ids), () => el.removeAttribute(name))
    }
    if (!root.contains(el)) continue
    if (animation) {
      for (const name of ['begin', 'end']) {
        const value = el.getAttribute(name)
        if (value === null) continue
        const targets = timingTargets(value, animationTarget)
        if (!targets) { remove(); break }
        for (const target of targets) depend(target, remove)
      }
    }
    for (const name of ['fill', 'stroke', 'clip-path', 'mask', 'filter']) {
      const value = el.getAttribute(name) ?? ''
      for (const ref of value.matchAll(/url\(\s*(?:(["'])#([^"']+)\1|#([^\s)]+))\s*\)/gi)) {
        depend(ids.get(ref[2] ?? ref[3]), () => {
          const remaining = (el.getAttribute(name) ?? '').split(ref[0]).join('').trim()
          if (remaining) el.setAttribute(name, remaining)
          else el.removeAttribute(name)
        })
      }
      const style = (el as HTMLElement | SVGElement).style
      const styled = style?.getPropertyValue(name)
      if (styled) {
        for (const ref of styled.matchAll(/url\(\s*(?:(["'])#([^"']+)\1|#([^\s)]+))\s*\)/gi)) {
          depend(ids.get(ref[2] ?? ref[3]), () => {
            const remaining = style.getPropertyValue(name).split(ref[0]).join('').trim()
            if (remaining) style.setProperty(name, remaining, style.getPropertyPriority(name))
            else style.removeProperty(name)
          })
        }
      }
    }
  }
}

/** Resolve animation references across independently purified fragments of one article. */
export function guardedHtmlFragments(html: readonly string[]): string[] {
  // The hook sees parsed values before DOMPurify removes unsafe attributes: do not silently retarget an invalid animation.
  DOMPurify.addHook('uponSanitizeElement', animationPolicy)
  try {
    const fragments = html.map(part => DOMPurify.sanitize(part, { ...config, RETURN_DOM_FRAGMENT: true }))
    const localIds = fragments.map(uniqueIds)
    const articleIds = fragments.length > 1 ? new Map<string, Element>() : undefined
    if (articleIds) {
      const seen = new Set<string>()
      for (const ids of localIds) {
        for (const [id, node] of ids) {
          if (seen.has(id)) articleIds.delete(id)
          else articleIds.set(id, node)
          seen.add(id)
        }
      }
    }
    const scope: ReferencePruning = { articleIds, dependents: new Map(), removed: new Set() }
    fragments.forEach((fragment, index) => pruneReferences(fragment, localIds[index], scope))
    // Iterating a Set also visits targets removed by a dependent callback during this pass.
    for (const target of scope.removed) {
      for (const invalid of scope.dependents.get(target) ?? []) invalid()
    }
    return fragments.map(fragment => DOMPurify.sanitize(fragment, config))
  } finally {
    DOMPurify.removeHook('uponSanitizeElement', animationPolicy)
  }
}

/** Keep standalone previews and callers scoped to their own parsed HTML. */
export function guardedHtml(html: string): string {
  return guardedHtmlFragments([html])[0]
}
