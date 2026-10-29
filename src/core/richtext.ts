import type { RichNode, RichText } from './types'

/** 纯文本（支持 **加粗**）→ tiptap JSON；空行或换行分段 */
export function textToRich(text: string): RichText {
  const paras = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    type: 'doc',
    content: (paras.length ? paras : ['']).map((p) => ({ type: 'paragraph', content: inlineMd(p) })),
  }
}

function inlineMd(s: string): RichNode[] {
  if (!s) return []
  const out: RichNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) })
    out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) })
  return out
}

export function richToPlain(rich: RichText | undefined): string {
  if (!rich) return ''
  const walk = (n: RichNode): string => {
    if (n.type === 'text') return n.text ?? ''
    if (n.type === 'hardBreak') return '\n'
    const inner = (n.content ?? []).map(walk).join('')
    return ['paragraph', 'heading', 'listItem'].includes(n.type) ? inner + '\n' : inner
  }
  return walk(rich).trim()
}

export function richToMarkdown(rich: RichText | undefined): string {
  if (!rich) return ''
  const inline = (n: RichNode): string => {
    if (n.type === 'hardBreak') return '  \n'
    if (n.type !== 'text') return (n.content ?? []).map(inline).join('')
    let t = n.text ?? ''
    for (const mk of n.marks ?? []) {
      if (mk.type === 'bold') t = `**${t}**`
      else if (mk.type === 'italic') t = `*${t}*`
      else if (mk.type === 'link') t = `[${t}](${mk.attrs?.href ?? ''})`
    }
    return t
  }
  const block = (n: RichNode): string => {
    switch (n.type) {
      case 'paragraph':
        return (n.content ?? []).map(inline).join('')
      case 'bulletList':
        return (n.content ?? []).map((li) => '- ' + (li.content ?? []).map(block).join(' ')).join('\n')
      case 'orderedList':
        return (n.content ?? []).map((li, i) => `${i + 1}. ` + (li.content ?? []).map(block).join(' ')).join('\n')
      default:
        return (n.content ?? []).map(block).join('\n\n')
    }
  }
  return (rich.content ?? []).map(block).join('\n\n')
}

export function richCharCount(rich: RichText | undefined) {
  return richToPlain(rich).replace(/\s/g, '').length
}
