// 导入内容里的图片：秀米图床的图片需要立刻转存到本地，否则外站显示不出来。
// 微信图片保持原地址（粘贴到公众号后台时可以直接使用）。
import { isXiumiImage } from './sanitize'
import type { Parse } from './slots'

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')
const URL_RE = /url\((['"]?)(.*?)\1\)/gi
const rootOf = (html: string, parse: Parse) => parse(`<!doctype html><html><body><section id="__i">${html}</section></body></html>`).getElementById('__i')!

/** 片段里需要转存的图片地址（img、SVG image、背景图） */
export function rehostUrls(html: string, parse: Parse = defaultParse): string[] {
  const root = rootOf(html, parse)
  const urls = new Set<string>()
  root.querySelectorAll('img').forEach((el) => urls.add(el.getAttribute('src') ?? ''))
  root.querySelectorAll('image').forEach((el) => urls.add(el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? ''))
  root.querySelectorAll('[style*="url("]').forEach((el) => {
    for (const m of (el.getAttribute('style') ?? '').matchAll(URL_RE)) urls.add(m[2])
  })
  return [...urls].filter(isXiumiImage)
}

/** 按映射替换图片地址；映射里没有的保持原样 */
export function rewriteImages(html: string, map: Record<string, string>, parse: Parse = defaultParse): string {
  if (!Object.keys(map).length) return html
  const root = rootOf(html, parse)
  root.querySelectorAll('img').forEach((el) => {
    const to = map[el.getAttribute('src') ?? '']
    if (to) el.setAttribute('src', to)
  })
  root.querySelectorAll('image').forEach((el) => {
    for (const a of ['href', 'xlink:href']) {
      const to = map[el.getAttribute(a) ?? '']
      if (to) el.setAttribute(a, to)
    }
  })
  root.querySelectorAll('[style*="url("]').forEach((el) => {
    const st = el.getAttribute('style') ?? ''
    el.setAttribute('style', st.replace(URL_RE, (m, _q, u) => (map[u] ? `url("${map[u]}")` : m)))
  })
  return root.innerHTML
}

// 编辑器里显示微信背景图：微信按 Referer 防盗链，带第三方 Referer 时返回 200 和占位图。
// 同一张图用 <img> 能显示，用 CSS 背景却拿到占位图（实测如此，浏览器为何不同未确认）。
// 显示时改走本地服务转发；只改显示用的 HTML，存储和导出仍是原地址。
const WX_BG = /url\((&quot;|["']?)(https:\/\/[\w.-]*(?:qpic\.cn|qlogo\.cn)\/[^"')]*?)\1\)/gi
const PROXIED_BG = /url\((&quot;|["']?)\/api\/wx-image\?u=([^"')&]*)\1\)/gi

/** 微信图片的显示地址 */
export const displayUrl = (u: string) => (/^https:\/\/[\w.-]*(qpic\.cn|qlogo\.cn)\//i.test(u) ? `/api/wx-image?u=${encodeURIComponent(u)}` : u)

export const displayHtml = (html: string) => html.replace(WX_BG, (_m, q, u) => `url(${q}${displayUrl(u.replace(/&amp;/g, '&'))}${q})`)

/** 从显示用的 DOM 取回内容时还原成原地址 */
export const storedHtml = (html: string) => html.replace(PROXIED_BG, (_m, q, u) => `url(${q}${decodeURIComponent(u).replace(/&/g, '&amp;')}${q})`)
