// 输出到微信：图片处理（内嵌 / 上传微信 / 原链接）+ 富文本剪贴板。
// 剪贴板写入方式参考 doocs/md（WTFPL）：ClipboardItem 优先，execCommand 兜底；首尾加零高度段落。
import { compileDoc, css, type CompileResult } from '../core/compiler'
import { fitRatio } from '../core/photos'
import { asciiHtml, makeZip, replaceLocalImages, splitForXiumi, xiumiSvgBoxes } from '../core/xiumiExport'
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

/** 占位图：秀米会把内嵌图片换成自己的占位图，这里只要保住图片的位置和比例；体积要小，大图会被秀米连位置一起删掉 */
function placeholder(n: number, ratio = 0.66): string {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = Math.round(480 * ratio)
  const g = canvas.getContext('2d')!
  g.fillStyle = '#e5e5e5'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#888888'
  g.font = '32px sans-serif'
  g.textAlign = 'center'
  g.fillText(`图 ${String(n).padStart(2, '0')}`, canvas.width / 2, canvas.height / 2)
  return canvas.toDataURL('image/jpeg', 0.5)
}

const partName = (i: number, n: number) => (n > 1 ? `导入秀米-${i + 1}.txt` : '导入秀米.txt')

const XIUMI_NOTES = (images: number, parts: number) =>
  [
    '导入秀米的步骤',
    '',
    parts > 1
      ? `1. 这篇超过秀米单次导入的长度上限（约 13 万字符，超出部分会被直接丢掉），已分成 ${parts} 个文件。\n` +
        `   在秀米的“导入 HTML 代码”里按 1 到 ${parts} 的顺序依次导入「导入秀米-1.txt」…「导入秀米-${parts}.txt」，\n` +
        '   确认后面几段接在第一段末尾；如果秀米把某段放成了单独的图文，把它整段复制到上一段的末尾。'
      : '1. 打开秀米的“导入 HTML 代码”，上传或粘贴「导入秀米.txt」。',
    ...(images
      ? [
          '2. 秀米会提示部分图片已用占位图替代，这是正常的，秀米不接受内嵌图片。',
          `3. 在秀米里从上到下逐个替换占位图，依次使用「图片」文件夹里的 01 到 ${String(images).padStart(2, '0')}。`,
          '   同一张图可能在文章里出现多次。',
          '',
          '以背景图方式使用的本地图片，在秀米里选不中，无法这样替换。',
          '这种情况请配置微信接口，改用“上传图片并下载”。',
        ]
      : []),
    '',
  ].join('\n')

/** 秀米导入文件：SVG 加盒子、按长度上限分段、写成纯 ASCII；一个文件直接给 txt，多个打成 zip 并附说明 */
function xiumiFiles(html: string): { name: string; data: Uint8Array }[] {
  const enc = new TextEncoder()
  const parts = splitForXiumi(xiumiSvgBoxes(html))
  return parts.map((p, i) => ({ name: partName(i, parts.length), data: enc.encode(asciiHtml(p)) }))
}

export interface XiumiDownload {
  blob: Blob
  name: string
  /** 需要手动替换的本地图片数 */
  images: number
  /** 导入文件数（超过秀米长度上限时分段） */
  parts: number
}

function xiumiZip(files: { name: string; data: Uint8Array }[], images: number): XiumiDownload {
  const parts = files.filter((f) => f.name.startsWith('导入秀米')).length
  if (files.length === 1) return { blob: new Blob([files[0].data as Uint8Array<ArrayBuffer>], { type: 'text/plain;charset=utf-8' }), name: '导入秀米.txt', images, parts }
  const notes = { name: '说明.txt', data: new TextEncoder().encode('﻿' + XIUMI_NOTES(images, parts)) }
  return { blob: new Blob([makeZip([...files.slice(0, parts), notes, ...files.slice(parts)])], { type: 'application/zip' }), name: '导入秀米.zip', images, parts }
}

/** 导出给秀米（不需要公众号接口）：本地图片换成占位图，另附按出现顺序编号的图片包 */
export async function xiumiPackage(doc: Doc, onProgress?: (msg: string) => void): Promise<XiumiDownload> {
  const replaced = replaceLocalImages(compileDoc(doc).html, (url, i) => placeholder(i + 1, fitRatio(url)))
  const { urls } = replaced
  const files = xiumiFiles(replaced.html)
  for (const [i, url] of urls.entries()) {
    onProgress?.(`打包图片 ${i + 1}/${urls.length}`)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`第 ${i + 1} 张图片读取失败，素材可能已被删除`)
    const ext = url.split('?')[0].endsWith('.png') ? 'png' : 'jpg'
    files.push({ name: `图片/${String(i + 1).padStart(2, '0')}.${ext}`, data: new Uint8Array(await r.arrayBuffer()) })
  }
  return xiumiZip(files, urls.length)
}

/** 导出给秀米（已配置公众号接口）：本地图片先传到微信图床，全部变成秀米能接受的地址 */
export async function xiumiUploaded(doc: Doc, onProgress?: (msg: string) => void): Promise<XiumiDownload> {
  const { html } = await compileForWechat(doc, 'wechat', onProgress)
  if (/(?:src="|url\((?:&quot;|["']?))\/media\//.test(html)) throw new Error('有图片没有上传成功，请重试')
  return xiumiZip(xiumiFiles(html), 0)
}
