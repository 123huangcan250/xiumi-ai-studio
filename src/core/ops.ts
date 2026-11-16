import { BLOCK_TYPES, coerceProps, createBlock, newId } from './blocks'
import { richToPlain } from './richtext'
import { extractSlots, fillSlots } from './slots'
import { findBlock, flatBlocks, removeBlockById, updateBlock } from './tree'
import type { Block, Doc, DocOp, InsertAnchor, SelectionPolicy } from './types'

/** Insert payloads are new content, never references to existing block identities. */
function freshInsertBlock(raw: any): Block | null {
  const type = raw?.type
  if (!BLOCK_TYPES.includes(type) || type === 'html' || type === 'replay') return null
  let children: Block[] | undefined
  if (type === 'box' && raw.props?.children !== undefined) {
    if (!Array.isArray(raw.props.children)) return null
    children = []
    for (const child of raw.props.children) {
      // Boxes cannot nest, and HTML cannot bypass the top-level insert restriction.
      if (child?.type === 'box') return null
      const block = freshInsertBlock(child)
      if (!block) return null
      children.push(block)
    }
  }
  return createBlock(type, coerceProps(type, { ...raw.props, ...(children && { children }) }) as any)
}

/** An invalid or deleted anchor must not fall back to an unrelated numeric position. */
function anchoredIndex(doc: Pick<Doc, 'blocks'>, anchor: any): number | null {
  if (!anchor || typeof anchor.id !== 'string' || !['before', 'after'].includes(anchor.side)) return null
  const matches = doc.blocks.filter(b => b.id === anchor.id)
  if (matches.length !== 1) return null
  return doc.blocks.indexOf(matches[0]) + (anchor.side === 'after' ? 1 : 0)
}

/** 校验并修复一条 op；非法时返回错误信息 */
export function validateOp(doc: Doc, op: any): { op?: DocOp; error?: string } {
  if (!op || typeof op !== 'object') return { error: 'op 不是对象' }
  switch (op.op) {
    case 'insert': {
      const block = freshInsertBlock(op.block)
      if (!block) return { error: '插入模块或子模块的类型无效' }
      const anchored = 'anchor' in op
      const index = anchored ? anchoredIndex(doc, op.anchor) : Math.max(0, Math.min(doc.blocks.length, Number(op.index ?? doc.blocks.length)))
      if (index === null || !Number.isInteger(index)) return { error: '插入位置或锚点无效，请重新生成修改建议' }
      const anchor: InsertAnchor | undefined = anchored ? { id: op.anchor.id, side: op.anchor.side } : undefined
      return { op: { op: 'insert', index, block, ...(anchor && { anchor }), reason: op.reason } }
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
      if (b.type === 'replay') return { error: '编辑回放模块不支持 AI 修改' }
      // Never normalize untrusted replacement children: updates cannot replace identities or content trees.
      const fields = op.props && typeof op.props === 'object' ? { ...op.props } : {}
      delete fields.children
      const props: Record<string, any> = coerceProps(b.type, fields, true)
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
    case 'insert': {
      const index = 'anchor' in op ? anchoredIndex(doc, op.anchor) : op.index
      if (index === null) return doc
      blocks.splice(index, 0, { ...op.block, id: op.block.id || newId() })
      return { ...doc, blocks }
    }
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

/** Keep sibling inserts in proposal order, including when suggestions are accepted out of order. */
export function orderInsert(doc: Doc, op: DocOp, earlier: DocOp[], later: DocOp[] = []): DocOp {
  if (op.op !== 'insert' || !op.anchor || anchoredIndex(doc, op.anchor) === null) return op
  const sameAnchor = (other: DocOp): other is Extract<DocOp, { op: 'insert' }> =>
    other.op === 'insert' && other.anchor?.id === op.anchor!.id && other.anchor.side === op.anchor!.side
  const group = new Set([...earlier, ...later].filter(sameAnchor).map(other => other.block.id))
  // A previously accepted insert may have been manually moved elsewhere. Never follow it out of scope.
  const adjacent = new Set<string>()
  const step = op.anchor.side === 'after' ? 1 : -1
  for (let i = doc.blocks.findIndex(b => b.id === op.anchor!.id) + step; group.has(doc.blocks[i]?.id); i += step) adjacent.add(doc.blocks[i].id)
  const neighbor = (other: DocOp): other is Extract<DocOp, { op: 'insert' }> => sameAnchor(other) && adjacent.has(other.block.id)
  const following = later.find(neighbor)
  const previous = earlier.findLast(neighbor)
  const anchor: InsertAnchor | undefined = following ? { id: following.block.id, side: 'before' }
    : previous ? { id: previous.block.id, side: 'after' } : undefined
  return anchor ? { ...op, anchor } : op
}

export function applyOps(doc: Doc, ops: DocOp[]): Doc {
  return ops.reduce((next, op, index) => applyOp(next, orderInsert(next, op, ops.slice(0, index))), doc)
}

// Server AI context contains summary-only neighbors, not necessarily full Block props.
type ScopeDocument = { blocks: { id: string; type: string; props?: any }[] }

/** 选中模块自身和子模块；框内模块的前后插入以所在的顶层文本框为锚点。 */
export function selectionScope(doc: ScopeDocument, selectedId: string | null | undefined): { ids: Set<string>; top: number } | null {
  if (!selectedId || !Array.isArray(doc?.blocks)) return null
  const counts = new Map<string, number>()
  let selected: ScopeDocument['blocks'][number] | undefined
  let top = -1
  const children = (b: ScopeDocument['blocks'][number]) => b?.type === 'box' && Array.isArray(b.props?.children) ? b.props.children : []
  const visit = (b: ScopeDocument['blocks'][number], index: number) => {
    if (!b) return
    if (typeof b.id === 'string' && b.id) counts.set(b.id, (counts.get(b.id) ?? 0) + 1)
    if (b.id === selectedId) { selected = b; top = index }
    children(b).forEach((child: ScopeDocument['blocks'][number]) => visit(child, index))
  }
  doc.blocks.forEach(visit)
  if (!selected) return null
  const ids = new Set<string>()
  let valid = true
  const add = (b: ScopeDocument['blocks'][number]) => {
    if (!b || !b.id || counts.get(b.id) !== 1) { valid = false; return }
    ids.add(b.id)
    children(b).forEach(add)
  }
  add(selected)
  if (!valid) return null
  return { ids, top }
}

/** Each selected identity must resolve; never degrade an invalid list into document scope. */
export function selectionScopes(doc: ScopeDocument, selection: string | string[]): { ids: Set<string>; tops: number[] } | null {
  const requested = Array.isArray(selection) ? selection : [selection]
  if (!requested.length || requested.some(id => typeof id !== 'string' || !id) || new Set(requested).size !== requested.length) return null
  const ids = new Set<string>(), tops = new Set<number>()
  for (const id of requested) {
    const scope = selectionScope(doc, id)
    if (!scope) return null
    scope.ids.forEach(value => ids.add(value)); tops.add(scope.top)
  }
  return { ids, tops: [...tops].sort((a, b) => a - b) }
}

/** Strict stays atomic/update-only; filter preserves descendant edits and adjacent anchored inserts. */
export function limitToSelection(doc: ScopeDocument, selectedId: string | string[] | null | undefined, rawOps: any[], policy: SelectionPolicy = 'filter'): { ops: any[]; dropped: any[] } {
  if (selectedId == null) return { ops: rawOps, dropped: [] }
  const scope = selectionScopes(doc, selectedId)
  if (!scope) return { ops: [], dropped: rawOps }
  if (policy !== 'filter') {
    const valid = rawOps.every(op => op?.op === 'update' && scope.ids.has(op.id))
    return valid ? { ops: rawOps, dropped: [] } : { ops: [], dropped: rawOps }
  }
  const ops: any[] = [], dropped: any[] = []
  for (const op of rawOps) {
    const index = typeof op?.index === 'number' || (typeof op?.index === 'string' && op.index.trim()) ? Number(op.index) : NaN
    if ((op?.op === 'update' || op?.op === 'remove') && scope.ids.has(op.id)) {
      ops.push(op)
    } else if (op?.op === 'insert' && Number.isInteger(index)) {
      // Shared gaps default to the first top-level root in document order, not click order.
      const candidates: InsertAnchor[] = scope.tops.filter(top => index === top || index === top + 1).map(top => ({ id: doc.blocks[top].id, side: index === top ? 'before' : 'after' }))
      const anchor = 'anchor' in op ? candidates.find(candidate => candidate.id === op.anchor?.id && candidate.side === op.anchor?.side) : candidates[0]
      if (!anchor?.id || doc.blocks.filter(b => b?.id === anchor.id).length !== 1) dropped.push(op)
      else ops.push({ ...op, index, anchor })
    } else dropped.push(op)
  }
  return { ops, dropped }
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
    case 'replay':
      return `编辑回放 ${p.scenes.length} 个场景：${p.scenes.flatMap((s: any) => s.items.map((i: any) => i.content)).filter(Boolean).join(' / ').slice(0, 160)}`
    case 'html':
      return `${p.label}：${String(p.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`
    default:
      return ['kicker', 'index', 'title', 'subtitle', 'text', 'source', 'name', 'role', 'bio', 'author', 'note', 'meta']
        .map((k) => p[k])
        .filter(Boolean)
        .join(' · ')
  }
}
