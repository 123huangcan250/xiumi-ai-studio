// 标准名称下拉框（按类别分组）
import { ROLES, type RoleGroup, type RoleId } from '../core/roles'

const GROUPS: RoleGroup[] = ['标题', '文字', '图片', '装饰', '结尾', '其他']

export function RoleSelect({ value, onChange, allowEmpty, testId }: { value: RoleId | ''; onChange: (r: RoleId) => void; allowEmpty?: boolean; testId?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RoleId)} data-testid={testId}>
      {(allowEmpty || !value) && <option value="" disabled>请选择标准名称</option>}
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {ROLES.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id} title={r.hint}>{r.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
