import { create } from 'zustand'
import { cloneBlock, createBlock, newId, normalizeBlocks } from '../core/blocks'
import { applyOp, limitToSelection, validateOp } from '../core/ops'
import { allThemes, registerTheme } from '../core/themes'
import { findBlock, insertBlocksAt, insertionPoint, moveBlockTo, removeBlockById, replaceBlockWith, updateBlock } from '../core/tree'
import type { Block, BlockType, Doc, DocOp, Theme } from '../core/types'
import { api } from './api'

const HISTORY_LIMIT = 100

export interface ProposalItem {
  op: DocOp
  status: 'pending' | 'accepted' | 'rejected'
}
export interface Proposal {
  summary: string
  items: ProposalItem[]
  errors: string[]
  /** 生成提案时的文档，用于显示差异 */
  base: Doc
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

interface State {
  doc: Doc
  selectedId: string | null
  editingId: string | null
  past: Doc[]
  future: Doc[]
  lastCoalesce: { key: string; at: number } | null
  saveStatus: SaveStatus
  saveError: string
  proposal: Proposal | null
  themes: Theme[]
  toast: { text: string; kind: 'ok' | 'error' } | null
  /** 正在点选子结构的模块 */
  pickingId: string | null
  /** 插入组件时统一到本文配色 */
  matchColors: boolean

  /** 所有文档修改的唯一入口：记录历史 */
  commit: (next: Doc, coalesceKey?: string) => void
  load: (doc: Doc) => void
  select: (id: string | null) => void
  setEditing: (id: string | null) => void
  setPicking: (id: string | null) => void
  setMatchColors: (on: boolean) => void
  updateProps: (id: string, props: Record<string, any>, coalesceKey?: string) => void
  /** index 省略时插在选中模块之后；选中的是大型文本框（或框内模块）时插入框内 */
  insertBlock: (typeOrBlock: BlockType | Block, index?: number, parentId?: string | null) => string
  insertBlocks: (blocks: Block[], index?: number) => void
  removeBlock: (id: string) => void
  /** 用几个模块替换一个模块（拆开模块），可撤销 */
  replaceBlock: (id: string, blocks: Block[]) => void
  duplicateBlock: (id: string) => void
  /** 在同一层内移动 */
  moveBlock: (id: string, to: number) => void
  /** 移到某个文本框内（parentId）或顶层（null） */
  moveBlockTo: (id: string, parentId: string | null, index: number) => void
  setDocFields: (fields: Partial<Doc>, coalesceKey?: string) => void
  undo: () => void
  redo: () => void
  /** selectedId：用户选中了模块时，只接受落在这个模块上的操作 */
  propose: (summary: string, rawOps: any[], selectedId?: string | null) => void
  resolveProposal: (index: number | 'all', status: 'accepted' | 'rejected') => void
  clearProposal: () => void
  refreshThemes: () => void
  notify: (text: string, kind?: 'ok' | 'error') => void
}

/** 修复从服务器、版本或模板读入的文档 */
export function normalizeDoc(raw: Doc): Doc {
  const now = Date.now()
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    ...raw,
    id: s(raw.id) || newId(),
    title: s(raw.title),
    author: s(raw.author),
    digest: s(raw.digest),
    themeId: s(raw.themeId) || 'tsinghua-purple',
    cover: raw.cover && typeof raw.cover.src === 'string' ? raw.cover : undefined,
    blocks: normalizeBlocks(raw.blocks),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
  }
}

export function emptyDoc(): Doc {
  const now = Date.now()
  return {
    id: newId(),
    title: '未命名推文',
    author: '',
    digest: '',
    themeId: 'tsinghua-purple',
    blocks: [createBlock('cover'), createBlock('heading'), createBlock('paragraph'), createBlock('ending')],
    createdAt: now,
    updatedAt: now,
  }
}

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  selectedId: null,
  editingId: null,
  past: [],
  future: [],
  lastCoalesce: null,
  saveStatus: 'saved',
  saveError: '',
  proposal: null,
  themes: allThemes(),
  toast: null,
  pickingId: null,
  matchColors: false,

  commit(next, coalesceKey) {
    const { doc, past, lastCoalesce } = get()
    const now = Date.now()
    const merge = coalesceKey && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < 1500
    set({
      doc: { ...next, updatedAt: now },
      past: merge ? past : [...past, doc].slice(-HISTORY_LIMIT),
      future: [],
      lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
      saveStatus: 'dirty',
    })
  },
  load(raw) {
    // 加载时修复历史数据（例如旧版本保存的、字段类型不对的 AI 修改）
    const doc = normalizeDoc(raw)
    const repaired = JSON.stringify(doc.blocks) !== JSON.stringify(raw.blocks)
    set({ doc, past: [], future: [], selectedId: null, editingId: null, pickingId: null, proposal: null, saveStatus: repaired ? 'dirty' : 'saved', lastCoalesce: null })
    if (repaired) {
      saveNow()
      get().notify('已自动修复文档中格式异常的模块')
    }
  },
  select: (id) => set((s) => ({ selectedId: id, editingId: s.editingId === id ? s.editingId : null, pickingId: s.pickingId === id ? s.pickingId : null })),
  setEditing: (id) => set({ editingId: id, selectedId: id ?? get().selectedId, pickingId: null }),
  setPicking: (id) => set({ pickingId: id, editingId: null, selectedId: id ?? get().selectedId }),
  setMatchColors: (on) => set({ matchColors: on }),
  updateProps(id, props, coalesceKey) {
    const { doc, commit } = get()
    commit({ ...doc, blocks: updateBlock(doc.blocks, id, (b) => ({ ...b, props: { ...b.props, ...props } }) as Block) }, coalesceKey)
  },
  insertBlock(typeOrBlock, index, parentId = null) {
    const { doc, selectedId, commit } = get()
    const block = typeof typeOrBlock === 'string' ? createBlock(typeOrBlock) : typeOrBlock
    const at = index === undefined ? insertionPoint(doc.blocks, selectedId, block.type === 'box') : { parentId: block.type === 'box' ? null : parentId, index }
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parentId, at.index, [block]) })
    set({ selectedId: block.id })
    return block.id
  },
  insertBlocks(list, index) {
    const { doc, selectedId, commit } = get()
    const blocks = normalizeBlocks(list).map(cloneBlock)
    const at = index === undefined ? insertionPoint(doc.blocks, selectedId, blocks.some((b) => b.type === 'box')) : { parentId: null, index }
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parentId, at.index, blocks) })
  },
  removeBlock(id) {
    const { doc, commit, selectedId } = get()
    const at = findBlock(doc.blocks, id)
    if (!at) return
    const siblings = at.parent ? at.parent.props.children : doc.blocks
    commit({ ...doc, blocks: removeBlockById(doc.blocks, id) })
    if (selectedId === id) set({ selectedId: siblings[at.index + 1]?.id ?? siblings[at.index - 1]?.id ?? at.parent?.id ?? null, editingId: null })
  },
  replaceBlock(id, list) {
    const { doc, commit } = get()
    if (!findBlock(doc.blocks, id) || !list.length) return
    commit({ ...doc, blocks: replaceBlockWith(doc.blocks, id, list) })
    set({ selectedId: list[0].id, editingId: null, pickingId: null })
  },
  duplicateBlock(id) {
    const { doc, commit } = get()
    const at = findBlock(doc.blocks, id)
    if (!at) return
    const copy = cloneBlock(at.block)
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parent?.id ?? null, at.index + 1, [copy]) })
    set({ selectedId: copy.id })
  },
  moveBlock(id, to) {
    const { doc, commit } = get()
    const at = findBlock(doc.blocks, id)
    if (!at) return
    if (!at.parent) commit(applyOp(doc, { op: 'move', id, to }))
    else commit({ ...doc, blocks: moveBlockTo(doc.blocks, id, at.parent.id, to) })
  },
  moveBlockTo(id, parentId, index) {
    const { doc, commit } = get()
    const next = moveBlockTo(doc.blocks, id, parentId, index)
    if (next !== doc.blocks) commit({ ...doc, blocks: next })
  },
  setDocFields(fields, coalesceKey) {
    get().commit({ ...get().doc, ...fields }, coalesceKey)
  },
  undo() {
    const { past, doc, future } = get()
    if (!past.length) return
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], lastCoalesce: null, saveStatus: 'dirty', editingId: null })
  },
  redo() {
    const { past, doc, future } = get()
    if (!future.length) return
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], lastCoalesce: null, saveStatus: 'dirty', editingId: null })
  },

  propose(summary, rawOps, selectedId) {
    const base = get().doc
    const items: ProposalItem[] = []
    const errors: string[] = []
    const scoped = limitToSelection(base, selectedId, rawOps)
    for (const op of scoped.dropped) errors.push(`${OP_NAME[op?.op as string] ?? '未知操作'}不在选中的模块上`)
    for (const raw of scoped.ops) {
      const { op, error } = validateOp(base, raw)
      if (op) items.push({ op, status: 'pending' })
      else errors.push(error!)
    }
    set({ proposal: { summary, items, errors, base } })
  },
  resolveProposal(index, status) {
    const { proposal, doc, commit } = get()
    if (!proposal) return
    const targets = index === 'all' ? proposal.items.map((_, i) => i).filter((i) => proposal.items[i].status === 'pending') : [index]
    let next = doc
    const items = [...proposal.items]
    for (const i of targets) {
      if (status === 'accepted') {
        // 用户可能在提案之后改过文档：按当前文档重新校验
        const { op } = validateOp(next, items[i].op)
        if (!op) {
          items[i] = { ...items[i], status: 'rejected' }
          continue
        }
        next = applyOp(next, op)
      }
      items[i] = { ...items[i], status }
    }
    if (next !== doc) commit(next)
    set({ proposal: { ...proposal, items } })
  },
  clearProposal: () => set({ proposal: null }),
  refreshThemes: () => set({ themes: allThemes() }),
  notify(text, kind = 'ok') {
    set({ toast: { text, kind } })
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null })
    }, 3200)
  },
}))

/** 被丢弃的操作在提示里的叫法 */
const OP_NAME: Record<string, string> = { update: '修改其他模块', remove: '删除其他模块', insert: '在远处插入模块', move: '调整顺序', setTheme: '切换主题', setMeta: '修改文章信息' }

export const selectedBlock = (s: State) => findBlock(s.doc.blocks, s.selectedId)?.block ?? null


// ---------- 自动保存 ----------
let timer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc || s.saveStatus !== 'dirty') return
  clearTimeout(timer)
  timer = setTimeout(saveNow, 1200)
})

export async function saveNow() {
  clearTimeout(timer)
  const { doc } = useStore.getState()
  useStore.setState({ saveStatus: 'saving' })
  try {
    await api.saveProject(doc)
    // 保存期间若有新改动，保持 dirty 以便下一轮保存
    if (useStore.getState().doc === doc) useStore.setState({ saveStatus: 'saved', saveError: '' })
    else timer = setTimeout(saveNow, 800)
  } catch (e: any) {
    useStore.setState({ saveStatus: 'error', saveError: e.message })
  }
}

export async function loadCustomThemes() {
  try {
    for (const t of await api.themes()) registerTheme(t)
    useStore.getState().refreshThemes()
  } catch {
    /* 服务器未启动时只使用内置主题 */
  }
}
