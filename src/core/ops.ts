import { coerceProps, createBlock, isBlockType, newId } from './blocks'
import { richToPlain } from './richtext'
import { extractSlots, fillSlots } from './slots'
import { findBlock, flatBlocks, removeBlockById, updateBlock } from './tree'
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
      // 大型文本框里的模块也可以按 id 修改
      const b = findBlock(doc.blocks, op.id)?.block
      if (!b) return { error: `找不到模块 ${op.id}` }
      // 原文片段：只接受文字槽位，HTML 由槽位在当前内容上重新计算（不信任传入的 props.html）
      if (b.type === 'html') {
        const raw = op.slots ?? op.props?.slots
        if (!raw || typeof raw !== 'object') return { error: '原文片段只能修改文字槽位（slots）' }
        const known = new Map(extractSlots(b.props.html).flatMap((s) => (s.kind === 'text' ? [[s.id, s] as const] : [])))
        const slots: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw)) {
          const s = known.get(k)
          if (!s || (typeof v !== 'string' && typeof v !== 'number')) continue
          slots[k] = s.tight ? [...String(v).replace(/\s*\n+\s*/g, ' ')].slice(0, s.max).join('') : String(v)
        }
        if (!Object.keys(slots).length) return { error: `修改 ${op.id} 没有有效的文字槽位` }
        return { op: { op: 'update', id: op.id, props: { html: fillSlots(b.props.html, slots, { split: false }) }, slots, reason: op.reason } }
      }
      const props: Record<string, any> = coerceProps(b.type, op.props, true)
      // 文本框的子模块只能逐个修改，不能整体替换（避免丢内容）
      delete props.children
      // 图片位：AI 只能改图注，图片和位置保持不变
      if (props.pics && 'pics' in b.props) {
        const given = props.pics as { caption: string }[]
        props.pics = b.props.pics.map((old, i) => ({ ...old, caption: given[i]?.caption ?? old.caption }))
      }
      if (!Object.keys(props).length) return { error: `修改 ${op.id} 没有有效字段` }
      return { op: { op: 'update', id: op.id, props, reason: op.reason } }
    }
    case 'remove':
      return findBlock(doc.blocks, op.id) ? { op } : { error: `找不到模块 ${op.id}` }
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
      return { ...doc, blocks: updateBlock(blocks, op.id, (b) => ({ ...b, props: { ...b.props, ...op.props } }) as Block) }
    case 'remove':
      return { ...doc, blocks: removeBlockById(blocks, op.id) }
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

/** 选中模块的范围：它自己、里面的子模块，以及它所在的顶层位置（文本框里的子模块以文本框为准） */
export function selectionScope(doc: Doc, selectedId: string | null | undefined): { ids: Set<string>; top: number } | null {
  const at = findBlock(doc.blocks, selectedId)
  if (!at) return null
  const outer = at.parent ?? at.block
  const ids = new Set<string>()
  const add = (b: Block) => {
    ids.add(b.id)
    if (b.type === 'box') b.props.children.forEach(add)
  }
  add(at.block)
  return { ids, top: doc.blocks.findIndex((b) => b.id === outer.id) }
}

/** Match the server's exact-module update boundary; fail closed on stale or mixed scope. */
export function limitToSelection(doc: Doc, selectedId: string | null | undefined, rawOps: any[]): { ops: any[]; dropped: any[] } {
  if (selectedId == null) return { ops: rawOps, dropped: [] }
  const valid = findBlock(doc.blocks, selectedId) && rawOps.every(op => op?.op === 'update' && op.id === selectedId)
  return valid ? { ops: rawOps, dropped: [] } : { ops: [], dropped: rawOps }
}

/** 人类可读的改动说明，用于差异面板 */
export function describeOp(doc: Doc, op: DocOp): { title: string; before?: string; after?: string } {
  const label = (b?: Block) => (b ? `${b.type}「${summarize(b).slice(0, 18)}」` : '')
  switch (op.op) {
    case 'insert':
      return { title: `在第 ${op.index + 1} 位插入 ${op.block.type}`, after: summarize(op.block) }
    case 'update': {
      const b = findBlock(doc.blocks, op.id)?.block
      const after = b ? summarize({ ...b, props: { ...b.props, ...op.props } } as Block) : ''
      return { title: `修改 ${label(b)}`, before: b ? summarize(b) : '', after }
    }
    case 'remove': {
      const b = findBlock(doc.blocks, op.id)?.block
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
    case 'box':
      return [p.title, ...flatBlocks(p.children).map(summarize)].filter(Boolean).join('；')
    case 'carousel':
      return `轮播 ${p.pics.filter((x: any) => x.image).length} 张图 ${p.pics.map((x: any) => x.caption).filter(Boolean).join(' / ')}`
    case 'photos':
      return `${p.count} 张图 ${p.pics.map((x: any) => x.caption).filter(Boolean).join(' / ')}`
    case 'frame':
      return `图片框 ${[p.caption, p.label].filter(Boolean).join(' · ')}`
    case 'html':
      return `${p.label}：${String(p.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`
    default:
      return ['kicker', 'index', 'title', 'subtitle', 'text', 'source', 'name', 'role', 'bio', 'author', 'note', 'meta']
        .map((k) => p[k])
        .filter(Boolean)
        .join(' · ')
  }
}
