import { CoverTitleAlignment } from './CoverTitleAlignment'
import { useEffect, useMemo, useState } from 'react'
import { blockLabel, blockMeta } from '../core/blocks'
import { displayUrl } from '../core/images'
import { sanitizeHtml } from '../core/sanitize'
import { setPhoto } from '../core/photos'
import { collectColors, docMainColors, fixedDecorCount, harmonize, recolorHtml } from '../core/recolor'
import { backgroundPhotos, editableText, extractSlots, fillSlots, removeBackgroundPhotos, removeImage, setBackgroundPhoto, setSlotAlign, slotAligns, slotRawTexts, type Align, type SlotRole, type TextSlot } from '../core/slots'
import { resolveTheme } from '../core/themes'
import { richToPlain, setRichAlignment, textToRich } from '../core/richtext'
import type { Block, ImageRef, PicItem } from '../core/types'
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
        value={richToPlain(value, { preserveWhitespace: true })}
        onCommit={(t) => {
          const rich = textToRich(t, { preserveWhitespace: true })
          onChange(rich)
          return richToPlain(rich, { preserveWhitespace: true })
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

/** 片段的配色：逐个改色，或统一到本文的主色；图片装饰改不了色，如实提示 */
function ColorFields({ blockId, html, upd }: { blockId: string; html: string; upd: Upd }) {
  const colors = useMemo(() => collectColors(html, parseDoc).filter((c) => c.chroma).slice(0, 8), [html])
  const fixed = useMemo(() => fixedDecorCount(html, parseDoc), [html])
  if (!colors.length) return null
  const match = () => {
    const s = useStore.getState()
    const others = s.doc.blocks.filter((b) => b.id !== blockId)
    const map = harmonize(collectColors(html, parseDoc), docMainColors(others, resolveTheme(s.doc), parseDoc))
    if (!Object.keys(map).length) return s.notify('配色已经一致，或本文没有可匹配的主色')
    upd({ html: recolorHtml(html, map, parseDoc) }, 'match-colors')
    s.notify('已匹配本文配色（Ctrl+Z 可撤销）')
  }
  return (
    <div className="field">
      <span>配色 · 点击色块修改</span>
      <div className="color-swatches" data-testid="color-swatches">
        {colors.map((c, i) => (
          <label key={i} style={{ background: c.hex }} title={c.hex}>
            <input type="color" value={c.hex} onChange={(e) => upd({ html: recolorHtml(html, { [c.hex]: e.target.value.toLowerCase() }, parseDoc) }, `color-${i}`)} />
          </label>
        ))}
      </div>
      <button className="wide" onClick={match} data-testid="match-colors">匹配本文配色</button>
      {fixed > 0 && <p className="hint">有 {fixed} 处图片装饰（PNG、GIF、纹理）颜色不会改变，混排时请留意。</p>}
    </div>
  )
}

/** 原文片段：按槽位改字、替换图片、编辑源码 */
function HtmlFields({ blockId, html, upd }: { blockId: string; html: string; upd: Upd }) {
  const [picking, setPicking] = useState(-1)
  const [bgPicking, setBgPicking] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [source, setSource] = useState(html)
  const [srcOpen, setSrcOpen] = useState(false)
  useEffect(() => setSource(html), [html])
  useEffect(() => {
    if ((picking >= 0 || bgPicking) && !assets.length) api.assets().then(setAssets).catch(() => {})
  }, [picking, bgPicking, assets.length])
  const slots = useMemo(() => extractSlots(html, parseDoc), [html])
  const texts = slots.filter((s): s is TextSlot => s.kind === 'text')
  // 表单里显示保留空格的文字；对齐状态一次算出，避免每个槽位都重新解析一遍大片段
  const raws = useMemo(() => slotRawTexts(html, parseDoc), [html])
  const aligns = useMemo(() => slotAligns(html, parseDoc), [html])
  const imgs = slots.filter((s) => s.kind === 'image').map((s) => s.src)
  const bgPhotos = useMemo(() => backgroundPhotos(html, parseDoc), [html])
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
            <div key={s.id} className="slot-row" data-testid={`slot-${s.id}`}>
              <div className="slot-head">
                <small>{ROLE_LABEL[s.role]}{s.tight ? ' · 图形内' : ''}</small>
                <span className="align-btns" role="group" aria-label="对齐">
                  {(['left', 'center', 'right', 'justify'] as Align[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={aligns[s.id]?.align === a ? 'on' : ''}
                      aria-pressed={aligns[s.id]?.align === a}
                      disabled={!aligns[s.id]?.alignable}
                      title={aligns[s.id]?.alignable ? { left: '居左', center: '居中', right: '居右', justify: '两端对齐' }[a] : '图形里的文字位置是固定的，不能调整对齐'}
                      onClick={() => upd({ html: setSlotAlign(html, s.id, a, parseDoc) }, `align-${s.id}`)}
                      data-testid={`align-${s.id}-${a}`}
                    >
                      {{ left: '居左', center: '居中', right: '居右', justify: '两端对齐' }[a]}
                    </button>
                  ))}
                </span>
              </div>
              <BufferedArea
                rows={s.role === 'body' ? 3 : 1}
                value={raws[s.id] ?? s.text}
                onCommit={(t) => {
                  // 清空会让这一行连同样式一起消失，表单里不允许，需要删除时编辑源码
                  if (!t.trim()) return t
                  // 保留输入的空格：行首、行尾、连续空格写成不换行空格，页面上才看得到
                  upd({ html: fillSlots(html, { [s.id]: t }, { parse: parseDoc, split: false, bold: false, preserveWhitespace: true }) }, `slot-${s.id}`)
                  return editableText(t, true)
                }}
              />
            </div>
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
      {bgPhotos.length > 0 && (
        <div className="field">
          <span>背景图照片（{bgPhotos.length}）· 点击替换，轮播里重复用到的位置一起换</span>
          <div className="gallery-edit">
            {bgPhotos.map((b, i) => (
              <div key={b.src} className={`g-item ${bgPicking === b.src ? 'picking' : ''}`} onClick={() => setBgPicking(bgPicking === b.src ? '' : b.src)} data-testid={`bg-photo-${i}`}>
                <img src={b.src.startsWith('/media/') ? `${b.src.split('?')[0]}?fit=1:1&w=160` : displayUrl(b.src)} alt="" />
                {b.count > 1 && <small className="g-count">×{b.count}</small>}
              </div>
            ))}
          </div>
          {bgPicking && (
            <div className="picker">
              <p className="hint">选择素材替换这张背景图（按原位置比例裁切）</p>
              <div className="asset-grid">
                {assets.map((a) => (
                  <div
                    key={a.id}
                    className="asset"
                    onClick={() => {
                      upd({ html: setBackgroundPhoto(html, bgPicking, { src: `/media/${a.file}` }, { parse: parseDoc }) }, 'html')
                      setBgPicking('')
                    }}
                    data-testid="bg-asset"
                  >
                    <img src={`/media/${a.file}?fit=1:1&w=160`} alt={a.name} />
                  </div>
                ))}
              </div>
              {!assets.length && <p className="empty">素材库为空，请先在左侧「素材」上传</p>}
            </div>
          )}
          <p className="hint">
            背景图换成本地素材后，粘贴到公众号是否保留尚未实测；未实测前请用“上传到微信图床”模式导出。
            <button className="link" onClick={() => upd({ html: removeBackgroundPhotos(html, parseDoc).html }, 'html')} data-testid="remove-bg-photos">
              全部移除
            </button>
          </p>
        </div>
      )}
      <ColorFields blockId={blockId} html={html} upd={upd} />
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

/** 套件模块的图片位：每张图都有图注位置（可留空）；轮播可以增删图片位，多图的位置数由张数决定 */
function PicsField({ pics, onChange, removable }: { pics: PicItem[]; onChange: (pics: PicItem[], key: string) => void; removable?: boolean }) {
  const set = (i: number, patch: Partial<PicItem>, key: string) => onChange(pics.map((x, j) => (j === i ? { ...x, ...patch } : x)), key)
  const move = (i: number) => {
    const a = [...pics]
    ;[a[i - 1], a[i]] = [a[i], a[i - 1]]
    onChange(a, 'pics')
  }
  return (
    <div className="field">
      <span>图片与图注 · 选中本模块后点击左侧素材依次放入，或把素材拖到某个图片位上</span>
      <div className="pics-edit">
        {pics.map((x, i) => (
          <div key={i} className="pic-row" data-testid="pic-row">
            {x.image ? <img src={x.image.src.startsWith('/media/') ? `${x.image.src.split('?')[0]}?fit=1:1&w=120` : x.image.src} alt="" /> : <span className="pic-empty">图片 {i + 1}</span>}
            <input value={x.caption} placeholder="图注（可留空）" onChange={(e) => set(i, { caption: e.target.value }, `pic${i}`)} />
            <div className="pic-actions">
              <button title="前移" disabled={i === 0} onClick={() => move(i)}>←</button>
              {x.image && <button title="清空图片（保留图片位）" onClick={() => set(i, { image: undefined }, 'pics')}>⌫</button>}
              {removable && <button title="删除这个图片位" onClick={() => onChange(pics.filter((_, j) => j !== i), 'pics')}>✕</button>}
            </div>
          </div>
        ))}
      </div>
      {removable && <button onClick={() => onChange([...pics, { caption: '' }], 'pics')}>＋ 添加图片位</button>}
    </div>
  )
}

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
      body = <>{t('小标签', 'kicker')}{t('标题', 'title', true)}<CoverTitleAlignment value={p.titleAlign} onChange={(v) => upd({ titleAlign: v }, 'titleAlign')} />{t('副标题', 'subtitle', true)}{t('时间/地点', 'meta')}{img('封面图')}{variant('cover')}</>
      break
    case 'heading':
      body = <>{t('序号', 'index')}{t('标题', 'title')}{t('副标题', 'subtitle')}{variant('heading')}</>
      break
    case 'paragraph':
      body = (
        <>
          <RichField label="正文" value={p.content} onChange={(v) => upd({ content: v }, 'content')} />
          <Select label="对齐" value={p.align} options={[['justify', '两端'], ['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]} onChange={(v) => upd({ align: v, content: setRichAlignment(p.content, v) }, 'align')} />
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
    case 'box':
      body = (
        <>
          {t('标题', 'title')}
          {t('小标签（德文 / 英文）', 'label')}
          <Select label="样式" value={p.variant} options={[['plate', '紫色铭牌'], ['rule', '线框'], ['paper', '浅底']]} onChange={(v) => upd({ variant: v }, 'variant')} />
          <p className="hint">
            框内有 {p.children.length} 个模块。选中文本框后点击左侧模块会放进框内末尾；选中框内模块再点击，会插到它后面。
            放进来的模块自动使用 14 号黑色正文、12 号灰色注释和文本框的宽度。
          </p>
        </>
      )
      break
    case 'carousel':
      body = (
        <>
          {t('小标签', 'label')}
          <Select label="样式" value={p.variant} options={[['peek', '露出下一张'], ['full', '整张']]} onChange={(v) => upd({ variant: v }, 'variant')} />
          <Select label="图片比例" value={p.ratio} options={[['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['1:1', '1:1'], ['3:4', '3:4']]} onChange={(v) => upd({ ratio: v }, 'ratio')} />
          <PicsField pics={p.pics} onChange={(pics, key) => upd({ pics }, key)} removable />
        </>
      )
      break
    case 'frame':
      body = (
        <>
          {img()}
          {t('图注（可留空）', 'caption')}
          {t(p.variant === 'ticket' ? '票根文字（如 MÜNCHEN → BERLIN）' : '角标文字（如城市德文名）', 'label')}
          <Select label="样式" value={p.variant} options={[['flag', '三色框'], ['circuit', '电路角框'], ['ticket', '车票']]} onChange={(v) => upd({ variant: v }, 'variant')} />
        </>
      )
      break
    case 'photos': {
      const LAYOUTS: Record<number, [string, string][]> = { 2: [['even', '并排'], ['feature', '错落']], 3: [['even', '一行三张'], ['feature', '上一下二']], 4: [['even', '田字格'], ['feature', '上一下三']] }
      body = (
        <>
          <Select
            label="张数"
            value={p.count}
            options={[[2, '双图'], [3, '三图'], [4, '四图']]}
            onChange={(v) => upd({ count: v, pics: Array.from({ length: v }, (_, i) => p.pics[i] ?? { caption: '' }) }, 'count')}
          />
          <Select label="版式" value={p.layout} options={LAYOUTS[p.count]} onChange={(v) => upd({ layout: v }, 'layout')} />
          {p.layout === 'even' && <Select label="图片比例" value={p.ratio} options={[['4:3', '4:3'], ['3:4', '3:4'], ['1:1', '1:1']]} onChange={(v) => upd({ ratio: v }, 'ratio')} />}
          <PicsField pics={p.pics.slice(0, p.count)} onChange={(pics, key) => upd({ pics }, key)} />
        </>
      )
      break
    }
  }
  return (
    <div className="props-form">
      <h4>{blockMeta(block.type).icon} {blockLabel(block)}</h4>
      {body}
    </div>
  )
}
