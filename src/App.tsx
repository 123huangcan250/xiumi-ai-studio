import { DndContext, DragOverlay, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { blockMeta, createBlock } from './core/blocks'
import type { BlockType } from './core/types'
import { replacePhoto } from './core/photos'
import { api, assetRef, type Asset } from './editor/api'
import { Canvas, photoTarget, shownRatio } from './editor/Canvas'
import { LeftPanel } from './editor/LeftPanel'
import { RightPanel } from './editor/RightPanel'
import { emptyDoc, loadCustomThemes, saveNow, useStore } from './editor/store'
import { Toolbar } from './editor/Toolbar'

// 优先按指针所在位置判定落点，指针不在任何目标上时再取最近的模块
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : closestCenter(args)
}

const IMAGE_TARGETS = new Set(['image', 'imageText', 'profile', 'cover', 'ending', 'gallery'])

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        s.removeBlock(s.selectedId)
      } else if (e.key === 'Escape') s.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  useShortcuts()

  useEffect(() => {
    ;(async () => {
      await loadCustomThemes()
      try {
        const list = await api.projects()
        if (list.length) useStore.getState().load(await api.project(list[0].id))
        else {
          useStore.getState().load(emptyDoc())
          await saveNow()
        }
      } catch (e: any) {
        useStore.getState().notify(`无法连接本地服务：${e.message}（请用 pnpm dev 启动）`, 'error')
      }
      setReady(true)
    })()
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().saveStatus !== 'saved') e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setDragLabel(id.startsWith('lib:') ? blockMeta(id.slice(4) as BlockType).label : id.startsWith('asset:') ? '图片' : null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null)
    const s = useStore.getState()
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over) return
    const blocks = s.doc.blocks
    const overIndex = over === 'canvas-end' ? blocks.length : blocks.findIndex((b) => b.id === over)
    if (overIndex < 0) return
    // 新模块落在目标模块下半部分时插到其后
    const dragged = e.active.rect.current.translated
    const lowerHalf = !!dragged && !!e.over && dragged.top + dragged.height / 2 > e.over.rect.top + e.over.rect.height / 2
    const insertAt = over === 'canvas-end' ? overIndex : overIndex + (lowerHalf ? 1 : 0)
    if (active.startsWith('lib:')) {
      s.insertBlock(active.slice(4) as BlockType, insertAt)
    } else if (active.startsWith('asset:')) {
      const asset = e.active.data.current?.asset as Asset
      // 松手位置正好在某张照片上：只替换这张照片（原文片段里的照片按原相框裁切）
      const start = e.activatorEvent as PointerEvent | null
      if (start && 'clientX' in start) {
        const hit = document.elementsFromPoint(start.clientX + e.delta.x, start.clientY + e.delta.y).map(photoTarget).find(Boolean)
        if (hit) {
          const next = replacePhoto(s.doc, hit.pos, assetRef(asset), { ratio: shownRatio(hit.img) })
          if (next !== s.doc) {
            s.commit(next)
            s.select(hit.pos.blockId)
            return
          }
        }
      }
      const target = blocks[overIndex]
      const ref = assetRef(asset)
      if (target && IMAGE_TARGETS.has(target.type)) {
        if (target.type === 'gallery') s.updateProps(target.id, { images: [...target.props.images, ref] })
        else s.updateProps(target.id, { image: ref })
        s.select(target.id)
      } else s.insertBlock(createBlock('image', { image: ref }), insertAt)
    } else if (active !== over) {
      s.moveBlock(active, overIndex)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragLabel(null)}>
      <div className="app">
        <Toolbar />
        <main className="workspace">
          <LeftPanel />
          {ready ? <Canvas /> : <div className="canvas-scroll loading">加载中…</div>}
          <RightPanel />
        </main>
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      </div>
      <DragOverlay dropAnimation={null}>{dragLabel && <div className="drag-overlay">{dragLabel}</div>}</DragOverlay>
    </DndContext>
  )
}
