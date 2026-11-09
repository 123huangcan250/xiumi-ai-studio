// 排版前确认：文案标题级别多于标题模块、指定的句子找不到、同一句后面有多张照片、组的张数没有对应版式。
import { LEVEL_NAMES } from '../core/copy'
import type { Crowd, PlanCheck } from '../core/photoPlan'
import { roleDef, type RoleId } from '../core/roles'

export function PlanIssues(props: {
  check: PlanCheck
  aiOn: boolean
  /** 进行中的操作说明，空串表示空闲 */
  busy: string
  crowd: Record<string, Crowd>
  setCrowd: (f: (c: Record<string, Crowd>) => Record<string, Crowd>) => void
  singlesFor: Set<string>
  setSinglesFor: (f: (s: Set<string>) => Set<string>) => void
  onFlatten: () => void
  onAiFlatten: () => void
  onClearAnchor: (key: string) => void
  onContinue: () => void
  onCancel: () => void
}) {
  const { check, aiOn, busy, crowd, setCrowd, singlesFor, setSinglesFor } = props
  const nos = (ps: number[]) => ps.map((i) => i + 1).join('、')
  const crowdOk = (after: string, layouts: RoleId[]) => {
    const d = crowd[after]
    return !!d && (d.mode === 'singles' || (d.mode === 'group' && layouts.includes(d.layout)) || (d.mode === 'ai' && !!d.request.trim()))
  }
  const ready = !check.levels && !check.unmatched.length && check.crowded.every((c) => crowdOk(c.after, c.layouts)) && check.noLayout.every((u) => singlesFor.has(u.key))

  return (
    <div className="plan-issues" data-testid="plan-issues">
      <h5>排版前需要确认</h5>
      {!check.levels && !check.unmatched.length && !check.crowded.length && !check.noLayout.length && <p className="hint">问题都已处理，可以继续排版。</p>}
      {check.levels && (
        <div className="issue" data-testid="issue-levels">
          <p>
            文案用了 <b>{check.levels.copy}</b> 级标题，所选模块只有 <b>{check.levels.kit}</b> 级标题模块（{LEVEL_NAMES.slice(0, check.levels.kit).join('、') || '没有标题模块'}）。
            请增加标题模块，或减少文案的标题级别。
          </p>
          <div className="row gap wrap">
            <span className="hint">增加：在上方「从收藏组件选模块」里加入{LEVEL_NAMES[check.levels.kit]}组件，或在模板「模块」里把某个模块改为{LEVEL_NAMES[check.levels.kit]}。</span>
          </div>
          <div className="row gap wrap">
            <button onClick={props.onFlatten} data-testid="flatten-levels">把{LEVEL_NAMES.slice(check.levels.kit, check.levels.copy).join('、')}改为加粗正文</button>
            {aiOn && <button disabled={!!busy} onClick={props.onAiFlatten} data-testid="ai-flatten">让 AI 把文案改成 {check.levels.kit} 级标题</button>}
          </div>
        </div>
      )}
      {check.unmatched.map((u) => (
        <div key={u.key} className="issue" data-testid="issue-unmatched">
          <p>照片 {nos(u.photos)} 指定的句子「{u.anchor}」在正文里找不到。请从正文里重新复制这句话，或者：</p>
          <button onClick={() => props.onClearAnchor(u.key)}>不指定位置，自动安排</button>
        </div>
      ))}
      {check.crowded.map((c) => {
        const d = crowd[c.after]
        const set = (v: Crowd) => setCrowd((x) => ({ ...x, [c.after]: v }))
        return (
          <div key={c.after} className="issue" data-testid="issue-crowded">
            <p>
              「{c.anchor.length > 30 ? c.anchor.slice(0, 30) + '…' : c.anchor}」（{c.section}）后面有 <b>{c.photos.length}</b> 张单独的照片（照片 {nos(c.photos)}）。怎么排？
            </p>
            <label className="check">
              <input type="radio" checked={d?.mode === 'singles'} onChange={() => set({ mode: 'singles' })} data-testid="crowd-singles" />
              全部用单图，依次排列
            </label>
            <label className="check">
              <input type="radio" checked={d?.mode === 'group'} disabled={!c.layouts.length} onChange={() => set({ mode: 'group', layout: c.layouts[0] })} data-testid="crowd-group" />
              {c.layouts.length ? '组成多图：' : `组成多图（所选模块里没有 ${c.photos.length} 图版式）`}
              {d?.mode === 'group' && (
                <select value={d.layout} onChange={(e) => set({ mode: 'group', layout: e.target.value as RoleId })} data-testid="crowd-layout">
                  {c.layouts.map((r) => <option key={r} value={r}>{roleDef(r).name}</option>)}
                </select>
              )}
            </label>
            <label className="check">
              <input type="radio" checked={d?.mode === 'ai'} disabled={!aiOn} onChange={() => set({ mode: 'ai', request: d?.mode === 'ai' ? d.request : '' })} data-testid="crowd-ai" />
              {aiOn ? '其他要求，交给 AI：' : '其他要求（需要配置 AI 模型）'}
            </label>
            {d?.mode === 'ai' && <input value={d.request} onChange={(e) => set({ mode: 'ai', request: e.target.value })} placeholder="例如：前两张左右并排，第三张单独放大" data-testid="crowd-request" />}
          </div>
        )
      })}
      {check.noLayout.map((u) => (
        <div key={u.key} className="issue" data-testid="issue-nolayout">
          <p>一组 {u.photos.length} 张照片（照片 {nos(u.photos)}）在所选模块里没有对应的 {u.photos.length} 图版式。可以在「从收藏组件选模块」里加入对应的图片组件，或者：</p>
          <label className="check">
            <input type="checkbox" checked={singlesFor.has(u.key)} onChange={(e) => setSinglesFor((s) => { const n = new Set(s); if (e.target.checked) n.add(u.key); else n.delete(u.key); return n })} />
            这一组改为单图依次排列
          </label>
        </div>
      ))}
      <div className="modal-actions">
        <button onClick={props.onCancel}>返回修改</button>
        <button className="primary" disabled={!ready || !!busy} onClick={props.onContinue} data-testid="plan-continue">{busy || '继续排版'}</button>
      </div>
    </div>
  )
}
