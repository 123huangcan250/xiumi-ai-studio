// 文稿导入：.docx（mammoth，内嵌图片自动入库）/ .md / .txt → Markdown 文本 + 图片列表
import mammoth from 'mammoth'
import { saveAsset, type Asset } from './assets'

const strip = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()

/** mammoth 输出的语义 HTML → Markdown（只处理标题、段落、列表、表格、图片） */
export function htmlToMarkdown(html: string): string {
  const out: string[] = []
  const re = /<(h[1-6]|p|li|table)[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase()
    const inner = m[2]
    if (tag === 'table') {
      const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]).replace(/\|/g, '/')))
      if (rows.length) out.push([`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n'))
      continue
    }
    const imgs = [...inner.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi)].map((x) => `![](${x[1]})`)
    const text = strip(inner)
    if (tag.startsWith('h')) out.push(`${'#'.repeat(Math.min(Number(tag[1]), 2))} ${text}`)
    else if (tag === 'li') out.push(`- ${text}`)
    else if (text) out.push(text)
    out.push(...imgs)
  }
  return out.join('\n\n')
}

export async function importFile(buf: Buffer, name: string): Promise<{ text: string; assets: Asset[] }> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) {
    const assets: Asset[] = []
    const { value } = await mammoth.convertToHtml(
      { buffer: buf },
      {
        convertImage: mammoth.images.imgElement(async (image: any) => {
          const data = Buffer.from(await image.read('base64'), 'base64')
          const a = await saveAsset(data, `word-image-${assets.length + 1}.${(image.contentType ?? 'image/png').split('/')[1]}`)
          assets.push(a)
          return { src: `/media/${a.file}` }
        }),
      },
    )
    let md = htmlToMarkdown(value)
    // Word 没有一级标题时，把第一段当作标题
    if (!/^# /m.test(md)) md = md.replace(/^(?!!\[)(.+)$/m, '# $1')
    return { text: md, assets }
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
    return { text: buf.toString('utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), ''), assets: [] }
  }
  throw Object.assign(new Error('仅支持 .docx / .md / .txt'), { status: 400 })
}
