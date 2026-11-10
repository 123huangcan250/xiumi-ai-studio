import { useId, useState } from 'react'

interface Props {
  value: string
  suggestion: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Suggestions are drafts, never input values until explicitly accepted. */
export function SuggestionInput({ value, suggestion, onChange, disabled = false }: Props) {
  const hintId = useId()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const visible = !disabled && !value && !!suggestion && suggestion !== dismissed
  return <div className="ai-suggestion-input">
    <textarea
      aria-label="AI 修改指令"
      aria-describedby={hintId}
      rows={3}
      value={value}
      disabled={disabled}
      placeholder={visible ? suggestion : '例如：把第二章改成时间轴；给开头加一张数据卡片；整体语气更活泼但不改事实'}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (!visible || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault()
          onChange(suggestion)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDismissed(suggestion)
        }
      }}
    />
    <div id={hintId} className="hint">
      {visible ? <><span>AI 建议 · Tab 填入，Esc 忽略，也可直接输入。</span>{' '}<button type="button" className="link" onClick={() => onChange(suggestion)}>填入建议</button></> : '输入自己的修改要求；填入建议不会自动发送。'}
    </div>
  </div>
}
