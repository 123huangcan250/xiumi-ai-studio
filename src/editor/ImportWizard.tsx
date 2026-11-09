import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { buildFromDesign, normalizeDesign, outlineBrief } from '../core/aiDesign'
import { assemble, kitLevels, type Placement } from '../core/assemble'
import { normalizeBlocks } from '../core/blocks'
import { compileDoc } from '../core/compiler'
import { copyLevels, copyToMarkdown, levelCounts, limitLevels, normalizeCopyText, parseCopy, type Copy } from '../core/copy'
import { displayHtml } from '../core/images'
import { buildDoc, RECIPES } from '../core/layouts'
import { normalizeOutline, parseArticle, type Outline } from '../core/outline'
import { aiPlaceRequest, checkPlan, fixedPlacements, normalizeAiPlacements, rulePlacements, type Crowd, type PhotoUnit, type PlanCheck } from '../core/photoPlan'
import { extractSlots } from '../core/slots'
import { templateTheme } from '../core/templateFill'
import type { Block, Doc } from '../core/types'
import { api, assetRef, type AiStatus, type Asset, type Template } from './api'
import { kitCandidates, KitPicker, layoutOptions, resolveKit, useComponents, type KitChoice } from './KitPicker'
import { Modal } from './Modal'
import { PhotoPlanner, type PhotoGroup } from './PhotoPlanner'
import { PlanIssues } from './PlanIssues'
import { saveNow, useStore } from './store'

const Copywriter = lazy(() => import('./Copywriter').then((m) => ({ default: m.Copywriter })))

/** 版式缩略预览：真实编译结果按比例缩小 */
function MiniPreview({ doc }: { doc: Doc }) {
  const html = useMemo(() => compileDoc(doc).html, [doc])
  return (
    <div className="mini-preview">
      <div className="mini-inner" dangerouslySetInnerHTML={{ __html: displayHtml(html) }} />
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

/** 测量模块里图片的高宽比：新照片按原比例裁切，细长的花边图不会被当成照片位 */
async function measureRatios(blocks: Block[]): Promise<Record<string, number>> {
  const srcs = new Set<string>()
  for (const b of blocks) if (b.type === 'html') for (const s of extractSlots(b.props.html)) if (s.kind === 'image' && s.src) srcs.add(s.src)
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
  const [pickedComps, setPickedComps] = useState<string[]>([])
  const [choice, setChoice] = useState<KitChoice>({})
  const comps = useComponents()
  const [tplDocs, setTplDocs] = useState<Variant[]>([])
  /** 用户对照片的描述（按素材 id），用作图注，也发给 AI 帮助把照片放到对应段落 */
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [groups, setGroups] = useState<PhotoGroup[]>([])
  /** 照片或组 → 放在哪句话后面 */
  const [anchors, setAnchors] = useState<Record<string, string>>({})
  const [crowd, setCrowd] = useState<Record<string, Crowd>>({})
  const [singlesFor, setSinglesFor] = useState<Set<string>>(new Set())
  /** 排版前确认：问题随文案、模块和照片设置实时更新 */
  const [reviewing, setReviewing] = useState(false)
  const [writing, setWriting] = useState(false)
  const noteOf = (a: Asset) => (notes[a.id] ?? '').trim()

  const refreshTemplates = () => api.templates().then(setTemplates).catch(() => {})
  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => setAi(null))
    refreshTemplates()
    window.addEventListener('templates-changed', refreshTemplates)
    return () => window.removeEventListener('templates-changed', refreshTemplates)
  }, [])
  const aiOn = !!ai?.enabled && useAi

  const cands = useMemo(() => kitCandidates(templates, picked, comps, pickedComps), [templates, picked, comps, pickedComps])
  const kit = useMemo(() => resolveKit(cands, choice), [cands, choice])
  const kitMode = Object.keys(kit).length > 0
  const units = useMemo<PhotoUnit[]>(() => {
    const idx = new Map(images.map((a, i) => [a.id, i]))
    const inGroup = new Set(groups.flatMap((g) => g.photos))
    const list: PhotoUnit[] = [
      ...groups.map((g) => ({ key: g.id, photos: g.photos.map((id) => idx.get(id)).filter((i): i is number => i !== undefined), grouped: true, layout: g.layout, anchor: anchors[g.id] })),
      ...images.filter((a) => !inGroup.has(a.id)).map((a) => ({ key: a.id, photos: [idx.get(a.id)!], grouped: false, anchor: anchors[a.id] })),
    ]
    return list.filter((u) => u.photos.length).sort((a, b) => Math.min(...a.photos) - Math.min(...b.photos))
  }, [images, groups, anchors])

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

  /** 去掉已经处理过的问题（用户已选择处理方式） */
  const pendingOf = (c: PlanCheck): PlanCheck => ({
    ...c,
    crowded: c.crowded.filter((x) => {
      const d = crowd[x.after]
      return !(d && (d.mode === 'singles' || (d.mode === 'group' && x.layouts.includes(d.layout)) || (d.mode === 'ai' && d.request.trim())))
    }),
    noLayout: c.noLayout.filter((u) => !singlesFor.has(u.key)),
  })
  const hasIssue = (c: PlanCheck) => !!c.levels || c.unmatched.length > 0 || c.crowded.length > 0 || c.noLayout.length > 0

  /** 套用模块：按文案结构逐项取模块；照片先按用户的指定放，其余由 AI（按照片描述）或规则安排 */
  const fillKit = async (copy: Copy) => {
    setBusy('分析模块…')
    const ratios = await measureRatios(Object.values(kit).map((e) => e!.block))
    const opts = { ratios }
    const input = { copy, kit, units, crowd, singlesFor, opts }
    const { fixed, free, askAi } = fixedPlacements(input)
    const captions = images.map(noteOf)
    let placements: Placement[] = []
    let usedAi = false
    // 有照片描述或用户提了要求时才请 AI 安排；都没有时按章节平均分配
    if (aiOn && (askAi.length || free.some((u) => u.photos.some((i) => captions[i])))) {
      setBusy(`${ai?.name ?? 'AI'} 正在安排照片位置…`)
      try {
        const req = aiPlaceRequest(input, free, askAi, captions)
        const raw = await api.aiPlacePhotos(req)
        placements = [...fixed, ...normalizeAiPlacements(raw, input, req, free, askAi, fixed)]
        usedAi = true
      } catch (e: any) {
        notify(`AI 安排照片失败，已按章节平均分配：${e.message}`, 'error')
      }
    }
    if (!usedAi) placements = [...fixed, ...askAi.map((a) => ({ after: a.after, photos: a.photos, layout: 'singles' as const })), ...rulePlacements(copy, free, fixed)]
    const chosen = templates.filter((t) => picked.includes(t.id)).map((t) => ({ ...t, blocks: normalizeBlocks(t.blocks) }))
    const r = assemble(copy, kit, images.map(assetRef), placements, { ...opts, captions, theme: chosen.length ? templateTheme(chosen) : undefined })
    const sources = [...new Set(Object.values(kit).map((e) => e!.from))].map((n) => `「${n}」`).join('')
    setTplDocs([{ key: `kit-${Date.now()}`, name: '套用模板', description: `按文案的标题级别和段落顺序，使用${sources}里选定的模块；${usedAi ? 'AI 按照片描述安排了照片位置' : '照片按指定位置和章节顺序排列'}`, doc: r.doc, ai: usedAi, warnings: r.warnings }])
  }

  const generate = () =>
    run(async () => {
      if (kitMode) {
        const copy = parseCopy(text)
        const check = pendingOf(checkPlan(copy, kit, units))
        if (hasIssue(check)) {
          setReviewing(true)
          return
        }
        setReviewing(false)
        setAiDocs([])
        await fillKit(copy)
        setOutline(parseArticle(text))
        return // 套用模板时不自动生成 AI 设计方案，需要时可在结果页再生成
      }
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
      if (aiOn) {
        try {
          await designWithAi(o)
        } catch (e: any) {
          notify(`AI 设计失败，可先使用内置版式：${e.message}`, 'error')
        }
      }
    }, '解析中…')

  /** 文案标题级别多于标题模块：把多出的级别改为加粗正文 */
  const flatten = () => {
    const copy = parseCopy(text)
    setText(copyToMarkdown(limitLevels(copy, kitLevels(kit))))
  }
  const aiFlatten = () =>
    run(async () => {
      const n = kitLevels(kit)
      const r = await api.aiCopywrite({ brief: '（见上一版文案）', style: '保持上一版的文风', length: '与上一版相同', levels: n, extra: '', previous: text, revise: `只调整标题结构：改成 ${n} 级标题，把多出的下级标题并入正文或上级标题，正文内容尽量不变` })
      const md = normalizeCopyText(r)
      if (!md) throw new Error('模型没有返回文案')
      setText(md)
      const levels = copyLevels(parseCopy(md))
      if (levels > n) notify(`改写后仍有 ${levels} 级标题，可以再点“改为加粗正文”`, 'error')
    }, 'AI 改写中…')

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

  const counts = useMemo(() => levelCounts(parseCopy(text)), [text])
  const live = useMemo(() => (reviewing && kitMode ? checkPlan(parseCopy(text), kit, units) : null), [reviewing, kitMode, text, kit, units])

  return (
    <Modal title="AI 一键排版" onClose={onClose} width={outline ? 1180 : 1120}>
      {!outline ? (
        <div className="import-step">
          <div className="import-layout">
            <div className="import-main">
              <div className="row gap wrap">
                {ai?.enabled && (
                  <button className="accent" onClick={() => setWriting(true)} data-testid="open-copywriter">✍ 一键生成文案</button>
                )}
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
                      setGroups([])
                      setAnchors({})
                      window.dispatchEvent(new Event('assets-changed'))
                    }, '载入样例…')
                  }
                  data-testid="load-sample"
                >
                  载入验收样例
                </button>
              </div>
              <textarea
                className="import-text"
                rows={12}
                value={text}
                placeholder={'粘贴活动推文正文。第一行用「# 」写标题；一级标题用「## 」、二级标题用「### 」、三级标题用「#### 」单独成行（没有标记时，短行会被识别为一级标题）；“09:00 签到”这类行会被识别为时间轴；|分隔的行会被识别为表格'}
                onChange={(e) => setText(e.target.value)}
                data-testid="import-text"
              />
              <div className="row gap wrap">
                <span className="hint">
                  正文 {text.replace(/\s/g, '').length} 字 · 图片 {images.length} 张
                  {counts.some(Boolean) && ` · ${counts.map((c, i) => (c ? `${['一', '二', '三'][i]}级标题 ${c}` : '')).filter(Boolean).join('、')}`}
                </span>
                {images.length > 0 && <button className="link" onClick={() => { setImages([]); setGroups([]); setAnchors({}) }}>清空图片</button>}
              </div>
              <KitPicker templates={templates} picked={picked} setPicked={setPicked} pickedComps={pickedComps} setPickedComps={setPickedComps} choice={choice} setChoice={setChoice} comps={comps} />
              <div className="ai-box">
                <label className="check">
                  <input type="checkbox" checked={aiOn} disabled={!ai?.enabled} onChange={(e) => setUseAi(e.target.checked)} data-testid="use-ai" />
                  {ai?.enabled ? (
                    <>使用 <b>{ai.name}</b>（{ai.model}）{kitMode ? '按照片描述安排照片位置' : '理解结构并设计三套方案'}</>
                  ) : (
                    <>未配置 AI 模型，{kitMode ? '照片按指定位置和章节顺序排列' : '仅生成内置版式'}。</>
                  )}
                  <button className="link" onClick={() => window.dispatchEvent(new Event('open-ai-settings'))}>{ai?.enabled ? '切换模型' : '去配置'}</button>
                </label>
                {aiOn && !kitMode && (
                  <>
                    <input value={hint} placeholder="风格要求（可选），例如：清华紫、庄重典雅，适合校庆活动" onChange={(e) => setHint(e.target.value)} data-testid="design-hint" />
                    <div className="row gap wrap">
                      {HINTS.map((h) => <button key={h} className="chip" onClick={() => setHint(h)}>{h}</button>)}
                    </div>
                  </>
                )}
              </div>
              {live && (
                <PlanIssues
                  check={live}
                  aiOn={aiOn}
                  busy={busy}
                  crowd={crowd}
                  setCrowd={setCrowd}
                  singlesFor={singlesFor}
                  setSinglesFor={setSinglesFor}
                  onFlatten={flatten}
                  onAiFlatten={aiFlatten}
                  onClearAnchor={(key) => setAnchors((a) => ({ ...a, [key]: '' }))}
                  onContinue={generate}
                  onCancel={() => setReviewing(false)}
                />
              )}
            </div>
            <PhotoPlanner images={images} setImages={setImages} notes={notes} setNotes={setNotes} groups={groups} setGroups={setGroups} anchors={anchors} setAnchors={setAnchors} layouts={kitMode ? layoutOptions(kit) : []} text={text} />
          </div>
          {!live && (
            <div className="modal-actions">
              <button onClick={onClose}>取消</button>
              <button className="primary" disabled={!text.trim() || !!busy} onClick={generate} data-testid="generate">
                {busy || (kitMode ? '套用模板生成' : aiOn ? 'AI 设计三套方案' : '生成三套排版')}
              </button>
            </div>
          )}
          {writing && (
            <Suspense fallback={null}>
              <Copywriter onClose={() => setWriting(false)} onImport={setText} levels={kitMode ? kitLevels(kit) : 0} hasText={!!text.trim()} />
            </Suspense>
          )}
        </div>
      ) : (
        <div className="variants">
          <p className="hint">
            {kitMode
              ? `文案有 ${counts.map((c, i) => (c ? `${['一', '二', '三'][i]}级标题 ${c} 个` : '')).filter(Boolean).join('、') || '0 个标题'}，${images.length} 张照片。`
              : `识别到 ${outline.sections.length} 个章节、${outline.sections.reduce((n, s) => n + s.timeline.length, 0)} 个时间节点、${outline.sections.reduce((n, s) => n + s.quotes.length, 0)} 条引语、${images.length} 张图片。`}
            <button className="link" onClick={() => setOutline(null)}>← 返回修改</button>
          </p>
          {kitMode && (
            <>
              <h4 className="variants-title">
                模板套用
                <button disabled={!!busy} onClick={() => run(() => fillKit(parseCopy(text)), '套用中…')} data-testid="refill">{busy || (aiOn ? '重新安排照片' : '重新套用')}</button>
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
