import { richToMarkdown } from './richtext'
import type { Doc } from './types'

export function docToMarkdown(doc: Doc): string {
  const out: string[] = []
  const img = (src?: string, alt = '') => (src ? `![${alt}](${src})` : '')
  for (const b of doc.blocks) {
    const p: any = b.props
    switch (b.type) {
      case 'cover':
        out.push(`# ${p.title}`, p.subtitle && `> ${p.subtitle}`, p.meta, img(p.image?.src))
        break
      case 'heading':
        out.push(`## ${p.index ? p.index + ' ' : ''}${p.title}`, p.subtitle)
        break
      case 'paragraph':
        out.push(richToMarkdown(p.content))
        break
      case 'card':
        out.push(p.title && `**${p.title}**`, richToMarkdown(p.content))
        break
      case 'quote':
        out.push(`> ${p.text}${p.source ? `\n>\n> —— ${p.source}` : ''}`)
        break
      case 'imageText':
        out.push(img(p.image?.src), p.title && `**${p.title}**`, richToMarkdown(p.content))
        break
      case 'image':
        out.push(img(p.image?.src, p.caption), p.caption && `*${p.caption}*`)
        break
      case 'gallery':
        out.push(p.images.map((i: any) => img(i.src)).join('\n'), p.caption && `*${p.caption}*`)
        break
      case 'timeline':
        out.push(p.items.map((i: any) => `- **${i.time}** ${i.title}${i.desc ? `：${i.desc}` : ''}`).join('\n'))
        break
      case 'table':
        out.push(
          [`| ${p.headers.join(' | ')} |`, `| ${p.headers.map(() => '---').join(' | ')} |`, ...p.rows.map((r: string[]) => `| ${r.join(' | ')} |`)].join('\n'),
        )
        break
      case 'profile':
        out.push(img(p.image?.src, p.name), `**${p.name}** · ${p.role}`, p.bio)
        break
      case 'divider':
        out.push('---')
        break
      case 'html': {
        const imgs = [...String(p.html).matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => img(m[1].replace(/&amp;/g, '&')))
        const txt = String(p.html)
          .replace(/<\/(p|section|h\d|li|blockquote)>/gi, '\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/\n\s*\n+/g, '\n\n')
          .trim()
        out.push(txt, ...imgs)
        break
      }
      case 'ending':
        out.push('---', p.text && `**${p.text}**`, p.note, p.author)
        break
    }
  }
  return out.filter(Boolean).join('\n\n') + '\n'
}
