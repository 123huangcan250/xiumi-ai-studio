// 查看模板的模块：每个模块配预览和标准名称（自动识别，可以改），保存后套用模板时按名称取模块。
import { useMemo, useState } from 'react'
import { normalizeBlocks } from '../core/blocks'
import { guessTemplateRoles, roleDef, type RoleId } from '../core/roles'
import type { Block } from '../core/types'
import { api, type Template } from './api'
import { LazyPreview } from './ComponentLibrary'
import { parseDoc } from './componentActions'
import { Modal } from './Modal'
import { RoleSelect } from './RoleSelect'
import { useStore } from './store'

export const themeOf = (t: Template) => ({ themeId: t.themeId ?? 'minimal-magazine', themeOverrides: t.themeOverrides })

/** 模板各模块的标准名称：保存过的用保存的，没有的自动识别 */
export function templateRoles(t: Template, blocks: Block[] = normalizeBlocks(t.blocks)): { roles: RoleId[]; confirmed: boolean[] } {
  const guessed = guessTemplateRoles(blocks, { parse: parseDoc })
  return { roles: blocks.map((b, i) => t.roles?.[b.id] ?? guessed[i]), confirmed: blocks.map((b) => !!t.roles?.[b.id]) }
}

export function TemplateModules({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved?: (t: Template) => void }) {
  const notify = useStore((s) => s.notify)
  const blocks = useMemo(() => normalizeBlocks(template.blocks), [template])
  const initial = useMemo(() => templateRoles(template, blocks), [template, blocks])
  const [roles, setRoles] = useState<RoleId[]>(initial.roles)
  const [busy, setBusy] = useState(false)
  const count = (r: RoleId) => roles.filter((x) => x === r).length
  const dirty = roles.some((r, i) => r !== initial.roles[i]) || initial.confirmed.some((c) => !c)

  const save = async () => {
    setBusy(true)
    try {
      const t = await api.updateTemplate(template.id, { roles: Object.fromEntries(blocks.map((b, i) => [b.id, roles[i]])) })
      window.dispatchEvent(new Event('templates-changed'))
      notify('已保存模块的标准名称')
      onSaved?.(t)
      onClose()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`模板模块 · ${template.name}`} onClose={onClose} width={1080}>
      <p className="hint">
        每个模块都归到一个标准名称下，套用时按名称取用：标题按级别用对应的标题模块，几张照片放在一起就用对应张数的图片版式。名称是自动识别的，不对就改。
        同名的模块有多个时，套用前在「本次使用的模块」里选一个；设为「其他」的模块不会被使用。
      </p>
      <div className="tm-grid" data-testid="template-modules">
        {blocks.map((b, i) => (
          <div key={b.id} className="tm-card" data-testid="template-module">
            <LazyPreview block={b} doc={themeOf(template)} tall />
            <div className="tm-info">
              <RoleSelect value={roles[i]} onChange={(r) => setRoles((list) => list.map((x, j) => (j === i ? r : x)))} testId={`module-role-${i}`} />
              <small title={roleDef(roles[i]).hint}>
                #{i + 1} {b.type === 'html' ? b.props.label : ''}
                {!initial.confirmed[i] && roles[i] === initial.roles[i] && ' · 自动识别'}
                {roles[i] !== 'other' && count(roles[i]) > 1 && <em> · 同名 {count(roles[i])} 个</em>}
              </small>
            </div>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || !dirty} onClick={save} data-testid="save-module-roles">保存标准名称</button>
      </div>
    </Modal>
  )
}
