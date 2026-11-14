import { resolveProposalItems } from './proposalSafety'
import { create } from 'zustand'
import { cloneBlock, createBlock, newId, normalizeBlocks } from '../core/blocks'
import { applyOp, limitToSelection, selectionScope, validateOp } from '../core/ops'
import { allThemes, registerTheme } from '../core/themes'
import { findBlock, insertBlocksAt, insertionPoint, moveBlockTo, removeBlockById, replaceBlockWith, TOP_ONLY, updateBlock } from '../core/tree'
import type { Block, BlockType, Doc, DocOp, SelectionPolicy, Theme } from '../core/types'
import { api } from './api'

const HISTORY_LIMIT = 100

export interface ProposalItem {
  op: DocOp
  status: 'pending' | 'accepted' | 'rejected'
}
export interface Proposal {
  /** Actual successful structural operations in acceptance order, not item order. */
  appliedStructure?: DocOp[]
  summary: string
  items: ProposalItem[]
  errors: string[]
  /** Server-filtered operations are already absent from items; do not count them twice. */
  ignoredOps: number
  selectionPolicy: SelectionPolicy
  /** 生成提案时的文档，用于显示差异 */
  base: Doc
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

interface State {
  doc: Doc
  selectedId: string | null
  selectedIds: string[]
  editingId: string | null
  past: Doc[]
  future: Doc[]
  lastCoalesce: { key: string; at: number } | null
  saveStatus: SaveStatus
  saveError: string
  proposalVersion: number
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
  select: (id: string | null, options?: { toggle?: boolean }) => void
  setEditing: (id: string | null) => void
  setPicking: (id: string | null) => void
  setMatchColors: (on: boolean) => void
  updateProps: (id: string, props: Record<string, any>, coalesceKey?: string) => void
  /** index 省略时插在选中模块之后；选中的是大型文本框（或框内模块）时插入框内 */
  insertBlock: (typeOrBlock: BlockType | Block, index?: number, parentId?: string | null) => string
  insertBlocks: (blocks: Block[], index?: number) => void
  removeBlock: (id: string) => void
  removeSelected: () => void
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
  propose: (summary: string, rawOps: any[], selectedId?: string | string[] | null, options?: { policy?: SelectionPolicy; ignoredOps?: number; expectedVersion?: number }) => void
  resolveProposal: (index: number | 'all', status: 'accepted' | 'rejected', expectedProposal?: Proposal) => void
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

/** Selection is UI state, not document history; prune references after every structural change. */
function validSelection(doc: Doc, state: Pick<State, 'selectedId' | 'selectedIds' | 'editingId' | 'pickingId'>) {
  const valid = (id: string | null) => !!id && !!selectionScope(doc, id)
  const selectedIds = [...new Set(state.selectedIds)].filter(valid)
  const selectedId = selectedIds.includes(state.selectedId ?? '') ? state.selectedId : selectedIds.at(-1) ?? null
  return { selectedIds, selectedId, editingId: selectedIds.length === 1 && state.editingId === selectedId ? selectedId : null, pickingId: selectedIds.length === 1 && state.pickingId === selectedId ? selectedId : null }
}

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  selectedId: null,
  selectedIds: [],
  editingId: null,
  past: [],
  future: [],
  lastCoalesce: null,
  saveStatus: 'saved',
  saveError: '',
  proposalVersion: 0,
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
      ...validSelection(next, get()),
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
    set({ proposalVersion: get().proposalVersion + 1, doc, past: [], future: [], selectedId: null, selectedIds: [], editingId: null, pickingId: null, proposal: null, saveStatus: repaired ? 'dirty' : 'saved', lastCoalesce: null })
    if (repaired) {
      saveNow()
      get().notify('已自动修复文档中格式异常的模块')
    }
  },
  select(id, options) {
    const state = get()
    const valid = id && selectionScope(state.doc, id) ? id : null
    const selectedIds = !valid ? [] : options?.toggle ? state.selectedIds.includes(valid) ? state.selectedIds.filter(value => value !== valid) : [...state.selectedIds, valid] : [valid]
    set(validSelection(state.doc, { ...state, selectedIds, selectedId: selectedIds.at(-1) ?? null }))
  },
  setEditing(id) {
    if (id) get().select(id)
    set({ editingId: id && get().selectedId === id ? id : null, pickingId: null })
  },
  setPicking(id) {
    if (id) get().select(id)
    set({ pickingId: id && get().selectedId === id ? id : null, editingId: null })
  },
  setMatchColors: (on) => set({ matchColors: on }),
  updateProps(id, props, coalesceKey) {
    const { doc, commit } = get()
    commit({ ...doc, blocks: updateBlock(doc.blocks, id, (b) => ({ ...b, props: { ...b.props, ...props } }) as Block) }, coalesceKey)
  },
  insertBlock(typeOrBlock, index, parentId = null) {
    const { doc, selectedId, commit } = get()
    const block = typeof typeOrBlock === 'string' ? createBlock(typeOrBlock) : typeOrBlock
    const top = TOP_ONLY.has(block.type)
    const at = index === undefined ? insertionPoint(doc.blocks, selectedId, top) : { parentId: top ? null : parentId, index }
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parentId, at.index, [block]) })
    get().select(block.id)
    return block.id
  },
  insertBlocks(list, index) {
    const { doc, selectedId, commit } = get()
    const blocks = normalizeBlocks(list).map(cloneBlock)
    const at = index === undefined ? insertionPoint(doc.blocks, selectedId, blocks.some((b) => b.type === 'box')) : { parentId: null, index }
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parentId, at.index, blocks) })
  },
  removeBlock(id) {
    const { doc, commit, selectedId, selectedIds } = get()
    const at = findBlock(doc.blocks, id)
    if (!at) return
    const siblings = at.parent ? at.parent.props.children : doc.blocks
    commit({ ...doc, blocks: removeBlockById(doc.blocks, id) })
    if (selectedIds.length === 1 && selectedId === id) get().select(siblings[at.index + 1]?.id ?? siblings[at.index - 1]?.id ?? at.parent?.id ?? null)
  },
  removeSelected() {
    const { doc, selectedIds, commit } = get()
    const valid = selectedIds.filter(id => !!selectionScope(doc, id))
    if (!valid.length) return
    if (valid.length === 1) { get().removeBlock(valid[0]); return }
    // Removing an ancestor already removes descendants; repeated child removal is a no-op.
    const blocks = valid.reduce((blocks, id) => removeBlockById(blocks, id), doc.blocks)
    if (blocks !== doc.blocks) commit({ ...doc, blocks })
  },
  replaceBlock(id, list) {
    const { doc, commit } = get()
    if (!findBlock(doc.blocks, id) || !list.length) return
    commit({ ...doc, blocks: replaceBlockWith(doc.blocks, id, list) })
    get().select(list[0].id)
  },
  duplicateBlock(id) {
    const { doc, commit } = get()
    const at = findBlock(doc.blocks, id)
    if (!at) return
    const copy = cloneBlock(at.block)
    commit({ ...doc, blocks: insertBlocksAt(doc.blocks, at.parent?.id ?? null, at.index + 1, [copy]) })
    get().select(copy.id)
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
    set({ proposalVersion: get().proposalVersion + 1, proposal: null, doc: past[past.length - 1], ...validSelection(past[past.length - 1], get()), past: past.slice(0, -1), future: [doc, ...future], lastCoalesce: null, saveStatus: 'dirty', editingId: null })
  },
  redo() {
    const { past, doc, future } = get()
    if (!future.length) return
    set({ proposalVersion: get().proposalVersion + 1, proposal: null, doc: future[0], ...validSelection(future[0], get()), future: future.slice(1), past: [...past, doc], lastCoalesce: null, saveStatus: 'dirty', editingId: null })
  },

  propose(summary, rawOps, selectedId, options) {
    if (options?.expectedVersion !== undefined && options.expectedVersion !== get().proposalVersion) return
    const policy = options?.policy === 'filter' ? 'filter' : 'strict'
    const count = options?.ignoredOps
    const ignoredOps = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0
    const base = get().doc
    const items: ProposalItem[] = []
    const errors: string[] = []
    const scoped = limitToSelection(base, selectedId, rawOps, policy)
    for (const op of scoped.dropped) errors.push(`${OP_NAME[op?.op as string] ?? '未知操作'}不在选中的模块上`)
    for (const raw of scoped.ops) {
      const { op, error } = validateOp(base, raw)
      if (op) items.push({ op, status: 'pending' })
      else errors.push(error!)
    }
    set({ proposalVersion: get().proposalVersion + 1, proposal: { summary, items, errors, base, ignoredOps, selectionPolicy: policy } })
  },
  resolveProposal(index, status, expectedProposal) {
    const { proposal, doc, commit } = get()
    if (!proposal || (expectedProposal && proposal !== expectedProposal)) return
    const result = resolveProposalItems(proposal, doc, index, status)
    if (result.doc !== doc) commit(result.doc)
    set({ proposal: result.proposal, proposalVersion: get().proposalVersion + 1 })
  },
  clearProposal: () => set(s => ({ proposal: null, proposalVersion: s.proposalVersion + 1 })),
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

// 保存请求排队依次执行，避免两次保存同时进行时旧内容后写入
let queue: Promise<void> = Promise.resolve()

/** 立即保存当前文档。失败时不抛出，状态变为「保存失败」。 */
export function saveNow(): Promise<void> {
  clearTimeout(timer)
  const run = queue.then(saveOnce)
  queue = run
  return run
}

/**
 * 确认当前内容已经写入本地服务：等待进行中的保存，保存期间又有修改就继续保存。
 * 保存失败时抛出错误。用于退出、下载备份、刷新页面等需要“已保存”为前提的操作。
 */
export async function flushSave(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await saveNow()
    const { saveStatus, saveError } = useStore.getState()
    if (saveStatus === 'saved') return
    if (saveStatus === 'error') throw new Error(saveError || '保存失败')
  }
  throw new Error('内容仍在变化，请停止编辑后再试')
}

async function saveOnce() {
  clearTimeout(timer)
  const { doc } = useStore.getState()
  useStore.setState({ saveStatus: 'saving' })
  try {
    await api.saveProject(doc)
    // 保存期间若有新改动，保持 dirty 以便下一轮保存
    if (useStore.getState().doc === doc) useStore.setState({ saveStatus: 'saved', saveError: '' })
    else {
      clearTimeout(timer)
      timer = setTimeout(saveNow, 800)
    }
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
