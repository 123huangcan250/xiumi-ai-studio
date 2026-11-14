import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { rootStyle } from '../core/compiler'
import { displayHtml } from '../core/images'
import { guardHtml } from '../core/sanitize'
import { resolveTheme } from '../core/themes'
import { reviewItems, type ReviewItem } from './reviewDisplay'
import { useStore, type Proposal } from './store'
import './inline-review.css'

const ReviewContext = createContext<{ items: ReviewItem[]; proposal: Proposal | null }>({ items: [], proposal: null })
export function ReviewProvider({ children }: { children?: ReactNode }) {
  const proposal = useStore(s => s.proposal), doc = useStore(s => s.doc)
  const items = useMemo(() => proposal ? reviewItems(proposal, doc) : [], [proposal, doc])
  return <ReviewContext.Provider value={{ items, proposal }}>{children}</ReviewContext.Provider>
}

/** Script-free, non-interactive preview. Its DOM never enters the editable article or export. */
function SuggestionFrame({ item }: { item: ReviewItem }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)
  const [freezeUnsupported, setFreezeUnsupported] = useState(false)
  const cleanup = useRef<() => void>(() => {})
  useEffect(() => () => cleanup.current(), [])
  const html = useMemo(() => {
    const theme = resolveTheme(item.projected)
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src 'self' data:; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;overflow-wrap:anywhere}body{${rootStyle(theme)}}img{max-width:100%}a{pointer-events:none}</style></head><body>${guardHtml(displayHtml(item.html))}</body></html>`
  }, [item.html, item.projected])
  const measure = () => {
    cleanup.current()
    const doc = ref.current?.contentDocument
    if (!doc?.body) return
    // No script runs inside the iframe. The owning editor freezes only its display-copy
    // replay roots, using upstream final scene times; original/export playback stays intact.
    let unsupported = false
    for (const frame of item.replayFrames) {
      // Token and times are generated out-of-band by our renderer, not read from imported HTML.
      const wrapper = doc.querySelector(`[data-review-freeze="${frame.token}"]`)
      if (!wrapper) continue
      const roots = Array.from(wrapper.querySelectorAll('svg')).filter(svg => !svg.parentElement?.closest('svg'))
      roots.forEach((svg, i) => {
        const time = frame.times[i]
        if (!Number.isFinite(time) || time < 0 || time > 86400) return
        try {
          if (typeof svg.pauseAnimations !== 'function' || typeof svg.setCurrentTime !== 'function') { unsupported = true; return }
          svg.pauseAnimations(); svg.setCurrentTime(time)
        } catch { unsupported = true }
      })
    }
    setFreezeUnsupported(unsupported)
    let alive = true
    const resize = () => { if (alive) setHeight(Math.max(40, Math.ceil(doc.body.getBoundingClientRect().height), doc.body.scrollHeight)) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(doc.body)
    doc.addEventListener('load', resize, true)
    void doc.fonts?.ready.then(resize)
    resize()
    cleanup.current = () => { alive = false; observer?.disconnect(); doc.removeEventListener('load', resize, true) }
  }
  return <><iframe ref={ref} title={`修改建议：${item.title}`} sandbox="allow-same-origin" tabIndex={-1}
    aria-hidden="true" srcDoc={html} onLoad={measure} style={{ height }} className="review-frame" />
    {freezeUnsupported && <p role="status">此浏览器不支持静态定格，建议中的回放仅作自动播放预览。</p>}</>
}
function ReviewCard({ item, proposal }: { item: ReviewItem; proposal: Proposal }) {
  const card = useRef<HTMLElement>(null)
  const resolve = (status: 'accepted' | 'rejected') => {
    // Move focus to a surviving nearby review action, without jumping to the side panel.
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.review-accept:not(:disabled),.review-reject'))
    const next = buttons.find(button => !card.current?.contains(button) && !!((card.current?.compareDocumentPosition(button) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING))
    useStore.getState().resolveProposal(item.index, status, proposal)
    if (next?.isConnected) next.focus()
    else document.querySelector<HTMLElement>('[data-testid="review-progress"]')?.focus()
  }
  const meta = item.kind === 'setMeta' ? [
    `标题：${item.projected.title}`, `作者：${item.projected.author ?? ''}`, `摘要：${item.projected.digest ?? ''}`,
  ] : []
  return <>
    {(item.beforeHtml || item.beforeMeta) && <div className="review-original review-original-red review-global-original">
      <strong>当前{item.kind === 'setTheme' ? '文章主题' : '文章信息'}</strong>
      {item.beforeMeta && <p style={{ whiteSpace: 'pre-wrap' }}>{item.beforeMeta}</p>}
      {item.beforeHtml && <SuggestionFrame item={{ ...item, html: item.beforeHtml, projected: item.original!, replayFrames: item.beforeReplayFrames }} />}
    </div>}
    <section ref={card} className={`review-suggestion ${item.error ? 'review-stale' : ''}`} aria-label={item.title} data-review-index={item.index} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div className="review-bubble" role="group" aria-label={`${item.title}操作`}>
      <button className="review-accept" disabled={!!item.error} onClick={() => resolve('accepted')}>接受</button>
      <button className="review-reject" onClick={() => resolve('rejected')}>拒绝</button>
    </div>
    <strong className="review-caption">{item.kind === 'remove' ? '删除建议' : item.kind === 'insert' ? '新增模块' : item.kind === 'move' ? `移动至第 ${item.position ?? '?'} 位` : item.title}</strong>
    {item.reason && <p className="review-reason">{item.reason}</p>}
    {item.error ? <p role="status">{item.error}；请拒绝此建议后重新生成。</p> : <>
      {item.kind === 'remove' && <p>接受后删除上方整个红色模块；不会替换为新内容。</p>}
      {meta.map(text => <p key={text}>{text}</p>)}
      {item.replayFrames.length > 0 && <p>编辑回放在建议中显示静态成稿；原模块与导出的播放方式不变。</p>}
      {item.html && <><SuggestionFrame item={item} /><details className="review-readable"><summary>读取建议内容（辅助阅读）</summary><div>{new DOMParser().parseFromString(item.html, 'text/html').body.textContent}</div></details></>}
    </>}
  </section></>
}
/** Always mounted, even without proposals: editable BlockView and its selection survive. */
export function ReviewBlock({ id, children }: { id: string; children?: ReactNode }) {
  const { items, proposal } = useContext(ReviewContext)
  const own = items.filter(item => item.targetId === id)
  return <div className="review-block">
    <div className={own.length ? 'review-original review-original-red' : 'review-original'}>
      {children}
      {own.length > 0 && <span className="review-original-label">原模块 · 待审阅</span>}
    </div>
    {proposal && items.filter(item => item.attachmentId === id && item.targetId).map(item => <ReviewCard key={item.index} item={item} proposal={proposal} />)}
  </div>
}
/** Insertion cards are placed at their resolver-computed position; global/stale orphans at end. */
export function ReviewSlot({ beforeId }: { beforeId?: string }) {
  const { items, proposal } = useContext(ReviewContext)
  if (!proposal) return null
  return <>{items.filter(item => !item.targetId && item.beforeId === beforeId).map(item => <ReviewCard key={item.index} item={item} proposal={proposal} />)}</>
}
