import type { BlockPropsMap } from '../core/types'

type Alignment = NonNullable<BlockPropsMap['cover']['titleAlign']>
export function CoverTitleAlignment({ value, onChange }: { value?: Alignment; onChange: (value: Alignment) => void }) {
  return <label className="field"><span>封面标题对齐</span>
    <select value={value ?? 'auto'} onChange={(e) => onChange(e.target.value as Alignment)}>
      <option value="auto">跟随版式</option><option value="left">左对齐</option>
      <option value="center">居中</option><option value="right">右对齐</option>
    </select>
  </label>
}
