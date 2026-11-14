import type { Block } from './types'

export interface BlockTextField { key: string; label: string; value: string }

/** Only authored text fields are editable here; never image/layout/HTML data. */
export function blockTextFields(block: Block): BlockTextField[] {
  const fields: BlockTextField[] = []
  const add = (key: string, label: string, value: string) => fields.push({ key, label, value })
  const simple = (keys: [string, string][]) => {
    const props = block.props as unknown as Record<string, string>
    keys.forEach(([key, label]) => add(key, label, props[key] ?? ''))
  }
  switch (block.type) {
    case 'cover': simple([['kicker', '封面标签'], ['title', '标题'], ['subtitle', '副标题'], ['meta', '时间地点']]); break
    case 'heading': simple([['index', '序号'], ['title', '标题'], ['subtitle', '副标题']]); break
    case 'quote': simple([['text', '引言'], ['source', '出处']]); break
    case 'image':
    case 'gallery': simple([['caption', '图注']]); break
    case 'frame': simple([['caption', '图注'], ['label', '标签']]); break
    case 'profile': simple([['name', '姓名'], ['role', '身份'], ['bio', '介绍']]); break
    case 'ending': simple([['text', '结尾文字'], ['author', '署名'], ['note', '引导语']]); break
    case 'box': simple([['title', '文本框标题'], ['label', '标签']]); break
    case 'carousel':
    case 'photos':
      if (block.type === 'carousel') simple([['label', '标签']])
      block.props.pics.forEach((pic, i) => add(`pics.${i}.caption`, `图注 ${i + 1}`, pic.caption))
      break
    case 'timeline':
      block.props.items.forEach((item, i) => {
        add(`items.${i}.time`, `时间 ${i + 1}`, item.time)
        add(`items.${i}.title`, `标题 ${i + 1}`, item.title)
        add(`items.${i}.desc`, `说明 ${i + 1}`, item.desc)
      })
      break
    case 'table':
      add('caption', '表格说明', block.props.caption)
      block.props.headers.forEach((value, i) => add(`headers.${i}`, `表头 ${i + 1}`, value))
      block.props.rows.forEach((row, r) => row.forEach((value, c) => add(`rows.${r}.${c}`, `第 ${r + 1} 行第 ${c + 1} 列`, value)))
  }
  return fields
}

/** Patch only a whitelisted text leaf; preserve other captions, images and layout. */
export function textFieldPatch(block: Block, key: string, value: string): Record<string, unknown> {
  if (!blockTextFields(block).some((field) => field.key === key)) return {}
  const [top, ...path] = key.split('.')
  if (!path.length) return { [top]: value }
  const copy = structuredClone((block.props as unknown as Record<string, unknown>)[top])
  let cursor = copy as any
  for (const part of path.slice(0, -1)) cursor = cursor[part]
  cursor[path.at(-1)!] = value
  return { [top]: copy }
}
