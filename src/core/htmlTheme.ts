import { collectColors, harmonize, recolorHtml } from './recolor'
import type { Parse } from './slots'
import type { Theme } from './types'

const defaultParse: Parse = html => new DOMParser().parseFromString(html, 'text/html')
/** Inline background islands carry a foreground/background contrast contract.
 * Do not replace heading foregrounds there: explicit and inherited neutral colors
 * must survive. Unknown/variable backgrounds are treated conservatively as islands. */
function hasBackgroundIsland(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const color = node.style?.backgroundColor
    if (color && color !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color)) return true
    const shorthand = node.style?.getPropertyValue('background')
    if (shorthand && shorthand !== 'none' && shorthand !== 'transparent') return true
    const image = node.style?.backgroundImage
    if ((image && image !== 'none') || node.hasAttribute('bgcolor')) return true
  }
  return false
}
/** Explicit proposal only: never runs merely because the application/document theme changes.
 * Preserve the DOM, media, links and text; normalize editorial typography and chromatic accents.
 * Raster artwork and SVG geometry are retained, not falsely advertised as regenerated.
 */
export function restyleImportedHtml(html: string, theme: Theme, parse: Parse = defaultParse): string {
  const colored = recolorHtml(html, harmonize(collectColors(html, parse), theme.colors), parse)
  const root = parse(`<!doctype html><html><body>${colored}</body></html>`).body
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (el.closest('svg,pre,code') || !el.style || el.tagName === 'IMG') continue
    for (const key of ['font-family','font-size','line-height','letter-spacing']) el.style.removeProperty(key)
    const heading = /^H[1-6]$/.test(el.tagName)
    if (heading) {
      el.style.fontFamily = theme.fontHeading
      el.style.fontSize = `${el.tagName === 'H1' ? theme.h1Size : theme.h2Size}px`
      if (!hasBackgroundIsland(el)) el.style.color = theme.colors.primary
      el.style.lineHeight = '1.5'
    } else if (/^(P|LI|TD|TH|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName)) {
      el.style.fontFamily = theme.fontBody
      el.style.fontSize = `${el.tagName === 'FIGCAPTION' ? theme.smallSize : theme.fontSize}px`
      el.style.lineHeight = String(theme.lineHeight)
    }
  }
  // Inline wrapper supplies a fallback for bare text without adding a layout container.
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(PRE|CODE|IMG)$/.test(el.tagName)) continue
    if (!el.style.fontFamily) el.style.fontFamily = theme.fontBody
    if (!el.style.fontSize) el.style.fontSize = `${theme.fontSize}px`
    if (!el.style.lineHeight) el.style.lineHeight = String(theme.lineHeight)
  }
  return root.innerHTML
}
