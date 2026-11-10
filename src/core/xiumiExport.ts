// 导出给秀米。依据 2026-11 的实测（docs/05-xiumi-compat-probe.md T1b）：
// 秀米“导入 HTML”不接受内嵌图片（data URI）：小图换成占位图，约 1MB 的大图连位置一起消失；
// 微信图床和普通 https 外链可以显示；背景图能显示，但在秀米里不能单独选中编辑。
// 所以本地图片要么先传到微信图床，要么换成占位图、另附编号图片包，导入后手动重传。

/**
 * 把非 ASCII 字符写成 &#x…; 实体，让导出文件只剩 ASCII。
 * 不带 BOM 的 UTF-8 文件在中文 Windows 上常被当成 GBK 读（秀米上传、记事本类编辑器），中文全变乱码（· → 路）；
 * 纯 ASCII 文件按哪种编码读都一样，秀米按 HTML 解析时实体会还原成原字符（属性值和 SVG 文字里也一样）。
 * 输出经过清洗，没有 <style>/<script> 这类不解析实体的元素。
 */
export function asciiHtml(html: string): string {
  return html.replace(/[\u0080-\u{10FFFF}]/gu,(c) => `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};`)
}

const SVG = /<svg\b([^>]*?)\sstyle="([^"]*)"([^>]*)>([\s\S]*?)<\/svg>/g
const OUTER = /^(margin|flex|align-self|vertical-align|order)/

/**
 * 秀米导入 SVG 时把它的样式（尺寸、overflow:hidden、display:block）挪到自己加的外层 div 上，SVG 本身只剩 max-width，
 * 变回行内元素坐在文字基线上：外层继承 28px 左右的行高，SVG 被往下推几像素，又被外层按原尺寸裁掉（14px 小图标只剩上半截）。
 * 这里给每个 SVG 套一层行高为 0 的盒子，外边距、flex、对齐这些放在盒子上，秀米再怎么包，里面都没有行高可推。
 */
export function xiumiSvgBoxes(html: string): string {
  return html.replace(SVG, (_m, pre: string, style: string, post: string, body: string) => {
    const decls = style.split(';').map((d) => d.trim()).filter(Boolean)
    const prop = (d: string) => d.split(':')[0].trim().toLowerCase()
    const inline = decls.some((d) => prop(d) === 'display' && /inline/.test(d))
    const outer = decls.filter((d) => OUTER.test(prop(d)))
    const own = decls.filter((d) => !OUTER.test(prop(d)) && prop(d) !== 'display')
    const tag = inline ? 'span' : 'section'
    // 宽度也给盒子一份：margin:0 auto 居中、flex 里占位都靠它
    const width = decls.filter((d) => ['width', 'max-width'].includes(prop(d)))
    const box = [`display:${inline ? 'inline-block' : 'block'}`, ...width, ...outer, 'line-height:0', 'font-size:0'].join(';')
    return `<${tag} style="${box}"><svg${pre} style="${['display:block', ...own].join(';')}"${post}>${body}</svg></${tag}>`
  })
}

/**
 * 秀米“导入 HTML”只保留前 131072（128×1024）个字符，后面的直接丢掉，被截断的标签连同其后的内容都不见了。
 * 2026-11 实测：导出解码后 139254 字符，截断点正好落在第 131072 个字符（实体按还原后的一个字符算）。
 * 留出余量，每个导入文件不超过这个长度。
 */
export const XIUMI_LIMIT = 120_000

/** 秀米计数用的长度：实体按还原后的一个字符算 */
export function xiumiLength(html: string): number {
  return html.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, '.').length
}

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i
/** 标签：属性值里的 > 不算结束 */
const TAG = `<(\\/?)([a-zA-Z][\\w-]*)((?:\\s+[^\\s=>/]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?)*)\\s*(\\/?)>`

/** 拆出一个元素的开始标签、子节点（元素或文字，原样字符串）和结束标签；不是单个完整元素时返回 null */
function element(html: string): { open: string; kids: string[]; close: string } | null {
  const first = new RegExp(`^${TAG}`).exec(html)
  if (!first || first[1] || VOID.test(first[2]) || first[4]) return null
  const close = `</${first[2]}>`
  if (!html.endsWith(close)) return null
  const inner = html.slice(first[0].length, html.length - close.length)
  const kids: string[] = []
  const tag = new RegExp(TAG, 'g')
  let depth = 0
  let start = 0
  let m: RegExpExecArray | null
  const flushText = (end: number) => {
    if (end > start) kids.push(inner.slice(start, end))
  }
  while ((m = tag.exec(inner))) {
    const [all, slash, name, , self] = m
    const selfClosing = !!self || VOID.test(name)
    if (!slash) {
      if (depth === 0) {
        flushText(m.index)
        start = m.index
      }
      if (!selfClosing) depth++
      else if (depth === 0) {
        kids.push(all)
        start = m.index + all.length
      }
    } else {
      depth--
      if (depth < 0) return null
      if (depth === 0) {
        kids.push(inner.slice(start, m.index + all.length))
        start = m.index + all.length
      }
    }
  }
  if (depth !== 0) return null
  flushText(inner.length)
  return { open: first[0], kids, close }
}

/**
 * 按秀米的长度上限切成几段，每段单独导入。在模块之间切；单个模块太长时再往里一层切，
 * 每段都带上外层容器的开始和结束标签，样式不丢。实在切不开的（一张很长的 SVG）单独成段，超出上限。
 */
export function splitForXiumi(html: string, limit = XIUMI_LIMIT): string[] {
  if (xiumiLength(html) <= limit) return [html]
  const el = element(html)
  if (!el || el.kids.length < 2 && !el.kids.some((k) => element(k))) return [html]
  const shell = xiumiLength(el.open + el.close)
  const parts: string[] = []
  let cur: string[] = []
  let size = shell
  const flush = () => {
    if (cur.some((k) => k.trim())) parts.push(el.open + cur.join('') + el.close)
    cur = []
    size = shell
  }
  for (const kid of el.kids) {
    const n = xiumiLength(kid)
    if (shell + n > limit) {
      flush()
      for (const piece of splitForXiumi(kid, limit - shell)) parts.push(el.open + piece + el.close)
      continue
    }
    if (size + n > limit) flush()
    cur.push(kid)
    size += n
  }
  flush()
  return parts
}

const LOCAL_IMAGE =/(src="|url\((?:&quot;|["']?))(\/media\/[^"'&)]*(?:&amp;[^"'&)]*)*)/g

/**
 * 按在文章中出现的先后替换本地图片（img 和背景图都算）。
 * 同一张图多次出现时只回调一次、编号相同（轮播会重复用同一张）。
 */
export function replaceLocalImages(html: string, fn: (url: string, index: number) => string): { html: string; urls: string[] } {
  const seen = new Map<string, string>()
  const urls: string[] = []
  const out = html.replace(LOCAL_IMAGE, (_m, prefix: string, raw: string) => {
    const url = raw.replace(/&amp;/g, '&')
    if (!seen.has(url)) {
      urls.push(url)
      seen.set(url, fn(url, urls.length - 1))
    }
    return prefix + seen.get(url)
  })
  return { html: out, urls }
}

export interface XiumiReport {
  /** 不同的本地图片数 */
  localImages: number
  /** 用到本地图片的背景位置数：占位后在秀米里选不中，只能走微信图床 */
  localBackgrounds: number
  /** 导入内容自带的内嵌图片数：秀米不接受 */
  dataImages: number
  /** 背景图位置总数：能显示但在秀米里不能单独编辑 */
  backgrounds: number
}

export function xiumiReport(html: string): XiumiReport {
  const count = (re: RegExp) => (html.match(re) ?? []).length
  return {
    localImages: replaceLocalImages(html, () => '').urls.length,
    localBackgrounds: count(/url\((?:&quot;|["']?)\/media\//g),
    dataImages: count(/(?:src="|url\((?:&quot;|["']?))data:image\//g),
    backgrounds: count(/background-image:\s*url\(/g),
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 最小的 ZIP（只存储、不压缩，图片本身已压缩）；文件名按 UTF-8 */
export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, f.data.length, true)
    head.setUint32(22, f.data.length, true)
    head.setUint16(26, name.length, true)
    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, f.data.length, true)
    central.setUint32(24, f.data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    locals.push(new Uint8Array(head.buffer), name, f.data)
    centrals.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const size = centrals.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
