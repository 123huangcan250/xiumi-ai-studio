import { CoverTitleAlignment } from './CoverTitleAlignment'
import { blockTextFields, textFieldPatch } from '../core/blockTextEditing'
import type { Block } from '../core/types'

/** Keep the rendered block visible; update text only, never reconstruct images. */
export function BlockTextEditor({ block, onChange, onDone }: {
  block: Block
  onChange: (props: Record<string, unknown>, field: string) => void
  onDone: () => void
}) {
  return (
    <div className="props-form" data-testid="inline-block-text" style={{ padding: 12, background: '#fff' }}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() } }}>
      <p className="hint">正在编辑文字，图片和版式保持不变。修改自动保存，可撤销。</p>
      {blockTextFields(block).map((field, i) => (
        <label key={field.key} className="field"><span>{field.label}</span>
          <textarea autoFocus={i === 0} rows={2} value={field.value} onChange={(e) => onChange(textFieldPatch(block, field.key, e.target.value), field.key)} />
        </label>
      ))}
      {block.type === 'cover' && <CoverTitleAlignment value={block.props.titleAlign} onChange={(v) => onChange({ titleAlign: v }, 'titleAlign')} />}
      <button type="button" onClick={onDone}>完成</button>
    </div>
  )
}
