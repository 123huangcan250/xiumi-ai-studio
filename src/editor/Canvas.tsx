import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { blockMeta } from '../core/blocks'
import { blockGap, compileBlock, rootStyle } from '../core/compiler'
import { blockPhotos, swapPhotos, type PhotoPos } from '../core/photos'
import { sanitizeHtml } from '../core/sanitize'
import { resolveTheme } from '../core/themes'
import type { Block, Theme } from '../core/types'
import { api } from './api'
import { ErrorBoundary } from './ErrorBoundary'
import { useStore } from './store'

/** "a:b;c:d" → React style 对象 */
export function styleObj(s: string): React.CSSProperties {
  const o: Record<string, string> = {}
  for (const d of s.split(';')) {
    const i = d.indexOf(':')
    if (i > 0) o[d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d.slice(i + 1).trim()
  }
  return o
}

// tiptap 体积较大，首次双击编辑时再加载
const RichEditor = lazy(() => import('./RichEditor').then((m) => ({ default: m.RichEditor })))

const parseDoc = (s: string) => new DOMParser().parseFromString(s, 'text/html')

const textless = (el: Element) => !(el.textContent ?? '').replace(/\s/g, '')

/**
 * 点中的图片区域：图片、SVG 图形或背景图所在、且不含文字的最外层容器（相框、轮播一起选中）。
 * 秀米的 SVG 轮播不响应点击，点击会落在外框上，同样能选中。
 */
function mediaFrame(target: Element, editor: Element): Element | null {
  // 点在 SVG 内部（轮播里接收滑动的透明矩形等）：按最外层的 SVG 图形算
  for (let s = target.closest('svg'); s && editor.contains(s); s = s.parentElement?.closest('svg') ?? null) target = s
  if (target === editor || !textless(target)) return null
  if (!(target.matches('img, svg') || target.querySelector('img, svg') || /background-image/i.test(target.getAttribute('style') ?? ''))) return null
  let top = target
  for (let p = target.parentElement; p && p !== editor && textless(p); p = p.parentElement) top = p
  return top
}

/** 原文片段就地编辑：contentEditable，完成时重新清洗后写回；点击图片可选中后删除 */
function HtmlEditor({ block, onDone }: { block: Block<'html'>; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const updateProps = useStore((s) => s.updateProps)
  const [picked, setPicked] = useState<Element | null>(null)
  const pick = (el: Element | null) => {
    picked?.classList.remove('media-picked')
    el?.classList.add('media-picked')
    setPicked(el)
  }
  const removePicked = () => {
    picked?.remove()
    setPicked(null)
    commit()
  }
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = block.props.html
    ref.current.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (!ref.current) return
    const html = sanitizeHtml(ref.current.innerHTML, parseDoc)
    if (html !== block.props.html) updateProps(block.id, { html })
  }
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="rich-toolbar">
        <span className="hint" style={{ margin: '0 6px' }}>直接修改文字（保留原样式）；点击图片可选中，按 Delete 删除</span>
        {picked && (
          <button type="button" className="danger" onMouseDown={(e) => (e.preventDefault(), removePicked())} data-testid="delete-picked">
            删除所选图片
          </button>
        )}
        <span className="sep" />
        <button type="button" className="done" onMouseDown={(e) => (e.preventDefault(), commit(), onDone())}>完成</button>
      </div>
      <div
        ref={ref}
        className="html-editor"
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onClick={(e) => pick(ref.current ? mediaFrame(e.target as Element, ref.current) : null)}
        onKeyDown={(e) => {
          if (picked && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault()
            removePicked()
            return
          }
          if (picked) pick(null)
          if (e.key === 'Escape') {
            commit()
            onDone()
          }
        }}
      />
    </div>
  )
}

const RICH_TYPES = new Set(['paragraph', 'card', 'imageText'])

const BlockHtml = memo(function BlockHtml({ block, theme }: { block: Block; theme: Theme }) {
  const html = useMemo(() => compileBlock(block, theme), [block, theme])
  const photos = useMemo(() => blockPhotos(block), [block])
  const ref = useRef<HTMLDivElement>(null)
  // 标记可移动的照片：拖到另一张照片上互换位置；装饰图、二维码不参与
  useEffect(() => {
    ref.current?.querySelectorAll('img').forEach((img, i) => {
      if (photos[i]) {
        img.dataset.photo = String(i)
        img.draggable = true
        img.title = '拖到另一张照片上可交换位置'
      } else img.draggable = false
    })
  }, [html, photos])
  return <div ref={ref} className="block-html" dangerouslySetInnerHTML={{ __html: html }} />
})

const PHOTO_MIME = 'application/x-xiumi-photo'

/** 事件目标所在的可移动照片 */
export function photoTarget(el: EventTarget | Element | null): { img: HTMLImageElement; pos: PhotoPos } | null {
  const img = (el as Element | null)?.closest?.('img[data-photo]') as HTMLImageElement | null
  const block = img?.closest('[data-block-id]') as HTMLElement | null
  return img && block ? { img, pos: { blockId: block.dataset.blockId!, index: Number(img.dataset.photo) } } : null
}

/** 照片在画布上显示的高宽比，即相框比例 */
export const shownRatio = (img: Element | null) => {
  const r = img?.getBoundingClientRect()
  return r && r.width ? r.height / r.width : undefined
}

/** 模块渲染失败时的占位：可删除或撤销，不影响其余模块 */
function BrokenBlock({ block, error }: { block: Block; error: Error }) {
  const { removeBlock, undo } = useStore.getState()
  return (
    <div className="render-error" onClick={(e) => e.stopPropagation()}>
      <b>此「{blockMeta(block.type)?.label ?? block.type}」模块数据异常，无法显示</b>
      <small>{error.message}</small>
      <div className="row gap">
        <button onClick={undo}>撤销上一步</button>
        <button className="danger" onClick={() => removeBlock(block.id)}>删除此模块</button>
      </div>
    </div>
  )
}

function BlockView({ block, theme, gap }: { block: Block; theme: Theme; gap: number }) {
  const selected = useStore((s) => s.selectedId === block.id)
  const editing = useStore((s) => s.editingId === block.id)
  const { select, setEditing, updateProps, removeBlock, duplicateBlock, moveBlock, notify } = useStore.getState()
  const index = useStore((s) => s.doc.blocks.findIndex((b) => b.id === block.id))
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: block.id })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    marginBottom: gap,
    opacity: isDragging ? 0.4 : 1,
  }
  const canRich = RICH_TYPES.has(block.type)
  const canEdit = canRich || block.type === 'html'
  const startEdit = () => canEdit && setEditing(block.id)

  let body = <BlockHtml block={block} theme={theme} />
  if (editing && block.type === 'html') body = <HtmlEditor block={block} onDone={() => setEditing(null)} />
  else if (editing && canRich) {
    const p: any = block.props
    const editor = (
      <Suspense fallback={<BlockHtml block={block} theme={theme} />}>
      <RichEditor
        value={p.content}
        theme={theme}
        fontSize={block.type === 'imageText' ? theme.fontSize - 1 : undefined}
        onChange={(content) => updateProps(block.id, { content }, `${block.id}:content`)}
        onDone={() => setEditing(null)}
      />
      </Suspense>
    )
    // 卡片 / 图文分栏只就地编辑正文，其余部分保持预览
    body =
      block.type === 'paragraph' ? (
        editor
      ) : (
        <>
          <div className="editing-hint">正在编辑「{blockMeta(block.type).label}」正文，标题和图片在右侧面板修改</div>
          {editor}
        </>
      )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`block ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${isOver ? 'over' : ''}`}
      data-block-id={block.id}
      data-block-type={block.type}
      onClick={(e) => {
        e.stopPropagation()
        select(block.id)
      }}
      onDoubleClick={startEdit}
      {...attributes}
      role="group"
      tabIndex={-1}
    >
      {selected && !editing && (
        <div className="block-toolbar" onClick={(e) => e.stopPropagation()}>
          <span className="block-label">{block.type === 'html' ? block.props.label || '原文片段' : blockMeta(block.type).label}</span>
          <button ref={setActivatorNodeRef} {...listeners} className="drag" title="拖动排序">⠿</button>
          <button title="上移" disabled={index === 0} onClick={() => moveBlock(block.id, index - 1)}>↑</button>
          <button title="下移" onClick={() => moveBlock(block.id, index + 1)}>↓</button>
          {canEdit && <button title="编辑文字（双击）" onClick={startEdit}>✎</button>}
          <button title="复制模块" onClick={() => duplicateBlock(block.id)}>⧉</button>
          <button
            title="收藏为模板"
            onClick={async () => {
              const name = prompt('模板名称', block.type === 'html' ? block.props.label : blockMeta(block.type).label)
              if (!name) return
              await api.saveTemplate(name, [block], useStore.getState().doc)
              notify('已收藏到「模板」')
              window.dispatchEvent(new Event('templates-changed'))
            }}
          >
            ☆
          </button>
          <button title="删除（Delete）" className="danger" onClick={() => removeBlock(block.id)}>✕</button>
        </div>
      )}
      {!selected && <button ref={setActivatorNodeRef} {...listeners} className="drag-ghost" title="拖动排序" onClick={(e) => e.stopPropagation()}>⠿</button>}
      <ErrorBoundary resetKey={block} fallback={(error) => <BrokenBlock block={block} error={error} />}>
        {body}
      </ErrorBoundary>
    </div>
  )
}

/** 照片拖放：拖到另一张照片上互换位置，靠近画布上下边缘时自动滚动 */
function usePhotoDrag(scroller: React.RefObject<HTMLDivElement | null>) {
  const over = useRef<HTMLImageElement | null>(null)
  const mark = (img: HTMLImageElement | null) => {
    if (over.current === img) return
    over.current?.classList.remove('photo-drop')
    img?.classList.add('photo-drop')
    over.current = img
  }
  return {
    onDragStart: (e: React.DragEvent) => {
      const t = photoTarget(e.target)
      if (!t) return
      e.dataTransfer.setData(PHOTO_MIME, JSON.stringify(t.pos))
      e.dataTransfer.effectAllowed = 'move'
      t.img.classList.add('photo-dragging')
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PHOTO_MIME)) return
      const box = scroller.current?.getBoundingClientRect()
      if (box && scroller.current) {
        if (e.clientY < box.top + 70) scroller.current.scrollTop -= 18
        else if (e.clientY > box.bottom - 70) scroller.current.scrollTop += 18
      }
      const t = photoTarget(e.target)
      mark(t?.img ?? null)
      if (t) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
    },
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(PHOTO_MIME)
      const t = photoTarget(e.target)
      mark(null)
      if (!raw || !t) return
      e.preventDefault()
      const from = JSON.parse(raw) as PhotoPos
      const fromImg = document.querySelector(`[data-block-id="${from.blockId}"] img[data-photo="${from.index}"]`)
      const s = useStore.getState()
      const next = swapPhotos(s.doc, from, t.pos, { ratioA: shownRatio(fromImg), ratioB: shownRatio(t.img) })
      if (next !== s.doc) {
        s.commit(next)
        s.notify('已交换两张照片的位置（Ctrl+Z 可撤销）')
      }
    },
    onDragEnd: (e: React.DragEvent) => {
      mark(null)
      ;(e.target as Element).classList?.remove('photo-dragging')
    },
  }
}

export function Canvas() {
  const doc = useStore((s) => s.doc)
  const theme = useMemo(() => resolveTheme(doc), [doc.themeId, doc.themeOverrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const select = useStore((s) => s.select)
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-end' })
  const scroller = useRef<HTMLDivElement>(null)
  const photoDrag = usePhotoDrag(scroller)
  return (
    <div className="canvas-scroll" ref={scroller} onClick={() => select(null)} {...photoDrag}>
      <div className="phone">
        <div className="phone-head">
          <div className="wx-title">{doc.title || '未命名推文'}</div>
          <div className="wx-meta">{doc.author || '公众号名称'} · 刚刚</div>
        </div>
        <div className="article" style={styleObj(rootStyle(theme))} data-testid="canvas">
          <SortableContext items={doc.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {doc.blocks.map((b, i) => (
              <BlockView key={b.id} block={b} theme={theme} gap={blockGap(b, doc.blocks[i + 1], theme)} />
            ))}
          </SortableContext>
          <div ref={setNodeRef} className={`drop-end ${isOver ? 'over' : ''}`}>
            {doc.blocks.length ? '拖入模块到此处，或在左侧点击添加' : '从左侧拖入模块，或使用「AI 一键排版」导入文稿'}
          </div>
        </div>
      </div>
    </div>
  )
}
