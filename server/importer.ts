import { validateDocxArchive } from './docxBudget'
// 文稿导入：.docx（mammoth，内嵌图片自动入库）/ .md / .txt → Markdown 文本 + 图片列表
import mammoth from 'mammoth'
import { saveAsset, deleteAsset, type Asset } from './assets'

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
    try { await validateDocxArchive(buf) } catch (error) {
      if ((error as { status?: number }).status === 413) throw error
      throw Object.assign(new Error('无法读取这个 Word 文件。文件可能已损坏或不是有效的 .docx，请用 Word 重新另存为 .docx 后再导入，或改用 Markdown/TXT。'), { status: 400 })
    }
    const assets: Asset[] = []
    let resourceError: unknown
    let imageCount = 0, imageOutputBytes = 0
    const imageTasks: Promise<unknown>[] = []
    const rollback = async (cause: unknown) => {
      await Promise.allSettled(imageTasks)
      const results = await Promise.allSettled(assets.map(asset => deleteAsset(asset.id)))
      const failures = results.filter(result => result.status === 'rejected').length
      if (failures) {
        if (cause instanceof Error) Object.assign(cause, { cleanupFailures: failures })
        console.warn(`Word import rollback failed for ${failures} newly created assets`)
      }
    }
    const { value } = await mammoth.convertToHtml(
      { buffer: buf },
      {
        // Keep uploaded DOCX relationships inside the archive; never read host files.
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement((image: any) => {
          const task = (async () => {
            if (resourceError) throw resourceError
            const data = Buffer.from(await image.read('base64'), 'base64')
            let a: Asset
            try {
              if (++imageCount > 256) throw Object.assign(new Error('Word document exceeds the 256-image conversion limit. Split the document and retry.'), { status: 413 })
              a = await saveAsset(data, `word-image-${assets.length + 1}.${(image.contentType ?? 'image/png').split('/')[1]}`)
              assets.push(a)
              imageOutputBytes += a.size ?? 0
              if (imageOutputBytes > 128 * 1024 * 1024) throw Object.assign(new Error('Word document exceeds the 128 MiB new-image output budget. Reduce images or split the document.'), { status: 413 })
            } catch (error) {
              if ([413, 429].includes((error as { status?: number }).status ?? 0)) resourceError ??= error
              throw error
            }
            return { src: `/media/${a.file}` }
          })()
          imageTasks.push(task)
          return task
        }),
      },
    ).catch(async (error: unknown) => {
      await rollback(error)
      const message = error instanceof Error ? error.message : ''
      if (/end of central directory|corrupted zip|invalid zip|can't find.*(?:document|file)|could not find.*(?:document|file)/i.test(message)) {
        throw Object.assign(new Error('无法读取这个 Word 文件。文件可能已损坏或不是有效的 .docx，请用 Word 重新另存为 .docx 后再导入，或改用 Markdown/TXT。'), { status: 400 })
      }
      throw error
    })
    if (resourceError) {
      await rollback(resourceError)
      throw resourceError
    }
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
