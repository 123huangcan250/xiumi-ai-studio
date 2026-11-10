import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blockTextFields } from '../core/blockTextEditing'
import { BlockTextEditor } from './BlockTextEditor'
import { blockLabel, blockMeta } from '../core/blocks'
import { BOX_GAP, blockGap, compileBlock, rootStyle } from '../core/compiler'
import { expandPick, fragmentHtml, insertionAnchor, pickElement, placeFragment } from '../core/fragments'
import { displayHtml, storedHtml } from '../core/images'
import { blockPhotos, swapPhotos, type PhotoPos } from '../core/photos'
import { sanitizeHtml } from '../core/sanitize'
import { splitHtmlBlock } from '../core/wxImport'
import { boxParts, boxTheme } from '../core/kit'
import { resolveTheme } from '../core/themes'
import { findBlock } from '../core/tree'
import type { Block, Theme } from '../core/types'
import { api } from './api'
import { clampZoom, wheelFactor, ZOOM_MAX, ZOOM_MIN } from './zoom'
import { openCollect, setInlineTarget } from './componentActions'
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
    ref.current.innerHTML = displayHtml(block.props.html)
    ref.current.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (!ref.current) return
    const html = sanitizeHtml(storedHtml(ref.current.innerHTML), parseDoc)
    if (html !== block.props.html) updateProps(block.id, { html })
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  // 记住光标：点组件库时焦点会离开这里，组件插到最后一次光标所在的段落后面
  const caret = useRef<Node | null>(null)
  useEffect(() => {
    const save = () => {
      const sel = document.getSelection()
      if (sel?.rangeCount && ref.current?.contains(sel.anchorNode) && sel.anchorNode !== ref.current) caret.current = sel.anchorNode
    }
    document.addEventListener('selectionchange', save)
    const off = setInlineTarget((html) => {
      const root = ref.current
      const anchor = root && caret.current?.isConnected ? insertionAnchor(caret.current, root) : null
      if (!root || !anchor) return false
      root.querySelectorAll('.media-picked').forEach((el) => el.classList.remove('media-picked'))
      const added = placeFragment(anchor, root, displayHtml(html))
      if (!added.length) return false
      commitRef.current()
      caret.current = added[added.length - 1]
      added[0].scrollIntoView({ block: 'nearest' })
      return true
    })
    return () => {
      document.removeEventListener('selectionchange', save)
      off()
    }
  }, [])
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="rich-toolbar">
        <span className="hint" style={{ margin: '0 6px' }}>直接修改文字（保留原样式）；点击图片可选中，按 Delete 删除；点组件库里的组件会插到光标所在段落后面</span>
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

/** 在原文片段里点选一个版块收藏为组件：点击选中，可向外扩大；图片和动效不响应编辑 */
function FragmentPicker({ block, theme, onDone }: { block: Block<'html'>; theme: Theme; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [picked, setPicked] = useState<Element | null>(null)
  const inner = useRef<Element[]>([])
  const hovered = useRef<Element | null>(null)
  const html = useMemo(() => displayHtml(compileBlock(block, theme)), [block, theme])
  const mark = (el: Element | null) => {
    picked?.classList.remove('fragment-picked')
    el?.classList.add('fragment-picked')
    setPicked(el)
  }
  const hover = (el: Element | null) => {
    if (hovered.current === el) return
    hovered.current?.classList.remove('fragment-hover')
    el?.classList.add('fragment-hover')
    hovered.current = el
  }
  const expand = () => {
    const up = picked && ref.current ? expandPick(picked, ref.current) : null
    if (!up || !picked) return
    inner.current.push(picked)
    mark(up)
  }
  const shrink = () => {
    const el = inner.current.pop()
    if (el) mark(el)
  }
  const collect = () => {
    if (!picked || !ref.current) return
    picked.classList.remove('fragment-picked', 'fragment-hover')
    const fragment = sanitizeHtml(storedHtml(fragmentHtml(picked, ref.current)), parseDoc)
    onDone()
    openCollect({ block, fragment, via: 'fragment' })
  }
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="rich-toolbar pick-toolbar">
        <span className="hint" style={{ margin: '0 6px' }}>{picked ? '已选中，可向外扩大范围' : '点击要收藏的版块'}</span>
        <span className="sep" />
        <button type="button" disabled={!picked} onClick={expand} data-testid="pick-expand">向外一层</button>
        <button type="button" disabled={!inner.current.length} onClick={shrink} data-testid="pick-shrink">向内一层</button>
        <button type="button" className="primary" disabled={!picked} onClick={collect} data-testid="pick-collect">收藏所选</button>
        <button type="button" className="done" onClick={onDone} data-testid="pick-cancel">取消</button>
      </div>
      <div
        ref={ref}
        className="block-html picking"
        dangerouslySetInnerHTML={{ __html: html }}
        onMouseOver={(e) => hover(ref.current ? pickElement(e.target as Element, ref.current) : null)}
        onMouseLeave={() => hover(null)}
        onClick={(e) => {
          e.preventDefault()
          inner.current = []
          mark(ref.current ? pickElement(e.target as Element, ref.current) : null)
        }}
        data-testid="fragment-picker"
      />
    </div>
  )
}

const RICH_TYPES = new Set(['paragraph', 'card', 'imageText'])

const BlockHtml = memo(function BlockHtml({ block, theme, inBox }: { block: Block; theme: Theme; inBox?: boolean }) {
  // 画布显示空图片位、空图注的占位；文本框内的模块按文本框样式自适应
  const html = useMemo(() => displayHtml(compileBlock(block, theme, { hints: true, inBox })), [block, theme, inBox])
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

/** 事件目标所在的空图片位（套件模块的占位图） */
export function slotTarget(el: EventTarget | Element | null): { img: HTMLImageElement; pos: PhotoPos } | null {
  const img = (el as Element | null)?.closest?.('img[data-slot]') as HTMLImageElement | null
  const block = img?.closest('[data-block-id]') as HTMLElement | null
  return img && block ? { img, pos: { blockId: block.dataset.blockId!, index: Number(img.dataset.slot) } } : null
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

/** 大型文本框：页眉、页脚按编译结果显示，内容区里的子模块可以单独选中、拖动、编辑 */
function BoxBody({ block, theme }: { block: Block<'box'>; theme: Theme }) {
  const { title, label, variant, children } = block.props
  const parts = useMemo(() => boxParts({ title, label, variant, children: [] }), [title, label, variant])
  const { setNodeRef, isOver } = useDroppable({ id: `box:${block.id}`, data: { parentId: block.id } })
  return (
    <div style={styleObj(parts.outer)}>
      <div className="block-html" dangerouslySetInnerHTML={{ __html: parts.header }} />
      <div style={styleObj(parts.body)} className="box-body">
        <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {children.map((c, i) => (
            <BlockView key={c.id} block={c} theme={theme} gap={i === children.length - 1 ? 0 : BOX_GAP} parentId={block.id} />
          ))}
        </SortableContext>
        <div ref={setNodeRef} className={`box-drop ${isOver ? 'over' : ''} ${children.length ? '' : 'empty'}`} data-testid="box-drop">
          {children.length ? '放进文本框末尾' : '文本框是空的：把模块拖到这里，或选中文本框后点击左侧模块'}
        </div>
      </div>
      <div className="block-html" dangerouslySetInnerHTML={{ __html: parts.footer }} />
    </div>
  )
}

function BlockView({ block, theme, gap, parentId }: { block: Block; theme: Theme; gap: number; parentId?: string }) {
  const selected = useStore((s) => s.selectedId === block.id)
  const editing = useStore((s) => s.editingId === block.id)
  const picking = useStore((s) => s.pickingId === block.id)
  const { select, setEditing, setPicking, updateProps, removeBlock, replaceBlock, duplicateBlock, moveBlock, moveBlockTo, notify } = useStore.getState()
  // 在所在层（顶层或文本框内）的位置
  const index = useStore((s) => findBlock(s.doc.blocks, block.id)?.index ?? -1)
  const inBox = !!parentId
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: block.id, data: { parentId: parentId ?? null } })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    marginBottom: gap,
    opacity: isDragging ? 0.4 : 1,
  }
  const canRich = RICH_TYPES.has(block.type)
  const canText = blockTextFields(block).length > 0
  const canEdit = canRich || block.type === 'html' || canText
  const startEdit = () => canEdit && setEditing(block.id)
  // 以前导入的版块常把整节内容（标题、正文、轮播）放在一个模块里，拆开后才能单独选中和收藏
  const splitBlock = () => {
    if (block.type !== 'html') return
    const parts = splitHtmlBlock(block, parseDoc)
    if (!parts) return notify('这个模块里没有可以拆开的结构')
    replaceBlock(block.id, parts)
    notify(`已拆成 ${parts.length} 个模块，可撤销`)
  }

  let body = block.type === 'box' ? <BoxBody block={block} theme={theme} /> : <BlockHtml block={block} theme={theme} inBox={inBox} />
  if (picking && block.type === 'html') body = <FragmentPicker block={block} theme={theme} onDone={() => setPicking(null)} />
  else if (editing && block.type === 'html') body = <HtmlEditor block={block} onDone={() => setEditing(null)} />
  else if (editing && canText) {
    body = <>{body}<BlockTextEditor block={block} onChange={(props, field) => updateProps(block.id, props, `${block.id}:${field}`)} onDone={() => setEditing(null)} /></>
  }
  else if (editing && canRich) {
    const p: any = block.props
    const editor = (
      <Suspense fallback={<BlockHtml block={block} theme={theme} inBox={inBox} />}>
      <RichEditor
        value={p.content}
        theme={inBox ? boxTheme(theme) : theme}
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
      onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
      {...attributes}
      role="group"
      tabIndex={-1}
    >
      {selected && !editing && !picking && (
        <div className="block-toolbar" onClick={(e) => e.stopPropagation()}>
          <span className="block-label">{blockLabel(block)}</span>
          <button ref={setActivatorNodeRef} {...listeners} className="drag" title="拖动排序">⠿</button>
          <button title="上移" disabled={index === 0} onClick={() => moveBlock(block.id, index - 1)}>↑</button>
          <button title="下移" onClick={() => moveBlock(block.id, index + 1)}>↓</button>
          {parentId && (
            <button
              title="移出文本框（放到文本框下方）"
              onClick={() => {
                const { doc } = useStore.getState()
                moveBlockTo(block.id, null, doc.blocks.findIndex((b) => b.id === parentId) + 1)
              }}
              data-testid="move-out"
            >
              ⇱
            </button>
          )}
          {canEdit && <button title="编辑文字（双击）" onClick={startEdit}>✎</button>}
          <button title="复制模块" onClick={() => duplicateBlock(block.id)}>⧉</button>
          <button title="收藏为组件" onClick={() => openCollect({ block, via: 'block' })} data-testid="collect-block">◈</button>
          {block.type === 'html' && <button title="在模块里点选一部分收藏为组件" onClick={() => setPicking(block.id)} data-testid="pick-fragment">⌖</button>}
          {block.type === 'html' && <button title="拆开此模块：把卡片里的标题、正文、轮播拆成独立模块" onClick={splitBlock} data-testid="split-block">✂</button>}
          <button
            title="收藏为模板"
            onClick={async () => {
              const name = prompt('模板名称', blockLabel(block))
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

const ZOOM_KEY = 'xiumi-canvas-zoom'
/**
 * 只缩放中间的文章：Ctrl + 滚轮 / 触控板捏合、Ctrl + 加减号和 0 都改画布的缩放，不再缩放整个界面。
 * 缩放比例记在本机浏览器里。
 */
function useCanvasZoom() {
  const [zoom, setZoomState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY))
      return v ? clampZoom(v) : 1
    } catch {
      return 1
    }
  })
  const setZoom = useCallback((to: number | ((z: number) => number)) => {
    setZoomState((z) => {
      const next = clampZoom(typeof to === 'function' ? to(z) : to)
      try {
        localStorage.setItem(ZOOM_KEY, String(next))
      } catch {
        /* 拿不到本地存储时只是不记住 */
      }
      return next
    })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '=' || e.key === '+') setZoom((z) => z + 0.1)
      else if (e.key === '-' || e.key === '_') setZoom((z) => z - 0.1)
      else if (e.key === '0') setZoom(1)
      else return
      e.preventDefault()
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => z * wheelFactor(e.deltaY))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [setZoom])
  return [zoom, setZoom] as const
}

export function Canvas() {
  const doc = useStore((s) => s.doc)
  const theme = useMemo(() => resolveTheme(doc), [doc.themeId, doc.themeOverrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const select = useStore((s) => s.select)
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-end' })
  const scroller = useRef<HTMLDivElement>(null)
  const photoDrag = usePhotoDrag(scroller)
  const [zoom, setZoom] = useCanvasZoom()
  return (
    <div className="canvas-wrap">
      <div className="canvas-scroll" ref={scroller} onClick={() => select(null)} {...photoDrag}>
        <div className="phone" style={zoom === 1 ? undefined : { zoom }} data-zoom={zoom}>
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
      <div className={`zoom-bar ${zoom === 1 ? '' : 'on'}`} role="group" aria-label="文章缩放">
        <button title="缩小（Ctrl + 滚轮向下 / Ctrl + -）" onClick={() => setZoom((z) => z - 0.1)} disabled={zoom <= ZOOM_MIN} data-testid="zoom-out">−</button>
        <button className="zoom-val" title="恢复 100%（Ctrl + 0）" onClick={() => setZoom(1)} data-testid="zoom-reset">{Math.round(zoom * 100)}%</button>
        <button title="放大（Ctrl + 滚轮向上 / Ctrl + +）" onClick={() => setZoom((z) => z + 0.1)} disabled={zoom >= ZOOM_MAX} data-testid="zoom-in">＋</button>
      </div>
    </div>
  )
}
