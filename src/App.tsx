import { DndContext, DragOverlay, MeasuringStrategy, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { blockMeta, createBlock } from './core/blocks'
import type { Block, BlockType } from './core/types'
import { addPicTo, replacePhoto } from './core/photos'
import { findBlock } from './core/tree'
import { CollectHost } from './editor/CollectModal'
import { insertComponent } from './editor/componentActions'
import { api, assetRef, type Asset } from './editor/api'
import { Canvas, photoTarget, shownRatio, slotTarget } from './editor/Canvas'
import { KIT_ITEMS } from './editor/kitItems'
import { LeftPanel } from './editor/LeftPanel'
import { ReplayHost } from './editor/ReplayPreview'
import { RightPanel } from './editor/RightPanel'
import { loadIfUnchanged } from './editor/documentNavigation'
import { emptyDoc, loadCustomThemes, saveNow, useStore } from './editor/store'
import { listenForAiSettings } from './editor/suggestionQueue'
import { Toolbar } from './editor/Toolbar'
import { Workspace } from './editor/Workspace'

type Hit = { data?: { droppableContainer?: { data?: { current?: { parentId?: string | null } } } } }
const parentOf = (h: Hit) => h.data?.droppableContainer?.data?.current?.parentId ?? null

// 优先按指针所在位置判定落点，指针不在任何目标上时再取最近的模块。
// 文本框和框内模块同时命中时取框内（最内层）；拖动文本框本身时不能落进它自己里面。
const collision: CollisionDetection = (args) => {
  const active = String(args.active.id)
  const hits = pointerWithin(args)
    .filter((h) => parentOf(h) !== active)
    .sort((a, b) => Number(!!parentOf(b)) - Number(!!parentOf(a)))
  return hits.length ? hits : closestCenter(args)
}

const IMAGE_TARGETS = new Set(['image', 'imageText', 'profile', 'cover', 'ending', 'gallery'])

/** 落点：顶层或某个文本框内的位置；over 为模块时按上下半区决定插在它前面还是后面 */
function dropTarget(blocks: Block[], over: string, lowerHalf: boolean): { parentId: string | null; index: number; block?: Block } | null {
  if (over === 'canvas-end') return { parentId: null, index: blocks.length }
  if (over.startsWith('box:')) {
    const box = findBlock(blocks, over.slice(4))?.block
    return box?.type === 'box' ? { parentId: box.id, index: box.props.children.length } : null
  }
  const at = findBlock(blocks, over)
  return at ? { parentId: at.parent?.id ?? null, index: at.index + (lowerHalf ? 1 : 0), block: at.block } : null
}

/** 文本框不能放进文本框：改为放在外层文本框之后 */
function outsideBox(blocks: Block[], t: { parentId: string | null; index: number }, movingId?: string) {
  if (!t.parentId) return t
  const rest = movingId ? blocks.filter((b) => b.id !== movingId) : blocks
  return { parentId: null, index: rest.findIndex((b) => b.id === t.parentId) + 1 }
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Dialogs own their keyboard interactions; never edit the article behind them.
      if (document.querySelector('[role="dialog"]')) return
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
        return
      }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId && !s.editingId) {
        e.preventDefault()
        s.removeSelected()
      } else if (e.key === 'Escape') s.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  useEffect(() => listenForAiSettings(window), [])
  const [ready, setReady] = useState(false)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  useShortcuts()

  useEffect(() => {
    let active = true
    const expected = useStore.getState().doc
    ;(async () => {
      await loadCustomThemes()
      if (!active) return
      try {
        const list = await api.projects()
        if (!active) return
        if (!Array.isArray(list)) throw new Error('项目列表响应格式错误，未创建或替换文稿。')
        if (list.length) {
          const initial = await api.project(list[0].id)
          if (active) loadIfUnchanged(initial, expected)
        } else if (loadIfUnchanged(emptyDoc(), expected)) {
          await saveNow()
        }
      } catch (e: any) {
        if (active) useStore.getState().notify(`无法连接本地服务：${e.message}（请用 pnpm dev 启动）`, 'error')
      }
      if (active) setReady(true)
    })()
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().saveStatus !== 'saved') e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { active = false; window.removeEventListener('beforeunload', beforeUnload) }
  }, [])

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setDragLabel(
      id.startsWith('lib:') ? blockMeta(id.slice(4) as BlockType).label
      : id.startsWith('kit:') ? (KIT_ITEMS.find((k) => k.key === id.slice(4))?.label ?? '模块')
      : id.startsWith('asset:') ? '图片'
      : id.startsWith('comp:') ? String(e.active.data.current?.label ?? '组件')
      : '',
    )
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null)
    const s = useStore.getState()
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    const blocks = s.doc.blocks
    // 新模块落在目标模块下半部分时插到其后
    const dragged = e.active.rect.current.translated
    const lowerHalf = !!dragged && !!e.over && dragged.top + dragged.height / 2 > e.over.rect.top + e.over.rect.height / 2
    const t = dropTarget(blocks, over, lowerHalf)
    if (!t) return
    const insert = (b: Block) => {
      const at = b.type === 'box' ? outsideBox(blocks, t) : t
      s.insertBlock(b, at.index, at.parentId)
    }
    if (active.startsWith('lib:')) {
      insert(createBlock(active.slice(4) as BlockType))
    } else if (active.startsWith('kit:')) {
      const item = KIT_ITEMS.find((k) => k.key === active.slice(4))
      if (item) insert(item.make())
    } else if (active.startsWith('comp:')) {
      const data = e.active.data.current
      if (data?.block) {
        const at = data.block.type === 'box' ? outsideBox(blocks, t) : t
        insertComponent(data.block, { index: at.index, parentId: at.parentId, missing: data.missing })
      }
    } else if (active.startsWith('asset:')) {
      const asset = e.active.data.current?.asset as Asset
      const ref = assetRef(asset)
      // 松手位置正好在某张照片或空图片位上：只换这一张（原文片段里的照片按原相框裁切）
      const start = e.activatorEvent as PointerEvent | null
      if (start && 'clientX' in start) {
        const els = document.elementsFromPoint(start.clientX + e.delta.x, start.clientY + e.delta.y)
        const hit = els.map(photoTarget).find(Boolean) ?? els.map(slotTarget).find(Boolean)
        if (hit) {
          const next = replacePhoto(s.doc, hit.pos, ref, { ratio: shownRatio(hit.img), allowEmpty: true })
          if (next !== s.doc) {
            s.commit(next)
            s.select(hit.pos.blockId)
            return
          }
        }
      }
      const target = t.block
      if (target && IMAGE_TARGETS.has(target.type)) {
        if (target.type === 'gallery') s.updateProps(target.id, { images: [...target.props.images, ref] })
        else s.updateProps(target.id, { image: ref })
        s.select(target.id)
      } else if (target && (target.type === 'carousel' || target.type === 'photos' || target.type === 'frame')) {
        const next = addPicTo(target, ref)
        if (next) s.updateProps(target.id, next.props)
        else s.notify('这组图片已放满：拖到某张图片上可以替换', 'error')
        s.select(target.id)
      } else s.insertBlock(createBlock('image', { image: ref }), t.index, t.parentId)
    } else if (active !== over) {
      const from = findBlock(blocks, active)
      if (!from) return
      if (from.block.type === 'box' && t.parentId) s.moveBlockTo(active, null, outsideBox(blocks, t, active).index)
      // 同一层内排序：和原来一样移到目标模块的位置
      else if ((from.parent?.id ?? null) === t.parentId && t.block) s.moveBlock(active, findBlock(blocks, t.block.id)!.index)
      else s.moveBlockTo(active, t.parentId, t.index)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      // 拖动时文本框的落点区会展开，需要持续测量
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      <div className={`app ${dragLabel !== null ? 'dragging' : ''}`}>
        <Toolbar />
        <Workspace>
          <LeftPanel />
          {ready ? <Canvas /> : <div className="canvas-scroll loading">加载中…</div>}
          <RightPanel />
        </Workspace>
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
        <CollectHost />
        <ReplayHost />
      </div>
      <DragOverlay dropAnimation={null}>{dragLabel && <div className="drag-overlay">{dragLabel}</div>}</DragOverlay>
    </DndContext>
  )
}
