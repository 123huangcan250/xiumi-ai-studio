// 编辑回放的属性面板：只填内容（文案、图片），场景增删、元素拖拽排序，预设与节奏选择。
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState } from 'react'
import { ITEM_LABEL, ITEM_TYPES, makeItem, makeScene, PRESET_LABEL, PRESETS, sampleReplay, DEFAULT_PRESET } from '../core/replay'
import type { CursorAction, ReplayDoc, ReplayItem, ReplayScene, ReplayStyle } from '../core/replay'
import type { Block, ImageRef } from '../core/types'
import { api, assetRef, type Asset } from './api'
import { useStore } from './store'

type Upd = (patch: Partial<ReplayDoc>, key: string) => void

function Seg<T extends string | number>({ label, value, options, onChange, testId }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; testId?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="seg" data-testid={testId}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </label>
  )
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="rp-color">
      <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
      <span>{label}</span>
    </label>
  )
}

function Num({ label, value, onChange, step = 1, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; placeholder?: string }) {
  return (
    <label className="rp-num">
      <span>{label}</span>
      <input type="number" step={step} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  )
}

/** 素材选择：展开素材库缩略图，点击即选 */
function AssetPick({ value, onPick }: { value?: ImageRef; onPick: (ref?: ImageRef) => void }) {
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  useEffect(() => {
    if (open && !assets) api.assets().then(setAssets, () => setAssets([]))
  }, [open, assets])
  return (
    <div className="rp-asset">
      {value ? <img src={value.src.startsWith('/media/') ? `${value.src.split('?')[0]}?fit=1:1&w=120` : value.src} alt="" /> : <span className="pic-empty">未选图</span>}
      <button type="button" onClick={() => setOpen(!open)} data-testid="rp-pick-image">{open ? '收起' : '从素材选择'}</button>
      {value && <button type="button" onClick={() => onPick(undefined)}>移除</button>}
      {open && (
        <div className="rp-asset-grid">
          {assets === null && <p className="hint">加载中…</p>}
          {assets?.length === 0 && <p className="hint">素材库是空的，先在左侧「素材」上传图片</p>}
          {assets?.map((a) => (
            <img
              key={a.id}
              src={`/media/${a.file}?fit=1:1&w=120`}
              alt={a.name}
              title={a.name}
              onClick={() => {
                onPick(assetRef(a))
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const ACTIONS: [CursorAction | '', string][] = [['', '自动'], ['click', '点击'], ['drag', '拖拽'], ['type', '打字'], ['none', '无光标']]
const TEXT_AREA = new Set(['title', 'text', 'quote', 'subtitle'])
const LABEL_HINT: Partial<Record<ReplayItem['type'], string>> = { stat: '说明文字', quote: '出处', text: '卡片小标题（设置底色后显示）', image: '图注' }

function ItemRow({ item, doc, scene, onChange, onRemove }: { item: ReplayItem; doc: ReplayDoc; scene: ReplayScene; onChange: (it: ReplayItem, key: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<ReplayItem>, key: string) => onChange({ ...item, ...patch }, `${item.id}:${key}`)
  const setStyle = (patch: Partial<ReplayStyle>) => {
    const style = { ...item.style, ...patch }
    for (const k of Object.keys(style) as (keyof ReplayStyle)[]) if (style[k] === undefined) delete style[k]
    set({ style: Object.keys(style).length ? style : undefined }, 'style')
  }
  return (
    <div ref={setNodeRef} className={`rp-item ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }} data-testid="rp-item">
      <div className="rp-item-head">
        <button type="button" ref={setActivatorNodeRef} className="rp-handle" title="拖动排序" {...attributes} {...listeners}>⠿</button>
        <strong>{ITEM_LABEL[item.type]}</strong>
        <select value={item.enter ?? ''} onChange={(e) => set({ enter: (e.target.value || undefined) as ReplayItem['enter'] }, 'enter')} title="进场预设" data-testid="rp-preset">
          <option value="">默认（{PRESET_LABEL[DEFAULT_PRESET[item.type]]}）</option>
          {PRESETS.map((p) => (
            <option key={p} value={p}>{PRESET_LABEL[p]}</option>
          ))}
        </select>
        <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? '收起' : '更多'}</button>
        <button type="button" className="danger" title="删除元素" onClick={onRemove}>✕</button>
      </div>
      {item.type === 'image' ? (
        <AssetPick value={item.image} onPick={(image) => set({ image }, 'image')} />
      ) : item.type === 'shape' ? (
        <div className="seg">
          {(['rect', 'circle', 'ring'] as const).map((s) => (
            <button key={s} type="button" className={item.content === s ? 'on' : ''} onClick={() => set({ content: s }, 'content')}>
              {{ rect: '色条', circle: '圆点', ring: '圆环' }[s]}
            </button>
          ))}
        </div>
      ) : item.type !== 'divider' ? (
        TEXT_AREA.has(item.type) ? (
          <textarea rows={item.type === 'text' ? 3 : 2} value={item.content} onChange={(e) => set({ content: e.target.value }, 'content')} data-testid="rp-content" />
        ) : (
          <input value={item.content} placeholder={item.type === 'stat' ? '数值，如 98%、3.2万' : ''} onChange={(e) => set({ content: e.target.value }, 'content')} data-testid="rp-content" />
        )
      ) : null}
      {LABEL_HINT[item.type] && <input value={item.label ?? ''} placeholder={LABEL_HINT[item.type]} onChange={(e) => set({ label: e.target.value || undefined }, 'label')} />}
      {open && (
        <div className="rp-more">
          <div className="rp-nums">
            <Num label="延迟 s" step={0.05} value={item.delay} onChange={(delay) => set({ delay }, 'delay')} placeholder="0" />
            <label className="rp-num">
              <span>光标</span>
              <select value={item.cursor?.action ?? ''} onChange={(e) => set({ cursor: { ...item.cursor, action: (e.target.value || undefined) as CursorAction | undefined } }, 'cursor')}>
                {ACTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="rp-num">
              <span>由谁</span>
              <select value={item.cursor?.who ?? ''} onChange={(e) => set({ cursor: { ...item.cursor, who: e.target.value === '' ? undefined : Number(e.target.value) } }, 'cursor')}>
                <option value="">自动</option>
                {Array.from({ length: doc.cursors.count }, (_, i) => (
                  <option key={i} value={i}>{doc.cursors.names?.[i] || `光标 ${i + 1}`}</option>
                ))}
              </select>
            </label>
          </div>
          {scene.layout === 'absolute' && (
            <div className="rp-nums">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <Num key={k} label={k.toUpperCase()} value={item.frame?.[k]} onChange={(v) => set({ frame: { x: 56, y: 88, w: 638, ...item.frame, [k]: v } as ReplayItem['frame'] }, 'frame')} />
              ))}
            </div>
          )}
          <div className="rp-colors">
            <Color label="文字色" value={item.style?.color ?? ''} onChange={(color) => setStyle({ color })} />
            <Color label="底色" value={item.style?.fill ?? ''} onChange={(fill) => setStyle({ fill })} />
            <Color label="描边" value={item.style?.stroke ?? ''} onChange={(stroke) => setStyle({ stroke })} />
            <Num label="字号" value={item.style?.fontSize} onChange={(fontSize) => setStyle({ fontSize })} placeholder="默认" />
            {item.style && <button type="button" className="link" onClick={() => set({ style: undefined }, 'style')}>恢复默认样式</button>}
          </div>
        </div>
      )}
    </div>
  )
}

export function ReplayPanel({ block }: { block: Block<'replay'> }) {
  const updateProps = useStore((s) => s.updateProps)
  const doc = block.props
  const upd: Upd = (patch, key) => updateProps(block.id, patch, `${block.id}:${key}`)
  const [sceneIdx, setSceneIdx] = useState(0)
  const si = Math.min(sceneIdx, doc.scenes.length - 1)
  const scene = doc.scenes[si]
  const setScene = (s: ReplayScene, key: string) => upd({ scenes: doc.scenes.map((x, i) => (i === si ? s : x)) }, `scene${si}:${key}`)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = scene.items.findIndex((x) => x.id === e.active.id)
    const to = scene.items.findIndex((x) => x.id === e.over!.id)
    if (from >= 0 && to >= 0) setScene({ ...scene, items: arrayMove(scene.items, from, to) }, 'order')
  }
  const bg = doc.canvas.background
  const setBg = (patch: Partial<typeof bg>) => upd({ canvas: { ...doc.canvas, background: { ...bg, ...patch } } }, 'bg')

  return (
    <div className="replay-panel">
      <div className="row gap">
        <button className="primary" onClick={() => window.dispatchEvent(new CustomEvent('open-replay', { detail: { id: block.id } }))} data-testid="rp-preview">▶ 预览动效</button>
        <button
          onClick={() => {
            if (confirm('用示例模板（深色赛博蓝图风，两个场景）替换当前内容？可以撤销。')) {
              upd(sampleReplay(), 'sample')
              setSceneIdx(0)
            }
          }}
          data-testid="rp-sample"
        >
          载入示例
        </button>
      </div>

      <h5>播放</h5>
      <Seg label="触发方式" value={doc.playback.trigger} options={[['auto', '自动播放（推荐）'], ['tap', '点击开始（依赖 id，待验证）']]} onChange={(trigger) => upd({ playback: { ...doc.playback, trigger } }, 'trigger')} testId="rp-trigger" />
      <Seg label="节奏" value={doc.playback.pace} options={[['normal', '舒缓'], ['fast', '快'], ['turbo', '极速']]} onChange={(pace) => upd({ playback: { ...doc.playback, pace } }, 'pace')} testId="rp-pace" />
      <label className="check">
        <input type="checkbox" checked={!!doc.playback.loop} onChange={(e) => upd({ playback: { ...doc.playback, loop: e.target.checked ? { hold: 2 } : undefined } }, 'loop')} />
        <span>循环播放：播完停留</span>
        {doc.playback.loop && <input className="rp-inline-num" type="number" min={0} step={0.5} value={doc.playback.loop.hold} onChange={(e) => upd({ playback: { ...doc.playback, loop: { hold: Math.max(0, Number(e.target.value) || 0) } } }, 'hold')} />}
        {doc.playback.loop && <span>秒后重放</span>}
      </label>
      <Seg label="文字输出" value={doc.textMode} options={[['image', '栅格图片（最稳，推荐）'], ['svg-text', 'SVG 文字']]} onChange={(textMode) => upd({ textMode }, 'textMode')} />

      <h5>背景板</h5>
      <Seg label="类型" value={bg.type} options={[['color', '纯色'], ['gradient', '渐变'], ['image', '背景图']]} onChange={(type) => setBg({ type, value: type === 'gradient' ? (bg.value.includes(',') ? bg.value : `${bg.value},#0d2a52`) : bg.value.split(',')[0] })} />
      {bg.type === 'color' && <div className="rp-colors"><Color label="背景色" value={bg.value} onChange={(value) => setBg({ value })} /></div>}
      {bg.type === 'gradient' && (
        <div className="rp-colors">
          {bg.value.split(',').map((c, i, all) => (
            <Color key={i} label={i === 0 ? '上' : i === all.length - 1 ? '下' : '中'} value={c} onChange={(v) => setBg({ value: all.map((x, j) => (j === i ? v : x)).join(',') })} />
          ))}
        </div>
      )}
      {bg.type === 'image' && <AssetPick value={bg.image} onPick={(image) => setBg({ image })} />}
      <label className="check">
        <input type="checkbox" checked={!!bg.grid} onChange={(e) => setBg({ grid: e.target.checked ? { color: '#123a66', size: 50 } : undefined })} />
        <span>蓝图网格</span>
      </label>
      {bg.grid && (
        <div className="rp-colors">
          <Color label="网格色" value={bg.grid.color} onChange={(color) => setBg({ grid: { ...bg.grid!, color } })} />
          <Num label="间距" value={bg.grid.size} onChange={(size) => setBg({ grid: { ...bg.grid!, size: Math.max(10, size ?? 50) } })} />
        </div>
      )}

      <h5>配色与光标</h5>
      <div className="rp-colors">
        <Color label="强调色" value={doc.theme.accent} onChange={(accent) => upd({ theme: { ...doc.theme, accent } }, 'accent')} />
        <Color label="线框色" value={doc.theme.inspector} onChange={(inspector) => upd({ theme: { ...doc.theme, inspector } }, 'inspector')} />
        <Color label="警示色" value={doc.theme.alert} onChange={(alert) => upd({ theme: { ...doc.theme, alert } }, 'alert')} />
        <Color label="文字色" value={doc.theme.text} onChange={(text) => upd({ theme: { ...doc.theme, text } }, 'text')} />
      </div>
      <label className="check">
        <input type="checkbox" checked={doc.cursors.show} onChange={(e) => upd({ cursors: { ...doc.cursors, show: e.target.checked } }, 'cursors')} data-testid="rp-show-cursors" />
        <span>显示光标层</span>
      </label>
      <Seg label="光标数量" value={doc.cursors.count} options={[1, 2, 3, 4, 5, 6].map((n) => [n, String(n)] as [number, string])} onChange={(count) => upd({ cursors: { ...doc.cursors, count } }, 'cursors')} />
      <label className="field">
        <span>光标名字（逗号分隔，可留空）</span>
        <input
          value={(doc.cursors.names ?? []).join('，')}
          onChange={(e) => {
            const names = e.target.value.split(/[,，]/).map((s) => s.trim())
            upd({ cursors: { ...doc.cursors, names: names.some(Boolean) ? names : undefined } }, 'names')
          }}
        />
      </label>
      <div className="rp-colors">
        {doc.theme.cursorPalette.slice(0, doc.cursors.count).map((c, i) => (
          <Color key={i} label={doc.cursors.names?.[i] || `光标 ${i + 1}`} value={c} onChange={(v) => upd({ theme: { ...doc.theme, cursorPalette: doc.theme.cursorPalette.map((x, j) => (j === i ? v : x)) } }, 'palette')} />
        ))}
      </div>

      <h5>体积预算</h5>
      <div className="rp-nums">
        <Num label="单场景 KB" value={doc.budget.sceneKB} onChange={(sceneKB) => upd({ budget: { ...doc.budget, sceneKB: sceneKB ?? 80 } }, 'budget')} />
        <Num label="整体 KB" value={doc.budget.totalKB} onChange={(totalKB) => upd({ budget: { ...doc.budget, totalKB: totalKB ?? 400 } }, 'budget')} />
      </div>
      <p className="hint">预算是估计值，公众号后台的真实上限待实测（见 docs/edit-replay/COMPAT.md）。</p>

      <h5>场景</h5>
      <div className="seg rp-scenes">
        {doc.scenes.map((_, i) => (
          <button key={i} type="button" className={i === si ? 'on' : ''} onClick={() => setSceneIdx(i)} data-testid="rp-scene-tab">
            场景 {i + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            upd({ scenes: [...doc.scenes, makeScene([makeItem('title'), makeItem('text')])] }, 'add-scene')
            setSceneIdx(doc.scenes.length)
          }}
          data-testid="rp-add-scene"
        >
          ＋
        </button>
      </div>
      <Seg label="排版" value={scene.layout} options={[['flow', '自动排版'], ['absolute', '自由定位']]} onChange={(layout) => setScene({ ...scene, layout }, 'layout')} />
      <Seg label="收尾" value={scene.finale} options={[['exit', '光标各自离场'], ['swarm', '聚拢绕圈后散开']]} onChange={(finale) => setScene({ ...scene, finale }, 'finale')} />
      <div className="rp-nums">
        <Num label="场景高度" value={scene.height} placeholder="自动" onChange={(height) => setScene({ ...scene, height }, 'height')} />
        {doc.scenes.length > 1 && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              upd({ scenes: doc.scenes.filter((_, i) => i !== si) }, 'remove-scene')
              setSceneIdx(Math.max(0, si - 1))
            }}
          >
            删除此场景
          </button>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={scene.items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <div className="rp-items">
            {scene.items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                doc={doc}
                scene={scene}
                onChange={(next, key) => setScene({ ...scene, items: scene.items.map((x) => (x.id === it.id ? next : x)) }, key)}
                onRemove={() => setScene({ ...scene, items: scene.items.filter((x) => x.id !== it.id) }, 'remove')}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="rp-add">
        {ITEM_TYPES.map((t) => (
          <button key={t} type="button" onClick={() => setScene({ ...scene, items: [...scene.items, makeItem(t)] }, 'add')} data-testid={`rp-add-${t}`}>
            ＋{ITEM_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  )
}
