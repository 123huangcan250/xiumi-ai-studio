import { create } from 'zustand'
import { cloneBlock, createBlock, newId, normalizeBlocks } from '../core/blocks'
import { applyOp, validateOp } from '../core/ops'
import { allThemes, registerTheme } from '../core/themes'
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

  /** 所有文档修改的唯一入口：记录历史 */
  commit: (next: Doc, coalesceKey?: string) => void
  load: (doc: Doc) => void
  select: (id: string | null) => void
  setEditing: (id: string | null) => void
  updateProps: (id: string, props: Record<string, any>, coalesceKey?: string) => void
  insertBlock: (typeOrBlock: BlockType | Block, index?: number) => string
  insertBlocks: (blocks: Block[], index?: number) => void
  removeBlock: (id: string) => void
  duplicateBlock: (id: string) => void
  moveBlock: (id: string, to: number) => void
  setDocFields: (fields: Partial<Doc>, coalesceKey?: string) => void
  undo: () => void
  redo: () => void
  propose: (summary: string, rawOps: any[]) => void
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
    set({ doc, past: [], future: [], selectedId: null, editingId: null, proposal: null, saveStatus: repaired ? 'dirty' : 'saved', lastCoalesce: null })
    if (repaired) {
      saveNow()
      get().notify('已自动修复文档中格式异常的模块')
    }
  },
  select: (id) => set((s) => ({ selectedId: id, editingId: s.editingId === id ? s.editingId : null })),
  setEditing: (id) => set({ editingId: id, selectedId: id ?? get().selectedId }),
  updateProps(id, props, coalesceKey) {
    const { doc, commit } = get()
    commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, props: { ...b.props, ...props } } as Block) : b)) }, coalesceKey)
  },
  insertBlock(typeOrBlock, index) {
    const { doc, selectedId, commit } = get()
    const block = typeof typeOrBlock === 'string' ? createBlock(typeOrBlock) : typeOrBlock
    const sel = doc.blocks.findIndex((b) => b.id === selectedId)
    const at = index ?? (sel >= 0 ? sel + 1 : doc.blocks.length)
    const blocks = [...doc.blocks]
    blocks.splice(at, 0, block)
    commit({ ...doc, blocks })
    set({ selectedId: block.id })
    return block.id
  },
  insertBlocks(list, index) {
    const { doc, selectedId, commit } = get()
    const sel = doc.blocks.findIndex((b) => b.id === selectedId)
    const at = index ?? (sel >= 0 ? sel + 1 : doc.blocks.length)
    const blocks = [...doc.blocks]
    blocks.splice(at, 0, ...normalizeBlocks(list).map(cloneBlock))
    commit({ ...doc, blocks })
  },
  removeBlock(id) {
    const { doc, commit, selectedId } = get()
    const i = doc.blocks.findIndex((b) => b.id === id)
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) })
    if (selectedId === id) set({ selectedId: doc.blocks[i + 1]?.id ?? doc.blocks[i - 1]?.id ?? null, editingId: null })
  },
  duplicateBlock(id) {
    const { doc, commit } = get()
    const i = doc.blocks.findIndex((b) => b.id === id)
    if (i < 0) return
    const copy = cloneBlock(doc.blocks[i])
    const blocks = [...doc.blocks]
    blocks.splice(i + 1, 0, copy)
    commit({ ...doc, blocks })
    set({ selectedId: copy.id })
  },
  moveBlock(id, to) {
    const { doc, commit } = get()
    commit(applyOp(doc, { op: 'move', id, to }))
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

  propose(summary, rawOps) {
    const base = get().doc
    const items: ProposalItem[] = []
    const errors: string[] = []
    for (const raw of rawOps) {
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

export const selectedBlock = (s: State) => s.doc.blocks.find((b) => b.id === s.selectedId) ?? null

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
