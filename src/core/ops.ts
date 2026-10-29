import { coerceProps, createBlock, isBlockType, newId } from './blocks'
import { richToPlain } from './richtext'
import type { Block, Doc, DocOp } from './types'

/** 校验并修复一条 op；非法时返回错误信息 */
export function validateOp(doc: Doc, op: any): { op?: DocOp; error?: string } {
  if (!op || typeof op !== 'object') return { error: 'op 不是对象' }
  switch (op.op) {
    case 'insert': {
      const type = op.block?.type
      if (!isBlockType(type) || type === 'html') return { error: `不支持插入模块类型 ${type}` }
      // AI 返回的字段类型不可信（如 index 给数字）：按模块结构强制转换
      const block = createBlock(type, coerceProps(type, op.block.props) as any)
      const index = Math.max(0, Math.min(doc.blocks.length, Number(op.index ?? doc.blocks.length)))
      return { op: { op: 'insert', index, block, reason: op.reason } }
    }
    case 'update': {
      const b = doc.blocks.find((x) => x.id === op.id)
      if (!b) return { error: `找不到模块 ${op.id}` }
      // 原文片段的 HTML 只能由用户编辑，AI 不得改写
      if (b.type === 'html') return { error: '原文片段不支持 AI 改写' }
      const props = coerceProps(b.type, op.props, true)
      if (!Object.keys(props).length) return { error: `修改 ${op.id} 没有有效字段` }
      return { op: { op: 'update', id: op.id, props, reason: op.reason } }
    }
    case 'remove':
      return doc.blocks.some((x) => x.id === op.id) ? { op } : { error: `找不到模块 ${op.id}` }
    case 'move':
      return doc.blocks.some((x) => x.id === op.id) ? { op: { ...op, to: Number(op.to) || 0 } } : { error: `找不到模块 ${op.id}` }
    case 'setTheme':
      return typeof op.themeId === 'string' ? { op } : { error: '缺少 themeId' }
    case 'setMeta':
      return { op }
    default:
      return { error: `未知操作 ${op.op}` }
  }
}

export function applyOp(doc: Doc, op: DocOp): Doc {
  const blocks = [...doc.blocks]
  switch (op.op) {
    case 'insert':
      blocks.splice(op.index, 0, { ...op.block, id: op.block.id || newId() })
      return { ...doc, blocks }
    case 'update':
      return { ...doc, blocks: blocks.map((b) => (b.id === op.id ? ({ ...b, props: { ...b.props, ...op.props } } as Block) : b)) }
    case 'remove':
      return { ...doc, blocks: blocks.filter((b) => b.id !== op.id) }
    case 'move': {
      const from = blocks.findIndex((b) => b.id === op.id)
      if (from < 0) return doc
      const [b] = blocks.splice(from, 1)
      blocks.splice(Math.max(0, Math.min(blocks.length, op.to)), 0, b)
      return { ...doc, blocks }
    }
    case 'setTheme':
      return { ...doc, themeId: op.themeId, themeOverrides: undefined }
    case 'setMeta': {
      const { title, digest, author } = op
      return { ...doc, ...(title !== undefined && { title }), ...(digest !== undefined && { digest }), ...(author !== undefined && { author }) }
    }
  }
}

export function applyOps(doc: Doc, ops: DocOp[]): Doc {
  return ops.reduce(applyOp, doc)
}

/** 人类可读的改动说明，用于差异面板 */
export function describeOp(doc: Doc, op: DocOp): { title: string; before?: string; after?: string } {
  const label = (b?: Block) => (b ? `${b.type}「${summarize(b).slice(0, 18)}」` : '')
  switch (op.op) {
    case 'insert':
      return { title: `在第 ${op.index + 1} 位插入 ${op.block.type}`, after: summarize(op.block) }
    case 'update': {
      const b = doc.blocks.find((x) => x.id === op.id)
      const after = b ? summarize({ ...b, props: { ...b.props, ...op.props } } as Block) : ''
      return { title: `修改 ${label(b)}`, before: b ? summarize(b) : '', after }
    }
    case 'remove': {
      const b = doc.blocks.find((x) => x.id === op.id)
      return { title: `删除 ${label(b)}`, before: b ? summarize(b) : '' }
    }
    case 'move': {
      const b = doc.blocks.find((x) => x.id === op.id)
      return { title: `移动 ${label(b)} 到第 ${op.to + 1} 位` }
    }
    case 'setTheme':
      return { title: `切换主题为 ${op.themeId}` }
    case 'setMeta':
      return { title: '修改文章信息', after: [op.title, op.digest, op.author].filter(Boolean).join(' / ') }
  }
}

/** 模块的纯文本摘要（AI 上下文与差异显示共用） */
export function summarize(b: Block): string {
  const p: any = b.props
  switch (b.type) {
    case 'paragraph':
      return richToPlain(p.content)
    case 'card':
    case 'imageText':
      return [p.title, richToPlain(p.content)].filter(Boolean).join('：')
    case 'gallery':
      return `${p.images.length} 张图，${p.columns} 列 ${p.caption ?? ''}`
    case 'timeline':
      return p.items.map((i: any) => `${i.time} ${i.title}`).join('；')
    case 'table':
      return [p.headers.join(' | '), ...p.rows.map((r: string[]) => r.join(' | '))].join('\n')
    case 'image':
      return `图片 ${p.caption ?? ''}`
    case 'divider':
      return `分割 ${p.variant}`
    case 'html':
      return `${p.label}：${String(p.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`
    default:
      return ['kicker', 'index', 'title', 'subtitle', 'text', 'source', 'name', 'role', 'bio', 'author', 'note', 'meta']
        .map((k) => p[k])
        .filter(Boolean)
        .join(' · ')
  }
}
