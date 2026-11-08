// 组件库面板：已收藏的组件和模板里可挑选的部件。可检索、按类别和色系筛选，点击或拖入画布。
import { useDraggable } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blockMeta } from '../core/blocks'
import { compileBlock } from '../core/compiler'
import { fingerprint, HUE_FAMILIES, KIND_LABEL, searchComponents, SOURCE_LABEL, type HueFamily, type LibraryComponent } from '../core/components'
import { displayHtml } from '../core/images'
import { buildCatalog, type Part, type PartKind } from '../core/templateFill'
import { resolveTheme } from '../core/themes'
import type { Block, Doc } from '../core/types'
import { api, type Template } from './api'
import { insertComponent, openCollect, parseDoc } from './componentActions'
import { useStore } from './store'

/** 进入可视区才渲染预览：组件可能很大（含 SVG 轮播），离开可视区就卸载 */
function LazyPreview({ block, doc }: { block: Block; doc: Doc }) {
  const box = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setShown(e.isIntersecting), { rootMargin: '100px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [])
  const html = useMemo(() => {
    if (!shown) return ''
    try {
      return displayHtml(compileBlock(block, resolveTheme(doc)))
    } catch {
      return ''
    }
  }, [shown, block, doc])
  return (
    <div className="comp-preview" ref={box}>
      <div className="comp-inner" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function ComponentCard({ c, doc, onChanged }: { c: LibraryComponent; doc: Doc; onChanged: () => void }) {
  const notify = useStore((s) => s.notify)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [tags, setTags] = useState(c.tags.join(' '))
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `comp:${c.id}`, data: { block: c.block, missing: c.missing, label: c.name } })
  const photos = c.stats.photos + c.stats.bgPhotos
  return (
    <div className="comp-card" data-testid="component-card">
      <div ref={setNodeRef} {...listeners} {...attributes} onClick={() => insertComponent(c.block, { missing: c.missing })} title="点击插入到选中位置之后（正在编辑原文模块时插到光标处），或拖入画布" data-testid="component-insert">
        <LazyPreview block={c.block} doc={doc} />
      </div>
      {editing ? (
        <div className="comp-edit">
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="component-name" />
          <input value={tags} placeholder="标签，空格分隔" onChange={(e) => setTags(e.target.value)} data-testid="component-tags" />
          <div className="tpl-actions">
            <button onClick={() => setEditing(false)}>取消</button>
            <button
              className="accent"
              data-testid="component-edit-save"
              onClick={async () => {
                await api.updateComponent(c.id, { name, tags: tags.split(/[\s,，、]+/) })
                setEditing(false)
                onChanged()
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="comp-info">
            <b title={c.name}>{c.name}</b>
            <small>
              {KIND_LABEL[c.kind]} · {c.stats.texts} 处文字 · {photos} 张图
              {c.origin.kind !== 'original' && ` · ${SOURCE_LABEL[c.origin.kind]}`}
            </small>
            {c.tags.length > 0 && <small className="comp-tags">{c.tags.map((t) => `#${t}`).join(' ')}</small>}
            {!!c.missing?.length && <small className="comp-warn" data-testid="component-missing">缺 {c.missing.length} 张图片</small>}
            {c.fixedDecor > 0 && <small title="含 PNG、GIF 或纹理图片，这些部分不能改色">{c.fixedDecor} 处图片装饰，不能改色</small>}
          </div>
          <div className="tpl-actions">
            <button onClick={() => setEditing(true)} data-testid="component-edit">编辑</button>
            <button
              className="danger"
              data-testid="component-delete"
              onClick={async () => {
                if (!confirm(`删除组件「${c.name}」？已插入文档的内容不受影响。`)) return
                await api.deleteComponent(c.id)
                onChanged()
                notify('已删除组件')
              }}
            >
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface VirtualPart extends Part {
  fingerprint: string
  name: string
  text: string
}

function PartCard({ p, doc, collected }: { p: VirtualPart; doc: Doc; collected: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `comp:${p.id}:${p.fingerprint}`, data: { block: p.block, label: p.name } })
  const source = p.block.type === 'html' ? p.block.props.source : undefined
  return (
    <div className="comp-card" data-testid="part-card">
      <div ref={setNodeRef} {...listeners} {...attributes} onClick={() => insertComponent(p.block)} title="点击插入到选中位置之后（正在编辑原文模块时插到光标处），或拖入画布" data-testid="part-insert">
        <LazyPreview block={p.block} doc={doc} />
      </div>
      <div className="comp-info">
        <b title={p.name}>{p.name}</b>
        <small>{KIND_LABEL[p.kind]} · {p.texts.length} 处文字 · {p.photos} 张图 · {p.from}</small>
      </div>
      <div className="tpl-actions">
        {collected ? (
          <small className="comp-done">已收藏</small>
        ) : (
          <button className="accent" onClick={() => openCollect({ block: p.block, via: 'template', source: source ?? { title: p.from } })} data-testid="part-collect">
            收藏 / 拆分
          </button>
        )}
      </div>
    </div>
  )
}

const KINDS = Object.keys(KIND_LABEL) as PartKind[]

export function ComponentLibrary({ templates }: { templates: Template[] }) {
  const doc = useStore((s) => s.doc)
  const notify = useStore((s) => s.notify)
  const matchColors = useStore((s) => s.matchColors)
  const setMatchColors = useStore((s) => s.setMatchColors)
  const [list, setList] = useState<LibraryComponent[]>([])
  const [view, setView] = useState<'saved' | 'parts'>('saved')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<PartKind | ''>('')
  const [hue, setHue] = useState<HueFamily | ''>('')
  const refresh = useCallback(() => api.components().then(setList).catch((e) => notify(e.message, 'error')), [notify])
  useEffect(() => {
    refresh()
    window.addEventListener('components-changed', refresh)
    window.addEventListener('assets-changed', refresh)
    return () => {
      window.removeEventListener('components-changed', refresh)
      window.removeEventListener('assets-changed', refresh)
    }
  }, [refresh])

  const parts = useMemo<VirtualPart[]>(() => {
    if (view !== 'parts') return []
    // 模板不改动，这里把部件当作虚拟组件读取；内置模块在「模块」面板里，不重复列出
    return buildCatalog(templates, { parse: parseDoc })
      .filter((p) => !p.id.startsWith('b:'))
      .map((p) => {
        const label = p.block.type === 'html' ? p.block.props.label : blockMeta(p.block.type).label
        return { ...p, name: label || KIND_LABEL[p.kind], fingerprint: fingerprint(p.block, parseDoc), text: p.texts.map((t) => t.text).join(' ').slice(0, 300) }
      })
  }, [view, templates])

  const shown = useMemo(() => searchComponents(list, { text, kind, hue }), [list, text, kind, hue])
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const shownParts = parts.filter((p) => (!kind || p.kind === kind) && words.every((w) => `${p.name} ${p.from} ${p.text}`.toLowerCase().includes(w)))
  const collected = useMemo(() => new Set(list.map((c) => c.fingerprint)), [list])

  return (
    <>
      <nav className="seg comp-views">
        <button className={view === 'saved' ? 'on' : ''} onClick={() => setView('saved')} data-testid="components-saved">已收藏 {list.length}</button>
        <button className={view === 'parts' ? 'on' : ''} onClick={() => setView('parts')} data-testid="components-parts">从模板挑选</button>
      </nav>
      <input className="comp-search" value={text} placeholder="搜索名称、标签、文字、来源" onChange={(e) => setText(e.target.value)} data-testid="component-search" />
      <div className="comp-chips">
        <button className={kind === '' ? 'on' : ''} onClick={() => setKind('')}>全部</button>
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(kind === k ? '' : k)} data-testid={`kind-${k}`}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      {view === 'saved' && (
        <div className="comp-hues">
          {HUE_FAMILIES.map((h) => (
            <button key={h.id} className={hue === h.id ? 'on' : ''} style={{ background: h.color }} title={`主色：${h.label}`} aria-label={`主色：${h.label}`} onClick={() => setHue(hue === h.id ? '' : h.id)} data-testid={`hue-${h.id}`} />
          ))}
        </div>
      )}
      <label className="check comp-match">
        <input type="checkbox" checked={matchColors} onChange={(e) => setMatchColors(e.target.checked)} data-testid="match-on-insert" />
        插入时匹配本文配色
      </label>
      {view === 'saved' ? (
        <>
          <p className="hint">在画布选中模块后点 ◈ 收藏，点 ⌖ 可只收藏其中一部分。点击组件插入，也可拖入画布。组件只存在本机。</p>
          {shown.map((c) => <ComponentCard key={c.id} c={c} doc={doc} onChanged={refresh} />)}
          {!shown.length && <p className="empty">{list.length ? '没有符合条件的组件' : '还没有收藏组件'}</p>}
        </>
      ) : (
        <>
          <p className="hint">这些是已收藏模板里的版块，可以直接插入。「收藏 / 拆分」把版块或其中一部分存入组件库。</p>
          {shownParts.map((p) => <PartCard key={`${p.from}:${p.id}`} p={p} doc={doc} collected={collected.has(p.fingerprint)} />)}
          {!shownParts.length && <p className="empty">{templates.length ? '没有符合条件的部件' : '还没有收藏模板'}</p>}
        </>
      )}
    </>
  )
}
