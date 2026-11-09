// 收藏组件：选择整块或子结构，确认名称、类别和来源。导入内容必须确认使用权。
import { useEffect, useMemo, useState } from 'react'
import { blockMeta, createBlock } from '../core/blocks'
import { compileBlock } from '../core/compiler'
import { makeDraft, normalizeTags, SOURCE_LABEL } from '../core/components'
import { fragmentLabel, fragmentStats, splitCandidates } from '../core/fragments'
import { displayHtml } from '../core/images'
import { guessRole, roleDef, type RoleId } from '../core/roles'
import { resolveTheme } from '../core/themes'
import type { Block, SourceKind } from '../core/types'
import { api } from './api'
import { parseDoc, type CollectRequest } from './componentActions'
import { Modal } from './Modal'
import { RoleSelect } from './RoleSelect'
import { useStore } from './store'

interface Option {
  key: string
  label: string
  html: string
  /** 子结构还是整块 */
  whole: boolean
  texts: number
  photos: number
  repeat: number
  depth: number
}

const firstLabel = (b: Block) => (b.type === 'html' ? b.props.label : blockMeta(b.type).label)
/** 选中范围的默认名称：点选的部分按内容命名，不用“画布上选中的部分” */
const defaultName = (o: Option, b: Block) => (o.whole ? firstLabel(b) : o.key === 'picked' ? fragmentLabel(o.html, parseDoc) : o.label)

function optionsOf(req: CollectRequest): Option[] {
  const b = req.block
  if (b.type !== 'html') return [{ key: 'whole', label: `整个模块（${blockMeta(b.type).label}）`, html: '', whole: true, texts: 0, photos: 0, repeat: 1, depth: 0 }]
  const stat = (html: string) => {
    const s = fragmentStats(html, parseDoc)
    return { texts: s.texts, photos: s.photos + s.bgPhotos }
  }
  const whole: Option = { key: 'whole', label: '整个模块', html: b.props.html, whole: true, repeat: 1, depth: 0, ...stat(b.props.html) }
  if (req.fragment) return [{ key: 'picked', label: '画布上选中的部分', html: req.fragment, whole: false, repeat: 1, depth: 0, ...stat(req.fragment) }, whole]
  const parts = splitCandidates(b.props.html, parseDoc).map((f, i): Option => ({ key: `f${i}`, label: f.label, html: f.html, whole: false, texts: f.texts, photos: f.photos + f.bgPhotos, repeat: f.repeat, depth: f.depth }))
  return [whole, ...parts]
}

function CollectModal({ req, onClose }: { req: CollectRequest; onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const notify = useStore((s) => s.notify)
  const theme = useMemo(() => resolveTheme(doc), [doc])
  const options = useMemo(() => optionsOf(req), [req])
  const seed = req.block.type === 'html' ? req.block.props.source : undefined
  const imported = req.block.type === 'html'
  const [index, setIndex] = useState(0)
  const opt = options[index]
  const [name, setName] = useState(() => defaultName(opt, req.block))
  const blockOf = (o: Option): Block => (req.block.type === 'html' ? createBlock('html', { html: o.html, label: name, ...(source() && { source: source() }) }) : req.block)
  // 标准名称：先自动识别，用户确认或修改后才能收藏
  const [role, setRole] = useState<RoleId>(() => guessRole(req.block.type === 'html' ? createBlock('html', { html: opt.html }) : req.block, { parse: parseDoc, label: defaultName(opt, req.block) }))
  const [roleTouched, setRoleTouched] = useState(false)
  const [tags, setTags] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>(seed?.kind ?? req.source?.kind ?? (imported ? 'other' : 'original'))
  const [title, setTitle] = useState(seed?.title ?? req.source?.title ?? doc.title)
  const [url, setUrl] = useState(seed?.url ?? req.source?.url ?? '')
  const [attested, setAttested] = useState(false)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  function source() {
    return { kind: sourceKind, title: title.trim(), url: url.trim(), account: seed?.account ?? req.source?.account ?? '' }
  }
  const choose = (i: number) => {
    const o = options[i]
    setIndex(i)
    setName(defaultName(o, req.block))
    if (req.block.type === 'html' && !roleTouched) setRole(guessRole(createBlock('html', { html: o.html }), { parse: parseDoc, label: defaultName(o, req.block) }))
  }
  const preview = useMemo(() => displayHtml(compileBlock(req.block.type === 'html' ? createBlock('html', { html: opt.html }) : req.block, theme)), [req.block, opt, theme])
  const save = async () => {
    setBusy(true)
    try {
      const draft = makeDraft(
        { name, role, tags: normalizeTags(tags.split(/[\s,，、]+/)), block: blockOf(opt), source: source(), via: opt.whole ? req.via : 'fragment', attested: imported ? attested : true },
        parseDoc,
      )
      const r = await api.saveComponent(draft)
      setSaved((s) => new Set(s).add(opt.key))
      window.dispatchEvent(new Event('components-changed'))
      notify(r.duplicate ? `已有结构相同的组件「${r.component.name}」，没有重复收藏` : `已收藏组件「${name.trim() || '未命名组件'}」`)
      if (options.length === 1) onClose()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="收藏为组件" onClose={onClose} width={980}>
      <div className="article-import">
        <div className="article-preview">
          <div className="mini-preview tall">
            <div className="mini-inner" dangerouslySetInnerHTML={{ __html: preview }} data-testid="collect-preview" />
          </div>
        </div>
        <div className="article-options">
          {options.length > 1 && (
            <div className="field">
              <span>收藏范围{options.length > 2 && ' · 下面是按结构拆出的版块，可逐个收藏'}</span>
              <div className="split-list" data-testid="split-list">
                {options.map((o, i) => (
                  <button key={o.key} className={i === index ? 'on' : ''} style={{ paddingLeft: 8 + o.depth * 12 }} onClick={() => choose(i)} data-testid={`split-${i}`}>
                    <b>{o.label}</b>
                    <small>
                      {o.texts} 处文字 · {o.photos} 张图{o.repeat > 1 && ` · 重复 ${o.repeat} 次`}
                      {saved.has(o.key) && ' · 已收藏'}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field"><span>名称</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="collect-name" /></label>
          <label className="field">
            <span>标准名称（必选，套用模板时按名称取用：{roleDef(role).hint}）</span>
            <RoleSelect value={role} onChange={(r) => { setRole(r); setRoleTouched(true) }} testId="collect-role" />
            {!roleTouched && <small className="hint">已自动识别为「{roleDef(role).name}」，请确认</small>}
          </label>
          <label className="field"><span>标签（空格分隔，用于检索）</span><input value={tags} placeholder="例如：活动 绿色 轮播" onChange={(e) => setTags(e.target.value)} data-testid="collect-tags" /></label>
          {imported && (
            <>
              <div className="field">
                <span>内容来源</span>
                <div className="seg">
                  {(['wechat', 'xiumi', 'original', 'other'] as SourceKind[]).map((k) => (
                    <button key={k} className={sourceKind === k ? 'on' : ''} onClick={() => setSourceKind(k)}>{SOURCE_LABEL[k]}</button>
                  ))}
                </div>
              </div>
              <label className="field"><span>来源标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field"><span>来源链接（可不填）</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
              <label className="check">
                <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} data-testid="collect-attest" />
                我确认对这段内容拥有使用权或已获授权。组件只保存在本机，不会分享给他人。
              </label>
            </>
          )}
          <div className="modal-actions">
            <button onClick={onClose} data-testid="collect-close">{saved.size ? '完成' : '取消'}</button>
            <button className="primary" disabled={busy || (imported && !attested)} onClick={save} data-testid="collect-save">收藏</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** 监听收藏请求（画布工具栏、点选、模板部件都走这里） */
export function CollectHost() {
  const [req, setReq] = useState<CollectRequest | null>(null)
  useEffect(() => {
    const open = (e: Event) => setReq((e as CustomEvent<CollectRequest>).detail)
    window.addEventListener('open-collect', open)
    return () => window.removeEventListener('open-collect', open)
  }, [])
  return req ? <CollectModal key={req.block.id + (req.fragment?.length ?? 0)} req={req} onClose={() => setReq(null)} /> : null
}
