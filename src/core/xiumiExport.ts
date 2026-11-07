// 导出给秀米。依据 2026-11 的实测（docs/05-xiumi-compat-probe.md T1b）：
// 秀米“导入 HTML”不接受内嵌图片（data URI）：小图换成占位图，约 1MB 的大图连位置一起消失；
// 微信图床和普通 https 外链可以显示；背景图能显示，但在秀米里不能单独选中编辑。
// 所以本地图片要么先传到微信图床，要么换成占位图、另附编号图片包，导入后手动重传。

const LOCAL_IMAGE = /(src="|url\((?:&quot;|["']?))(\/media\/[^"'&)]*(?:&amp;[^"'&)]*)*)/g

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
