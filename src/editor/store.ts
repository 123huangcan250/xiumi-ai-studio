import { create } from 'zustand'
import { cloneBlock, createBlock, newId, normalizeBlocks } from '../core/blocks'
import { applyOp, limitToSelection, orderInsert, validateOp } from '../core/ops'
import { allThemes, registerTheme } from '../core/themes'
import { findBlock, insertBlocksAt, insertionPoint, moveBlockTo, removeBlockById, replaceBlockWith, TOP_ONLY, updateBlock } from '../core/tree'
import type { Block, BlockType, Doc, DocOp, SelectionPolicy, Theme } from '../core/types'
import { api } from './api'

const HISTORY_LIMIT = 100
let loadGeneration = 0

export interface ProposalItem {
  op: DocOp
  status: 'pending' | 'accepted' | 'rejected'
}
export interface Proposal {
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
  editingId: string | null
  past: Doc[]
  future: Doc[]
  lastCoalesce: { key: string; at: number } | null
  saveStatus: SaveStatus
  saveError: string
  savedRevision?: string
  saveConflict: boolean
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
  propose: (summary: string, rawOps: any[], selectedId?: string | null, options?: { policy?: SelectionPolicy; ignoredOps?: number }) => void
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
  savedRevision: undefined,
  saveConflict: false,
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
    loadGeneration++
    clearTimeout(timer)
    // 加载时修复历史数据（例如旧版本保存的、字段类型不对的 AI 修改）
    const doc = normalizeDoc(raw)
    const repaired = JSON.stringify(doc.blocks) !== JSON.stringify(raw.blocks)
    set({ doc, past: [], future: [], selectedId: null, editingId: null, pickingId: null, proposal: null, saveStatus: repaired ? 'dirty' : 'saved', saveError: '', savedRevision: raw.revision, saveConflict: false, lastCoalesce: null })
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
    const top = TOP_ONLY.has(block.type)
    const at = index === undefined ? insertionPoint(doc.blocks, selectedId, top) : { parentId: top ? null : parentId, index }
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

  propose(summary, rawOps, selectedId, options) {
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
    set({ proposal: { summary, items, errors, base, ignoredOps, selectionPolicy: policy } })
  },
  resolveProposal(index, status) {
    const { proposal, doc, commit } = get()
    if (!proposal) return
    const targets = index === 'all' ? proposal.items.map((_, i) => i).filter((i) => proposal.items[i].status === 'pending') : [index]
    let next = doc
    const items = [...proposal.items]
    const errors = [...proposal.errors]
    for (const i of targets) {
      if (!items[i] || items[i].status !== 'pending') continue
      if (status === 'accepted') {
        // 用户可能在提案之后改过文档：按当前文档重新校验
        const { op, error } = validateOp(next, items[i].op)
        if (!op) {
          items[i] = { ...items[i], status: 'rejected' }
          errors.push(error ?? '操作已失效，请重新生成修改建议')
          continue
        }
        const accepted = (list: ProposalItem[]) => list.filter(item => item.status === 'accepted').map(item => item.op)
        next = applyOp(next, orderInsert(next, op, accepted(items.slice(0, i)), accepted(items.slice(i + 1))))
        // Retain the original selection anchor and the actual newly generated block IDs.
        items[i] = { ...items[i], op }
      }
      items[i] = { ...items[i], status }
    }
    if (next !== doc) commit(next)
    set({ proposal: { ...proposal, items, errors } })
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
  if (s.doc === prev.doc || s.saveStatus !== 'dirty' || s.saveConflict) return
  clearTimeout(timer)
  timer = setTimeout(saveNow, 1200)
})

// Serialize writes, but bind every queued save to its document generation.
let queue: Promise<unknown> = Promise.resolve()
export function saveNow(): Promise<boolean> {
  clearTimeout(timer)
  if (useStore.getState().saveConflict) return Promise.resolve(false)
  const generation = loadGeneration
  const run = queue.then(() => generation === loadGeneration ? saveOnce(generation) : false)
  queue = run.catch(() => {})
  return run
}

/** Preserve the existing backup/quit contract: reject unless the latest edit is saved. */
export async function flushSave(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (await saveNow()) return
    const { saveStatus, saveError } = useStore.getState()
    if (saveStatus === 'error') throw new Error(saveError || '保存失败')
  }
  throw new Error('内容仍在变化，请停止编辑后再试')
}

async function saveOnce(generation: number): Promise<boolean> {
  clearTimeout(timer)
  const { doc, savedRevision } = useStore.getState()
  if (useStore.getState().saveConflict) return false
  useStore.setState({ saveStatus: 'saving' })
  try {
    const saved = await api.saveProject({ ...doc, revision: savedRevision })
    if (generation !== loadGeneration) return false
    useStore.setState({ savedRevision: saved.revision })
    if (useStore.getState().doc === doc) {
      useStore.setState({ saveStatus: 'saved', saveError: '' })
      return true
    }
    useStore.setState({ saveStatus: 'dirty' })
    timer = setTimeout(saveNow, 800)
    return false
  } catch (e: any) {
    if (generation === loadGeneration) useStore.setState({ saveStatus: 'error', saveError: e.message, saveConflict: e.status === 409 })
    return false
  }
}

let copyingConflict = false

/** Preserve local edits under a new ID, never force-overwrite the winning draft. */
export async function saveConflictCopy(): Promise<boolean> {
  if (!useStore.getState().saveConflict || copyingConflict) return false
  copyingConflict = true
  clearTimeout(timer)
  const { doc } = useStore.getState()
  const generation = loadGeneration
  const copy = { ...doc, id: newId(), revision: undefined, title: `${doc.title}（冲突副本）` }
  useStore.setState({ saveStatus: 'saving' })
  try {
    const saved = await api.saveProject(copy)
    if (generation !== loadGeneration) return false
    const current = useStore.getState().doc
    const unchanged = current === doc
    useStore.getState().load({ ...current, id: copy.id, title: `${current.title}（冲突副本）`, revision: saved.revision })
    useStore.setState({ saveStatus: unchanged ? 'saved' : 'dirty' })
    if (!unchanged) timer = setTimeout(saveNow, 800)
    useStore.getState().notify('当前内容已另存为副本，原稿保留其他页面的修改。')
    return unchanged
  } catch (e: any) {
    if (generation === loadGeneration) useStore.setState({ saveStatus: 'error', saveError: e.message })
    return false
  } finally {
    copyingConflict = false
  }
}

export async function saveBeforeLeave(): Promise<boolean> {
  if (await saveNow()) return true
  useStore.getState().notify('当前内容尚未保存，已保留原稿；请重试或先导出备份。', 'error')
  return false
}

export async function loadCustomThemes() {
  try {
    for (const t of await api.themes()) registerTheme(t)
    useStore.getState().refreshThemes()
  } catch {
    /* 服务器未启动时只使用内置主题 */
  }
}
