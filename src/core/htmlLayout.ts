import type { Theme } from './types'
export type HtmlLayout = 'editorial' | 'chapters'
export interface LayoutResult { html?: string; error?: string; preserved: number }
const WRAPPER = /^(DIV|SECTION|ARTICLE|MAIN)$/
const SIMPLE = /^(H[1-6]|P|IMG|FIGURE|FIGCAPTION|UL|OL|DL|BLOCKQUOTE|PRE|HR|BR)$/
const COSMETIC = /^(color|background-color|font-.+|line-height|letter-spacing|text-align|margin(-.+)?|padding(-.+)?|border(-.+)?|box-shadow|border-radius)$/
function transparent(el: HTMLElement): boolean {
  if (!WRAPPER.test(el.tagName)) return false
  // Backgrounds carry contrast for descendants (for example white text on a dark panel).
  // Keep the entire island; flattening it would preserve text bytes but hide visible content.
  const background = el.style.backgroundColor
  if (background && background !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(background)) return false
  if (Array.from(el.attributes).some(a => a.name !== 'style')) return false
  return Array.from(el.style).every(p => COSMETIC.test(p) && !/url\(/i.test(el.style.getPropertyValue(p)))
}
/** Rebuild only safe wrappers. Opaque islands are moved whole, never interpreted or discarded. */
export function restructureImportedHtml(html: string, layout: HtmlLayout, theme: Theme): LayoutResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const beforeText = doc.body.textContent
  const resources = () => Array.from(doc.body.querySelectorAll('[src],[href],[srcset],[poster]')).map(el =>
    [el.tagName,...['src','href','srcset','poster','alt'].map(a=>el.getAttribute(a))])
  const beforeResources = JSON.stringify(resources())
  const nodes: Node[] = [], opaque: string[] = []
  let safe = 0
  function visit(node: Node) {
    if (node.nodeType !== 1) { nodes.push(node); if(node.nodeType === 3 && node.textContent?.trim()) safe++; return }
    const el = node as HTMLElement
    if (transparent(el)) { Array.from(el.childNodes).forEach(visit); return }
    if (SIMPLE.test(el.tagName) && !/position\s*:|url\(|display\s*:\s*(grid|flex)/i.test(el.getAttribute('style') ?? '')) safe++
    else opaque.push(el.outerHTML)
    nodes.push(el)
  }
  Array.from(doc.body.childNodes).forEach(visit)
  if (!safe) return { error: '该片段全部属于复杂布局，无法安全拆分；保留原结构，未执行重排。', preserved: opaque.length }
  const root = doc.createElement('section')
  root.setAttribute('data-article-layout', layout)
  root.style.cssText = `margin:0;padding:16px 0;max-width:100%;box-sizing:border-box;font-family:${theme.fontBody};font-size:${theme.fontSize}px;line-height:${theme.lineHeight};color:${theme.colors.text};`
  let group: HTMLElement | undefined
  for (const node of nodes) {
    const heading = node.nodeType === 1 && /^H[1-6]$/.test((node as Element).tagName)
    if (!group || layout === 'editorial' || heading) {
      group = doc.createElement('section')
      group.setAttribute('data-layout-chapter', String(root.children.length + 1))
      group.style.cssText = layout === 'chapters'
        ? `margin:0 0 24px;padding:16px;border-left:3px solid ${theme.colors.primary};box-sizing:border-box;`
        : `margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid ${theme.colors.primary};box-sizing:border-box;`
      root.append(group)
    }
    group.append(node)
  }
  doc.body.replaceChildren(root)
  if (doc.body.textContent !== beforeText || JSON.stringify(resources()) !== beforeResources || opaque.some(atom=>!root.innerHTML.includes(atom))) {
    return { error: '内容完整性检查失败，已保留原文，未执行重排。', preserved: opaque.length }
  }
  return { html: root.outerHTML, preserved: opaque.length }
}
