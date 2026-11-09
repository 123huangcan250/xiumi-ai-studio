// 本次使用的模块：从选中的模板和收藏组件里，每个标准名称只取一个模块。
// 同名模块有多个时由用户选定（默认优先用单独挑选的组件），保证整篇推文风格统一。
import { Fragment, useEffect, useMemo, useState } from 'react'
import { blockMeta, normalizeBlocks } from '../core/blocks'
import { searchComponents, type LibraryComponent } from '../core/components'
import { kitLevels, type Kit } from '../core/assemble'
import { roleDef, ROLES, type RoleGroup, type RoleId } from '../core/roles'
import type { Block, Doc } from '../core/types'
import { api, type Template } from './api'
import { LazyPreview } from './ComponentLibrary'
import { componentRole } from './componentActions'
import { Modal } from './Modal'
import { templateRoles, TemplateModules, themeOf } from './TemplateModules'
import { useStore } from './store'

export interface Candidate {
  key: string
  role: RoleId
  block: Block
  from: string
  label: string
  theme: Pick<Doc, 'themeId' | 'themeOverrides'>
}
/** 标准名称 → 选中的候选 key；'none' 表示这个名称不使用 */
export type KitChoice = Partial<Record<RoleId, string>>

const PLAIN_THEME = { themeId: 'minimal-magazine' }

export function kitCandidates(templates: Template[], picked: string[], comps: LibraryComponent[], pickedComps: string[]): Candidate[] {
  const out: Candidate[] = []
  for (const id of picked) {
    const t = templates.find((x) => x.id === id)
    if (!t) continue
    const blocks = normalizeBlocks(t.blocks)
    const { roles } = templateRoles(t, blocks)
    blocks.forEach((b, i) => {
      if (roles[i] !== 'other') out.push({ key: `t:${t.id}:${b.id}`, role: roles[i], block: b, from: t.name, label: `#${i + 1} ${b.type === 'html' ? b.props.label : blockMeta(b.type).label}`, theme: themeOf(t) })
    })
  }
  for (const id of pickedComps) {
    const c = comps.find((x) => x.id === id)
    if (c) out.push({ key: `c:${c.id}`, role: componentRole(c), block: c.block, from: '组件库', label: c.name, theme: PLAIN_THEME })
  }
  return out
}

/** 每个名称的默认选择：单独挑选的组件优先，其次是先选的模板里的第一个 */
const defaultOf = (list: Candidate[]) => list.find((c) => c.key.startsWith('c:')) ?? list[0]

export function resolveKit(cands: Candidate[], choice: KitChoice): Kit {
  const kit: Kit = {}
  for (const r of ROLES) {
    const list = cands.filter((c) => c.role === r.id)
    if (!list.length || choice[r.id] === 'none') continue
    const c = list.find((x) => x.key === choice[r.id]) ?? defaultOf(list)
    kit[r.id] = { role: r.id, block: c.block, from: c.from }
  }
  return kit
}

function ComponentPicker({ comps, picked, onClose, onDone }: { comps: LibraryComponent[]; picked: string[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const notify = useStore((s) => s.notify)
  const [sel, setSel] = useState<string[]>(picked)
  const [text, setText] = useState('')
  const [group, setGroup] = useState<RoleGroup | ''>('')
  const shown = searchComponents(comps, { text }, (c) => componentRole(c)).filter((c) => !group || roleDef(componentRole(c)).group === group)
  const toggle = (c: LibraryComponent) => {
    if (sel.includes(c.id)) return setSel(sel.filter((x) => x !== c.id))
    const role = componentRole(c)
    // 同一个标准名称只能选一个组件
    const same = sel.find((id) => {
      const o = comps.find((x) => x.id === id)
      return o && componentRole(o) === role
    })
    if (same) notify(`「${roleDef(role).name}」只能用一个组件，已换成「${c.name}」`)
    setSel([...sel.filter((x) => x !== same), c.id])
  }
  return (
    <Modal title="从收藏组件选模块" onClose={onClose} width={1000}>
      <div className="row gap wrap">
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="搜索名称、标签、标准名称" />
        <div className="seg">
          {(['', '标题', '文字', '图片', '装饰', '结尾'] as (RoleGroup | '')[]).map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g || '全部'}</button>)}
        </div>
      </div>
      <p className="hint">每个标准名称只能选一个组件；选中的组件会替换模板里同名的模块。未分类的组件按自动识别的名称使用，可以在左侧「组件」里改。</p>
      <div className="tm-grid">
        {shown.map((c) => (
          <button key={c.id} className={`tm-card pick ${sel.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c)} data-testid="kit-component">
            <LazyPreview block={c.block} doc={PLAIN_THEME} tall />
            <div className="tm-info">
              <b>{roleDef(componentRole(c)).name}{!c.role && <small> · 自动识别</small>}</b>
              <small>{c.name}</small>
            </div>
          </button>
        ))}
        {!shown.length && <p className="empty">{comps.length ? '没有符合条件的组件' : '还没有收藏组件'}</p>}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={() => onDone(sel)} data-testid="kit-components-done">使用选中的 {sel.length} 个组件</button>
      </div>
    </Modal>
  )
}

export function KitPicker(props: {
  templates: Template[]
  picked: string[]
  setPicked: (ids: string[]) => void
  pickedComps: string[]
  setPickedComps: (ids: string[]) => void
  choice: KitChoice
  setChoice: (c: KitChoice) => void
  comps: LibraryComponent[]
}) {
  const { templates, picked, setPicked, pickedComps, setPickedComps, choice, setChoice, comps } = props
  const [viewing, setViewing] = useState<Template | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [open, setOpen] = useState<RoleId | ''>('')
  const cands = useMemo(() => kitCandidates(templates, picked, comps, pickedComps), [templates, picked, comps, pickedComps])
  const kit = useMemo(() => resolveKit(cands, choice), [cands, choice])
  const roles = ROLES.filter((r) => cands.some((c) => c.role === r.id))
  const levels = kitLevels(kit)
  const imageRoles = roles.filter((r) => r.group === '图片' && kit[r.id]).map((r) => r.name)
  return (
    <div className="tpl-box" data-testid="kit-picker">
      <h5>套用模板与组件</h5>
      {templates.length ? (
        <div className="row gap wrap">
          {templates.map((t) => (
            <span key={t.id} className={`chip tpl-chip ${picked.includes(t.id) ? 'on' : ''}`}>
              <button className="link" onClick={() => setPicked(picked.includes(t.id) ? picked.filter((x) => x !== t.id) : [...picked, t.id])} data-testid="pick-template">
                {t.name}
                <small>{t.blocks.length} 个模块</small>
              </button>
              <button className="link" title="查看模板里的模块和标准名称" onClick={() => setViewing(t)} data-testid="view-modules">模块</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="tpl-note">还没有模板。导入公众号推文时勾选「保存为模板」，或在「模板」里收藏当前整篇，就能在这里套用。</p>
      )}
      <div className="row gap wrap kit-comps">
        <button onClick={() => setChoosing(true)} data-testid="pick-components">＋ 从收藏组件选模块{pickedComps.length > 0 && `（${pickedComps.length}）`}</button>
        {pickedComps.map((id) => {
          const c = comps.find((x) => x.id === id)
          return c ? (
            <span key={id} className="chip on">
              {roleDef(componentRole(c)).name}：{c.name}
              <button className="link" onClick={() => setPickedComps(pickedComps.filter((x) => x !== id))}>✕</button>
            </span>
          ) : null
        })}
      </div>
      {cands.length > 0 && (
        <>
          <p className="tpl-note">
            本次使用的模块：标题 {levels} 级{imageRoles.length > 0 && ` · 图片版式：${imageRoles.join('、')}`}。只替换文字和照片，版式与装饰保持原样。
          </p>
          <table className="kit-table" data-testid="kit-table">
            <tbody>
              {roles.map((r) => {
                const list = cands.filter((c) => c.role === r.id)
                const cur = choice[r.id] === 'none' ? 'none' : (list.find((x) => x.key === choice[r.id]) ?? defaultOf(list)).key
                const shown = list.find((x) => x.key === cur)
                return (
                  <Fragment key={r.id}>
                    <tr className={cur === 'none' ? 'off' : ''}>
                      <th>
                        <button className="link" title="预览" onClick={() => setOpen(open === r.id ? '' : r.id)}>{open === r.id ? '▾' : '▸'} {r.name}</button>
                      </th>
                      <td>
                        <select value={cur} onChange={(e) => setChoice({ ...choice, [r.id]: e.target.value })} data-testid={`kit-choice-${r.id}`}>
                          {list.map((c) => <option key={c.key} value={c.key}>{c.from} · {c.label}</option>)}
                          <option value="none">不使用</option>
                        </select>
                        {list.length > 1 && <small> 同名 {list.length} 个，只用选中的一个</small>}
                      </td>
                    </tr>
                    {open === r.id && shown && (
                      <tr>
                        <td colSpan={2}>
                          <LazyPreview block={shown.block} doc={shown.theme} tall />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      {viewing && <TemplateModules template={viewing} onClose={() => setViewing(null)} />}
      {choosing && <ComponentPicker comps={comps} picked={pickedComps} onClose={() => setChoosing(false)} onDone={(ids) => { setPickedComps(ids); setChoosing(false) }} />}
    </div>
  )
}

/** 图片版式下拉框的选项（所选模块里有的） */
export function layoutOptions(kit: Kit): RoleId[] {
  return ROLES.filter((r) => r.group === '图片' && r.id !== 'imageText' && kit[r.id]).map((r) => r.id)
}

/** 在其他窗口里刷新组件列表 */
export function useComponents() {
  const [comps, setComps] = useState<LibraryComponent[]>([])
  useEffect(() => {
    const load = () => api.components().then(setComps).catch(() => {})
    load()
    window.addEventListener('components-changed', load)
    return () => window.removeEventListener('components-changed', load)
  }, [])
  return comps
}
