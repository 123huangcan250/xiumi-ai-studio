import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { lazy, memo, Suspense, useEffect, useMemo, useRef } from 'react'
import { blockMeta } from '../core/blocks'
import { blockGap, compileBlock, rootStyle } from '../core/compiler'
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

/** 原文片段就地编辑：contentEditable，完成时重新清洗后写回 */
function HtmlEditor({ block, onDone }: { block: Block<'html'>; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const updateProps = useStore((s) => s.updateProps)
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
        <span className="hint" style={{ margin: '0 6px' }}>直接修改文字（保留原样式）；图片在右侧面板替换</span>
        <span className="sep" />
        <button type="button" className="done" onMouseDown={(e) => (e.preventDefault(), commit(), onDone())}>完成</button>
      </div>
      <div
        ref={ref}
        className="html-editor"
        contentEditable
        suppressContentEditableWarning
        onBlur={commit}
        onKeyDown={(e) => {
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
  return <div className="block-html" dangerouslySetInnerHTML={{ __html: html }} />
})

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
              await api.saveTemplate(name, [block])
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

export function Canvas() {
  const doc = useStore((s) => s.doc)
  const theme = useMemo(() => resolveTheme(doc), [doc.themeId, doc.themeOverrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const select = useStore((s) => s.select)
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-end' })
  return (
    <div className="canvas-scroll" onClick={() => select(null)}>
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
