import { useEffect, useMemo, useState } from 'react'
import { buildFromDesign, normalizeDesign, outlineBrief } from '../core/aiDesign'
import { compileDoc } from '../core/compiler'
import { buildDoc, RECIPES } from '../core/layouts'
import { normalizeOutline, parseArticle, type Outline } from '../core/outline'
import type { Doc } from '../core/types'
import { api, assetRef, type AiStatus, type Asset } from './api'
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
}

const HINTS = ['清华风格，庄重典雅', '科技感，冷静理性', '温暖人文，纸质感', '高级杂志感，大留白', '青春活泼，明快配色', '国风雅致']

export function ImportWizard({ onClose, initialText, initialImages }: { onClose: () => void; initialText?: string; initialImages?: Asset[] }) {
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

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => setAi(null))
  }, [])
  const aiOn = !!ai?.enabled && useAi

  const builtin: Variant[] = useMemo(() => {
    if (!outline) return []
    const refs = images.map(assetRef)
    return RECIPES.map((r, i) => ({ key: r.id, name: r.name, description: r.description, doc: buildDoc(outline, refs, r, themeFor[i]), ai: false }))
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

  const generate = () =>
    run(async () => {
      const rule = parseArticle(text)
      let o = rule
      if (aiOn) {
        setBusy(`${ai?.name ?? 'AI'} 正在理解文稿结构…`)
        try {
          o = normalizeOutline(await api.aiOutline(text, images.map((a) => a.name)), rule)
        } catch (e: any) {
          notify(`结构理解失败，已改用规则解析：${e.message}`, 'error')
        }
      }
      setOutline(o)
      setAiDocs([])
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
      {!v.ai && (
        <select value={themeFor[i]} onChange={(e) => setThemeFor((t) => t.map((x, j) => (j === i ? e.target.value : x)))}>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <MiniPreview doc={v.doc} />
      <p className="hint">{v.doc.blocks.length} 个模块 · {compileDoc(v.doc).charCount.toLocaleString()} 字符</p>
      <button className="primary wide" onClick={() => choose(v.doc)} data-testid={`choose-${v.key}`}>使用此方案</button>
    </div>
  )

  return (
    <Modal title="AI 一键排版" onClose={onClose} width={outline ? 1180 : 760}>
      {!outline ? (
        <div className="import-step">
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
            {images.slice(0, 14).map((a) => <img key={a.id} className="thumb" src={`/media/${a.file}?fit=1:1&w=120`} alt="" />)}
            {images.length > 0 && <button className="link" onClick={() => setImages([])}>清空图片</button>}
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
          <div className="modal-actions">
            <button onClick={onClose}>取消</button>
            <button className="primary" disabled={!text.trim() || !!busy} onClick={generate} data-testid="generate">{busy || (aiOn ? 'AI 设计三套方案' : '生成三套排版')}</button>
          </div>
        </div>
      ) : (
        <div className="variants">
          <p className="hint">
            识别到 {outline.sections.length} 个章节、{outline.sections.reduce((n, s) => n + s.timeline.length, 0)} 个时间节点、{outline.sections.reduce((n, s) => n + s.quotes.length, 0)} 条引语、{images.length} 张图片。
            <button className="link" onClick={() => setOutline(null)}>← 返回修改</button>
          </p>
          {(aiDocs.length > 0 || busy) && aiOn && (
            <>
              <h4 className="variants-title">
                AI 设计方案 · {ai?.name}
                <span className="row gap">
                  <input className="hint-input" value={hint} placeholder="风格要求" onChange={(e) => setHint(e.target.value)} />
                  <button disabled={!!busy} onClick={() => run(() => designWithAi(outline), 'AI 设计中…')} data-testid="redesign">{busy || '重新设计'}</button>
                </span>
              </h4>
              {aiDocs.length > 0 ? <div className="variant-grid">{aiDocs.map(card)}</div> : <p className="empty">{busy}</p>}
            </>
          )}
          <h4 className="variants-title">内置版式</h4>
          <div className="variant-grid">{builtin.map(card)}</div>
          <div className="modal-actions">
            <button onClick={() => choose((aiDocs[0] ?? builtin[0]).doc, [...aiDocs, ...builtin])}>全部保存为项目，并打开第一套</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
