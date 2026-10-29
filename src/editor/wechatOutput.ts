// 输出到微信：图片处理（内嵌 / 上传微信 / 原链接）+ 富文本剪贴板。
// 剪贴板写入方式参考 doocs/md（WTFPL）：ClipboardItem 优先，execCommand 兜底；首尾加零高度段落。
import { compileDoc, css, type CompileResult } from '../core/compiler'
import type { Doc } from '../core/types'
import { api } from './api'

export type ImageMode = 'embed' | 'wechat' | 'absolute'

/** 收集文档编译后用到的全部图片地址 */
export function collectImageUrls(doc: Doc): string[] {
  const urls = new Set<string>()
  compileDoc(doc, { mapImage: (u) => (urls.add(u), u) })
  return [...urls]
}

async function toDataUrl(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`图片加载失败 ${url}`)
    return r.blob()
  })
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

export async function compileForWechat(doc: Doc, mode: ImageMode, onProgress?: (msg: string) => void): Promise<CompileResult> {
  const urls = collectImageUrls(doc).filter((u) => u.startsWith('/media/'))
  const map: Record<string, string> = {}
  if (mode === 'embed') {
    let i = 0
    for (const u of urls) {
      onProgress?.(`内嵌图片 ${++i}/${urls.length}`)
      map[u] = await toDataUrl(u)
    }
  } else if (mode === 'wechat') {
    onProgress?.(`上传 ${urls.length} 张图片到微信…`)
    Object.assign(map, await api.wechatUploadImages(urls))
  } else {
    for (const u of urls) map[u] = location.origin + u
  }
  const r = compileDoc(doc, { mapImage: (u) => map[u] ?? u })
  if (mode === 'embed') r.warnings = r.warnings.filter((w) => !w.includes('20,000'))
  return r
}

const edge = () => `<p style="${css({ 'font-size': 0, 'line-height': 0, margin: 0 })}">&nbsp;</p>`

/**
 * 必须在点击事件中同步调用：ClipboardItem 接收 Promise，图片内嵌等异步工作完成后再写入，
 * 这样不会因等待过久而丢失用户激活状态。
 */
export async function copyRichText(htmlPromise: Promise<string>): Promise<'clipboard-api' | 'exec-command'> {
  const full = htmlPromise.then((h) => edge() + h + edge())
  const plain = full.then((f) => new DOMParser().parseFromString(f, 'text/html').body.textContent ?? '')
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': full.then((f) => new Blob([f], { type: 'text/html' })),
          'text/plain': plain.then((p) => new Blob([p], { type: 'text/plain' })),
        }),
      ])
      return 'clipboard-api'
    } catch {
      /* 继续使用兜底方案 */
    }
  }
  return execCopy(await full)
}

function execCopy(full: string): 'exec-command' {
  const box = document.createElement('div')
  box.innerHTML = full
  Object.assign(box.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' })
  document.body.appendChild(box)
  const sel = window.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(box)
  sel.removeAllRanges()
  sel.addRange(range)
  const ok = document.execCommand('copy')
  sel.removeAllRanges()
  box.remove()
  if (!ok) throw new Error('浏览器拒绝写入剪贴板')
  return 'exec-command'
}

/** 独立 HTML 文件（预览/存档用），模拟公众号文章页 375px 宽度 */
export function standaloneHtml(doc: Doc, body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)}</title>
<meta name="referrer" content="no-referrer">
<style>body{margin:0;background:#f3f3f3}.page{max-width:677px;margin:0 auto;background:#fff;padding:20px 16px 40px}h1{font-size:22px;line-height:1.4;margin:0 0 12px;font-weight:700;color:#222}.meta{font-size:15px;color:#576b95;margin-bottom:22px}</style></head>
<body><div class="page"><h1>${esc(doc.title)}</h1><div class="meta">${esc(doc.author || '')}</div>${body}</div></body></html>`
}

export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${type};charset=utf-8` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
