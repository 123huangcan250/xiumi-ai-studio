import { useEffect, useMemo, useState } from 'react'
import { buildFromDesign, normalizeDesign, outlineBrief } from '../core/aiDesign'
import { normalizeBlocks } from '../core/blocks'
import { compileDoc } from '../core/compiler'
import { buildDoc, RECIPES } from '../core/layouts'
import { normalizeOutline, parseArticle, type Outline } from '../core/outline'
import { extractSlots } from '../core/slots'
import { buildCatalog, buildFromPlan, catalogBrief, normalizePlan, rulePlan, templateTheme } from '../core/templateFill'
import type { Doc } from '../core/types'
import { api, assetRef, type AiStatus, type Asset, type Template } from './api'
import { Modal } from './Modal'
import { saveNow, useStore } from './store'

/** 版式缩略预览：真实编译结果按比例缩小 */
function MiniPreview({ doc }: { doc: Doc }) {
  const html = useMemo(() => compileDoc(doc).html, [doc])
  return (
    <div className="mini-preview">
      <div className="mini-inner" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

interface Variant {
  key: string
  name: string
  description: string
  doc: Doc
  ai: boolean
  /** 内置版式的配方序号（可切换主题） */
  recipe?: number
  warnings?: string[]
}

/** 测量模板里图片的高宽比：新照片按原比例裁切，细长的花边图不会被当成照片位 */
async function measureRatios(templates: Template[]): Promise<Record<string, number>> {
  const srcs = new Set<string>()
  for (const t of templates) for (const b of t.blocks) if (b.type === 'html') for (const s of extractSlots(b.props.html)) if (s.kind === 'image' && s.src) srcs.add(s.src)
  const out: Record<string, number> = {}
  await Promise.all(
    [...srcs].slice(0, 120).map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.referrerPolicy = 'no-referrer'
          const timer = setTimeout(resolve, 6000)
          img.onload = () => {
            // 原图很小的是图标：记为 0，不当作照片位
            if (img.naturalWidth) out[src] = img.naturalWidth < 300 ? 0 : img.naturalHeight / img.naturalWidth
            clearTimeout(timer)
            resolve()
          }
          img.onerror = () => {
            clearTimeout(timer)
            resolve()
          }
          img.src = src
        }),
    ),
  )
  return out
}

const HINTS = ['清华风格，庄重典雅', '科技感，冷静理性', '温暖人文，纸质感', '高级杂志感，大留白', '青春活泼，明快配色', '国风雅致']

export function ImportWizard({ onClose, initialText, initialImages, initialTemplates }: { onClose: () => void; initialText?: string; initialImages?: Asset[]; initialTemplates?: string[] }) {
  const themes = useStore((s) => s.themes)
  const { load, notify } = useStore.getState()
  const [text, setText] = useState(initialText ?? '')
  const [images, setImages] = useState<Asset[]>(initialImages ?? [])
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [useAi, setUseAi] = useState(true)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState('')
  const [outline, setOutline] = useState<Outline | null>(null)
  const [aiDocs, setAiDocs] = useState<Variant[]>([])
  const [themeFor, setThemeFor] = useState<string[]>(RECIPES.map((r) => r.defaultTheme))
  const [templates, setTemplates] = useState<Template[]>([])
  const [picked, setPicked] = useState<string[]>(initialTemplates ?? [])
  const [tplDocs, setTplDocs] = useState<Variant[]>([])
  /** 用户对照片的描述（按素材 id），发给 AI 帮助把照片放到对应段落 */
  const [notes, setNotes] = useState<Record<string, string>>({})
  const noteOf = (a: Asset) => (notes[a.id] ?? '').trim()

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => setAi(null))
    api.templates().then(setTemplates).catch(() => {})
  }, [])
  const aiOn = !!ai?.enabled && useAi

  const builtin: Variant[] = useMemo(() => {
    if (!outline) return []
    const refs = images.map(assetRef)
    return RECIPES.map((r, i) => ({ key: r.id, name: r.name, description: r.description, doc: buildDoc(outline, refs, r, themeFor[i]), ai: false, recipe: i }))
  }, [outline, images, themeFor])

  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy('')
    }
  }

  const designWithAi = async (o: Outline) => {
    setBusy(`${ai?.name ?? 'AI'} 正在设计三套方案…`)
    const r = await api.aiDesign(outlineBrief(o, images.length), hint)
    const refs = images.map(assetRef)
    const list = (Array.isArray(r.designs) ? r.designs : []).slice(0, 3)
    if (!list.length) throw new Error('模型没有返回设计方案')
    setAiDocs(
      list.map((raw, i) => {
        const d = normalizeDesign(raw, o.sections.length, i)
        return { key: `ai-${i}-${Date.now()}`, name: d.name, description: d.concept, doc: buildFromDesign(o, refs, d), ai: true }
      }),
    )
  }

  /** 套用模板：规则填充一定生成；配置了 AI 时再让模型挑部件、写文案、分配照片 */
  const fillTemplates = async (o: Outline) => {
    const chosen = templates.filter((t) => picked.includes(t.id)).map((t) => ({ ...t, blocks: normalizeBlocks(t.blocks) }))
    if (!chosen.length) return
    setBusy('分析模板版式…')
    const ratios = await measureRatios(chosen)
    const parts = buildCatalog(chosen, { ratios })
    const refs = images.map(assetRef)
    const theme = templateTheme(chosen)
    const names = chosen.map((t) => `「${t.name}」`).join('')
    const out: Variant[] = []
    const rule = buildFromPlan(rulePlan(o, parts, refs.length), parts, refs, { ratios, theme, title: o.title })
    out.push({ key: `tpl-rule-${Date.now()}`, name: '按模板顺序填充', description: `沿用${names}的版式，按章节依次填入文字与照片`, doc: rule.doc, ai: false, warnings: rule.warnings })
    if (aiOn) {
      setBusy(`${ai?.name ?? 'AI'} 正在套用模板…`)
      try {
        const photos = images.map((a) => (noteOf(a) ? `${a.name}｜${noteOf(a)}` : a.name))
        const raw = await api.aiTemplateFill({ text, photos, catalog: catalogBrief(parts), hint })
        const plan = normalizePlan(raw, parts, refs.length)
        if (!plan.items.length) throw new Error('模型没有返回可用的部件')
        const r = buildFromPlan(plan, parts, refs, { ratios, theme, title: o.title })
        out.unshift({ key: `tpl-ai-${Date.now()}`, name: 'AI 套用模板', description: `AI 从${names}中挑选版块、撰写文案并分配照片`, doc: r.doc, ai: true, warnings: r.warnings })
      } catch (e: any) {
        notify(`AI 套用模板失败，已保留按顺序填充的结果：${e.message}`, 'error')
      }
    }
    setTplDocs(out)
  }

  const generate = () =>
    run(async () => {
      const rule = parseArticle(text)
      let o = rule
      if (aiOn) {
        setBusy(`${ai?.name ?? 'AI'} 正在理解文稿结构…`)
        try {
          o = normalizeOutline(await api.aiOutline(text, images.map((a) => a.name), images.map(noteOf)), rule)
        } catch (e: any) {
          notify(`结构理解失败，已改用规则解析：${e.message}`, 'error')
        }
      }
      setOutline(o)
      setAiDocs([])
      setTplDocs([])
      if (picked.length) {
        await fillTemplates(o)
        return // 套用模板时不自动生成 AI 设计方案，需要时可在结果页再生成
      }
      if (aiOn) {
        try {
          await designWithAi(o)
        } catch (e: any) {
          notify(`AI 设计失败，可先使用内置版式：${e.message}`, 'error')
        }
      }
    }, '解析中…')

  const choose = async (doc: Doc, all?: Variant[]) => {
    await saveNow()
    if (all) for (const v of all) if (v.doc !== doc) await api.saveProject(v.doc)
    load(doc)
    await saveNow()
    notify(all ? `${all.length} 套方案均已保存为项目，可在「项目」中切换` : '已打开所选方案')
    onClose()
  }

  const card = (v: Variant, i: number) => (
    <div className="variant" key={v.key} data-testid={`variant-${v.key}`}>
      <h4>
        {v.ai && <span className="ai-tag">AI</span>} {String.fromCharCode(65 + i)} · {v.name}
      </h4>
      <p className="hint concept">{v.description}</p>
      {v.recipe !== undefined && (
        <select value={themeFor[v.recipe]} onChange={(e) => setThemeFor((t) => t.map((x, j) => (j === v.recipe ? e.target.value : x)))}>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {v.warnings?.map((w) => <p key={w} className="warn">{w}</p>)}
      <MiniPreview doc={v.doc} />
      <p className="hint">{v.doc.blocks.length} 个模块 · {compileDoc(v.doc).charCount.toLocaleString()} 字符</p>
      <button className="primary wide" onClick={() => choose(v.doc)} data-testid={`choose-${v.key}`}>使用此方案</button>
    </div>
  )

  return (
    <Modal title="AI 一键排版" onClose={onClose} width={outline ? 1180 : 1080}>
      {!outline ? (
        <div className="import-step">
          <div className="import-layout">
          <div className="import-main">
          <div className="row gap wrap">
            <label className="upload">
              <input
                type="file"
                accept=".docx,.md,.markdown,.txt"
                hidden
                onChange={(e) =>
                  e.target.files?.[0] &&
                  run(async () => {
                    const r = await api.importFile(e.target.files![0])
                    setText(r.text)
                    if (r.assets.length) setImages((x) => [...x, ...r.assets])
                    window.dispatchEvent(new Event('assets-changed'))
                  }, '导入文稿…')
                }
                data-testid="import-file"
              />
              📄 导入 Word / Markdown / TXT
            </label>
            <label className="upload">
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) =>
                  e.target.files?.length &&
                  run(async () => {
                    const r = await api.uploadAssets(e.target.files!)
                    setImages((x) => [...x, ...r])
                    window.dispatchEvent(new Event('assets-changed'))
                  }, '上传图片…')
                }
                data-testid="import-images"
              />
              🖼 添加照片（可多选）
            </label>
            <button
              onClick={() =>
                run(async () => {
                  const r = await api.loadSample()
                  setText(r.text)
                  setImages(r.assets)
                  window.dispatchEvent(new Event('assets-changed'))
                }, '载入样例…')
              }
              data-testid="load-sample"
            >
              载入验收样例
            </button>
          </div>
          <textarea className="import-text" rows={12} value={text} placeholder={'粘贴活动推文正文（第一行为标题；短行会被识别为小标题；“09:00 签到”这类行会被识别为时间轴；|分隔的行会被识别为表格）'} onChange={(e) => setText(e.target.value)} data-testid="import-text" />
          <div className="row gap wrap">
            <span className="hint">正文 {text.replace(/\s/g, '').length} 字 · 图片 {images.length} 张</span>
            {images.length > 0 && <button className="link" onClick={() => setImages([])}>清空图片</button>}
          </div>
          <div className="tpl-box">
            <h5>套用我的模板（可多选）</h5>
            {templates.length ? (
              <>
                <div className="row gap wrap">
                  {templates.map((t) => (
                    <button key={t.id} className={`chip ${picked.includes(t.id) ? 'on' : ''}`} onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))} data-testid="pick-template">
                      {t.name}
                      <small>{t.blocks.length} 个模块</small>
                    </button>
                  ))}
                </div>
                <p className="tpl-note">选中后保留模板的版式和装饰，只替换文字与照片；配置了 AI 时由模型挑选版块并撰写文案。</p>
              </>
            ) : (
              <p className="tpl-note">还没有模板。导入公众号推文时勾选「保存为模板」，或在「模板」里收藏当前整篇，就能在这里套用。</p>
            )}
          </div>
          <div className="ai-box">
            <label className="check">
              <input type="checkbox" checked={aiOn} disabled={!ai?.enabled} onChange={(e) => setUseAi(e.target.checked)} data-testid="use-ai" />
              {ai?.enabled ? <>使用 <b>{ai.name}</b>（{ai.model}）理解结构并设计三套方案</> : <>未配置 AI 模型，仅生成内置版式。</>}
              <button className="link" onClick={() => window.dispatchEvent(new Event('open-ai-settings'))}>{ai?.enabled ? '切换模型' : '去配置'}</button>
            </label>
            {aiOn && (
              <>
                <input value={hint} placeholder="风格要求（可选），例如：清华紫、庄重典雅，适合校庆活动" onChange={(e) => setHint(e.target.value)} data-testid="design-hint" />
                <div className="row gap wrap">
                  {HINTS.map((h) => <button key={h} className="chip" onClick={() => setHint(h)}>{h}</button>)}
                </div>
              </>
            )}
          </div>
          </div>
          <aside className="photo-notes" data-testid="photo-notes">
            <h5>照片（{images.length}）</h5>
            {images.length ? (
              <>
                <p className="tpl-note">可以给照片写一句说明（在做什么、画面里是谁），AI 会把照片放到对应的段落旁。</p>
                <ol className="photo-list">
                  {images.map((a, i) => (
                    <li key={a.id}>
                      <span className="photo-no">{i + 1}</span>
                      <img src={`/media/${a.file}?fit=1:1&w=160`} alt={a.name} title={a.name} />
                      <textarea rows={2} value={notes[a.id] ?? ''} placeholder="这张照片在做什么？例如：开幕式全体合影" onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} data-testid={`photo-note-${i + 1}`} />
                      <button className="link" title="不使用这张照片" onClick={() => setImages((x) => x.filter((y) => y.id !== a.id))}>✕</button>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="empty">还没有照片，点击「添加照片」上传</p>
            )}
          </aside>
          </div>
          <div className="modal-actions">
            <button onClick={onClose}>取消</button>
            <button className="primary" disabled={!text.trim() || !!busy} onClick={generate} data-testid="generate">
              {busy || (picked.length ? (aiOn ? 'AI 套用模板' : '套用模板生成') : aiOn ? 'AI 设计三套方案' : '生成三套排版')}
            </button>
          </div>
        </div>
      ) : (
        <div className="variants">
          <p className="hint">
            识别到 {outline.sections.length} 个章节、{outline.sections.reduce((n, s) => n + s.timeline.length, 0)} 个时间节点、{outline.sections.reduce((n, s) => n + s.quotes.length, 0)} 条引语、{images.length} 张图片。
            <button className="link" onClick={() => setOutline(null)}>← 返回修改</button>
          </p>
          {picked.length > 0 && (
            <>
              <h4 className="variants-title">
                模板套用
                <button disabled={!!busy} onClick={() => run(() => fillTemplates(outline), '套用中…')} data-testid="refill">{busy || '重新套用'}</button>
              </h4>
              {tplDocs.length > 0 ? <div className="variant-grid">{tplDocs.map(card)}</div> : <p className="empty">{busy || '没有生成结果'}</p>}
            </>
          )}
          {aiOn && (
            <>
              <h4 className="variants-title">
                AI 设计方案 · {ai?.name}
                <span className="row gap">
                  <input className="hint-input" value={hint} placeholder="风格要求" onChange={(e) => setHint(e.target.value)} />
                  <button disabled={!!busy} onClick={() => run(() => designWithAi(outline), 'AI 设计中…')} data-testid="redesign">{busy || (aiDocs.length ? '重新设计' : '生成 AI 设计方案')}</button>
                </span>
              </h4>
              {aiDocs.length > 0 ? <div className="variant-grid">{aiDocs.map(card)}</div> : <p className="empty">{busy || '套用模板时不会自动生成 AI 设计方案，需要时点击右侧按钮'}</p>}
            </>
          )}
          <h4 className="variants-title">内置版式</h4>
          <div className="variant-grid">{builtin.map(card)}</div>
          <div className="modal-actions">
            <button onClick={() => choose((tplDocs[0] ?? aiDocs[0] ?? builtin[0]).doc, [...tplDocs, ...aiDocs, ...builtin])}>全部保存为项目，并打开第一套</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
