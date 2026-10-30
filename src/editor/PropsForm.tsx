import { useEffect, useMemo, useState } from 'react'
import { blockMeta } from '../core/blocks'
import { sanitizeHtml } from '../core/sanitize'
import { setPhoto } from '../core/photos'
import { cleanText, extractSlots, fillSlots, removeBackgroundPhotos, removeImage, type SlotRole, type TextSlot } from '../core/slots'
import { richToPlain, textToRich } from '../core/richtext'
import type { Block, ImageRef } from '../core/types'
import { api, type Asset } from './api'
import { shownRatio } from './Canvas'
import { useStore } from './store'

type Upd = (props: Record<string, any>, field: string) => void

function Text({ label, value, onChange, area }: { label: string; value: string; onChange: (v: string) => void; area?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      {area ? <textarea value={value} rows={4} onChange={(e) => onChange(e.target.value)} /> : <input value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  )
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="seg">
        {options.map(([v, l]) => (
          <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </label>
  )
}

function ImageField({ label, value, onChange }: { label: string; value?: ImageRef; onChange: (v?: ImageRef) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      {value ? (
        <div className="img-field">
          <img src={value.src.startsWith('/media/') ? `${value.src}?w=240` : value.src} alt="" />
          <button onClick={() => onChange(undefined)}>移除</button>
        </div>
      ) : (
        <p className="hint">在左侧「素材」中点击图片即可设置</p>
      )}
    </div>
  )
}

/** 富文本字段在表单里以纯文本编辑（保留段落）；需要格式时双击画布就地编辑 */
function RichField({ label, value, onChange }: { label: string; value: any; onChange: (v: any) => void }) {
  return (
    <label className="field">
      <span>{label}<small>（双击画布可富文本编辑）</small></span>
      <BufferedArea
        rows={6}
        value={richToPlain(value)}
        onCommit={(t) => {
          const rich = textToRich(t)
          onChange(rich)
          return richToPlain(rich)
        }}
      />
    </label>
  )
}

/**
 * 带本地缓冲的多行输入：解析后的值写回文档，输入框保留原始文本（否则空行、行尾换行会被吞掉）。
 * 外部值变化（撤销、AI 修改）时才用外部值覆盖。
 */
function BufferedArea({ value, onCommit, rows }: { value: string; onCommit: (text: string) => string; rows: number }) {
  const [text, setText] = useState(value)
  const [sent, setSent] = useState(value)
  if (value !== sent) {
    setSent(value)
    setText(value)
  }
  return (
    <textarea
      rows={rows}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        setSent(onCommit(e.target.value))
      }}
    />
  )
}

const parseDoc = (s: string) => new DOMParser().parseFromString(s, 'text/html')
const ROLE_LABEL: Record<SlotRole, string> = { title: '标题', body: '正文', caption: '小字', label: '标签', number: '序号' }

/** 原文片段：按槽位改字、替换图片、编辑源码 */
function HtmlFields({ blockId, html, upd }: { blockId: string; html: string; upd: Upd }) {
  const [picking, setPicking] = useState(-1)
  const [assets, setAssets] = useState<Asset[]>([])
  const [source, setSource] = useState(html)
  const [srcOpen, setSrcOpen] = useState(false)
  useEffect(() => setSource(html), [html])
  useEffect(() => {
    if (picking >= 0 && !assets.length) api.assets().then(setAssets).catch(() => {})
  }, [picking, assets.length])
  const slots = useMemo(() => extractSlots(html, parseDoc), [html])
  const texts = slots.filter((s): s is TextSlot => s.kind === 'text')
  const imgs = slots.filter((s) => s.kind === 'image').map((s) => s.src)
  const bgPhotos = useMemo(() => removeBackgroundPhotos(html, parseDoc).removed, [html])
  const replace = (i: number, src: string) => {
    // 按原相框比例裁切新照片（比例取自画布上的显示尺寸）
    const shown = shownRatio(document.querySelectorAll(`[data-block-id="${blockId}"] .block-html img`)[i] ?? null)
    const b = setPhoto({ id: blockId, type: 'html', props: { html, label: '' } }, i, { src }, { ratio: shown, parse: parseDoc })
    if (b.type === 'html') upd({ html: b.props.html }, 'html')
    setPicking(-1)
  }
  return (
    <>
      {texts.length > 0 && (
        <div className="field">
          <span>文字（{texts.length} 处）· 修改后保留原样式</span>
          {texts.map((s) => (
            <label key={s.id} className="slot-row" data-testid={`slot-${s.id}`}>
              <small>{ROLE_LABEL[s.role]}{s.tight ? ' · 图形内' : ''}</small>
              <BufferedArea
                rows={s.role === 'body' ? 3 : 1}
                value={s.text}
                onCommit={(t) => {
                  // 清空会让这一行连同样式一起消失，表单里不允许，需要删除时编辑源码
                  if (!t.trim()) return t
                  upd({ html: fillSlots(html, { [s.id]: t }, { parse: parseDoc, split: false, bold: false }) }, `slot-${s.id}`)
                  return cleanText(t)
                }}
              />
            </label>
          ))}
        </div>
      )}
      {imgs.length > 0 && (
        <div className="field">
          <span>片段中的图片（{imgs.length}）· 点击替换</span>
          <div className="gallery-edit">
            {imgs.map((src, i) => (
              <div key={i} className={`g-item ${picking === i ? 'picking' : ''}`} onClick={() => setPicking(picking === i ? -1 : i)}>
                <img src={src.startsWith('/media/') ? `${src.split('?')[0]}?fit=1:1&w=160` : src} alt="" />
                <div>
                  <button
                    title="删除这张图（照片连同相框）"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPicking(-1)
                      upd({ html: removeImage(html, i, parseDoc) }, 'html')
                    }}
                    data-testid={`remove-image-${i}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {picking >= 0 && (
            <div className="picker">
              <p className="hint">选择素材替换第 {picking + 1} 张图（保留原图的尺寸与样式）</p>
              <div className="asset-grid">
                {assets.map((a) => (
                  <div key={a.id} className="asset" onClick={() => replace(picking, `/media/${a.file}`)}>
                    <img src={`/media/${a.file}?fit=1:1&w=160`} alt={a.name} />
                  </div>
                ))}
              </div>
              {!assets.length && <p className="empty">素材库为空，请先在左侧「素材」上传</p>}
            </div>
          )}
        </div>
      )}
      {bgPhotos > 0 && (
        <div className="warn">
          这个片段里有 {bgPhotos} 处以背景图嵌入的旧照片（如秀米轮播），无法替换，在编辑器里可能显示为“未经允许不可引用”。
          <button className="link" onClick={() => upd({ html: removeBackgroundPhotos(html, parseDoc).html }, 'html')} data-testid="remove-bg-photos">
            移除这些旧照片
          </button>
        </div>
      )}
      <p className="hint">双击画布中的片段可直接修改文字。在画布上把照片拖到另一张照片上可以交换位置，从左侧素材拖到照片上可以直接替换。原文片段保留导入时的样式，不随主题变化。</p>
      <button className="wide" onClick={() => setSrcOpen(!srcOpen)}>{srcOpen ? '收起源码' : '编辑 HTML 源码'}</button>
      {srcOpen && (
        <>
          <textarea className="code" rows={12} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} />
          <button className="primary wide" onClick={() => upd({ html: sanitizeHtml(source, parseDoc) }, 'html-src')}>应用（自动清洗不安全内容）</button>
        </>
      )}
    </>
  )
}

const VARIANTS = {
  cover: [['auto', '跟随主题'], ['hero', '大图'], ['band', '色带'], ['minimal', '极简']],
  heading: [['auto', '跟随主题'], ['number', '序号'], ['bar', '竖条'], ['pill', '胶囊'], ['underline', '下划线']],
  card: [['auto', '跟随主题'], ['border', '描边'], ['fill', '底色'], ['accent', '标签']],
  quote: [['auto', '跟随主题'], ['mark', '引号'], ['line', '竖线'], ['center', '居中']],
  divider: [['auto', '跟随主题'], ['line', '细线'], ['dots', '圆点'], ['ornament', '菱形'], ['space', '留白']],
} as const

export function PropsForm({ block }: { block: Block }) {
  const updateProps = useStore((s) => s.updateProps)
  const upd: Upd = (props, field) => updateProps(block.id, props, `${block.id}:${field}`)
  const p: any = block.props
  const t = (label: string, key: string, area = false) => <Text label={label} value={p[key] ?? ''} area={area} onChange={(v) => upd({ [key]: v }, key)} />
  const variant = (key: keyof typeof VARIANTS) => (
    <Select label="样式" value={p.variant} options={VARIANTS[key] as unknown as [string, string][]} onChange={(v) => upd({ variant: v }, 'variant')} />
  )
  const img = (label = '图片') => <ImageField label={label} value={p.image} onChange={(v) => upd({ image: v }, 'image')} />

  let body: React.ReactNode = null
  switch (block.type) {
    case 'cover':
      body = <>{t('小标签', 'kicker')}{t('标题', 'title', true)}{t('副标题', 'subtitle', true)}{t('时间/地点', 'meta')}{img('封面图')}{variant('cover')}</>
      break
    case 'heading':
      body = <>{t('序号', 'index')}{t('标题', 'title')}{t('副标题', 'subtitle')}{variant('heading')}</>
      break
    case 'paragraph':
      body = (
        <>
          <RichField label="正文" value={p.content} onChange={(v) => upd({ content: v }, 'content')} />
          <Select label="对齐" value={p.align} options={[['justify', '两端'], ['left', '左对齐'], ['center', '居中']]} onChange={(v) => upd({ align: v }, 'align')} />
        </>
      )
      break
    case 'card':
      body = <>{t('标题', 'title')}<RichField label="内容" value={p.content} onChange={(v) => upd({ content: v }, 'content')} />{variant('card')}</>
      break
    case 'quote':
      body = <>{t('引文', 'text', true)}{t('出处', 'source')}{variant('quote')}</>
      break
    case 'imageText':
      body = (
        <>
          {img()}
          {t('标题', 'title')}
          <RichField label="文字" value={p.content} onChange={(v) => upd({ content: v }, 'content')} />
          <Select label="图片位置" value={p.imagePosition} options={[['left', '左'], ['right', '右']]} onChange={(v) => upd({ imagePosition: v }, 'pos')} />
        </>
      )
      break
    case 'image':
      body = <>{img()}{t('图注', 'caption')}<Select label="样式" value={p.variant} options={[['full', '通栏'], ['framed', '相框'], ['rounded', '圆角']]} onChange={(v) => upd({ variant: v }, 'variant')} /></>
      break
    case 'gallery':
      body = (
        <>
          <Select label="列数" value={p.columns} options={[[1, '1 列'], [2, '2 列'], [3, '3 列']]} onChange={(v) => upd({ columns: v }, 'columns')} />
          {t('图注', 'caption')}
          <div className="field">
            <span>图片（{p.images.length}）· 选中本模块后点击左侧素材追加</span>
            <div className="gallery-edit">
              {p.images.map((im: ImageRef, i: number) => (
                <div key={i} className="g-item">
                  <img src={im.src.startsWith('/media/') ? `${im.src}?fit=1:1&w=160` : im.src} alt="" />
                  <div>
                    <button disabled={i === 0} onClick={() => { const a = [...p.images]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; upd({ images: a }, 'images') }}>←</button>
                    <button onClick={() => upd({ images: p.images.filter((_: unknown, j: number) => j !== i) }, 'images')}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )
      break
    case 'timeline':
      body = (
        <div className="field">
          <span>时间节点</span>
          {p.items.map((it: any, i: number) => (
            <div key={i} className="row-edit">
              <input className="w-time" value={it.time} placeholder="时间" onChange={(e) => upd({ items: p.items.map((x: any, j: number) => (j === i ? { ...x, time: e.target.value } : x)) }, `items${i}t`)} />
              <input value={it.title} placeholder="环节" onChange={(e) => upd({ items: p.items.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) }, `items${i}n`)} />
              <input value={it.desc} placeholder="说明" onChange={(e) => upd({ items: p.items.map((x: any, j: number) => (j === i ? { ...x, desc: e.target.value } : x)) }, `items${i}d`)} />
              <button onClick={() => upd({ items: p.items.filter((_: unknown, j: number) => j !== i) }, 'items')}>✕</button>
            </div>
          ))}
          <button onClick={() => upd({ items: [...p.items, { time: '', title: '新环节', desc: '' }] }, 'items')}>＋ 添加节点</button>
        </div>
      )
      break
    case 'table':
      body = (
        <>
          <label className="field">
            <span>表格内容（每行一条，单元格用 | 分隔，第一行为表头）</span>
            <BufferedArea
              rows={8}
              value={[p.headers, ...p.rows].map((r: string[]) => r.join(' | ')).join('\n')}
              onCommit={(text) => {
                const rows = text.split('\n').map((l) => l.split('|').map((c) => c.trim()))
                const headers = rows[0] ?? []
                const body = rows.slice(1).filter((r) => r.some(Boolean))
                upd({ headers, rows: body }, 'table')
                return [headers, ...body].map((r) => r.join(' | ')).join('\n')
              }}
            />
          </label>
          {t('表注', 'caption')}
        </>
      )
      break
    case 'profile':
      body = <>{img('头像')}{t('姓名', 'name')}{t('身份', 'role')}{t('简介', 'bio', true)}</>
      break
    case 'divider':
      body = variant('divider')
      break
    case 'html':
      body = <>{t('名称', 'label')}<HtmlFields blockId={block.id} html={p.html} upd={upd} /></>
      break
    case 'ending':
      body = <>{t('结尾语', 'text')}{t('引导语', 'note')}{t('署名（可多行）', 'author', true)}{img('二维码 / 图片')}</>
      break
  }
  return (
    <div className="props-form">
      <h4>{blockMeta(block.type).icon} {block.type === 'html' ? p.label || blockMeta(block.type).label : blockMeta(block.type).label}</h4>
      {body}
    </div>
  )
}
