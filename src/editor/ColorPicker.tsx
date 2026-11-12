import { useEffect, useRef, useState } from 'react'
import { toHex } from '../core/color'

export interface Swatch {
  color: string
  label: string
}

/** 常用文字颜色：深浅灰和几种不刺眼的彩色 */
export const COMMON_COLORS: Swatch[] = [
  { color: '#000000', label: '黑色' },
  { color: '#3f3f3f', label: '深灰' },
  { color: '#888888', label: '浅灰' },
  { color: '#ffffff', label: '白色' },
  { color: '#c0392b', label: '红色' },
  { color: '#e67e22', label: '橙色' },
  { color: '#d4a017', label: '金色' },
  { color: '#27ae60', label: '绿色' },
  { color: '#2e86de', label: '蓝色' },
  { color: '#1f3a93', label: '深蓝' },
  { color: '#8e44ad', label: '紫色' },
  { color: '#e84393', label: '粉色' },
]

interface Props {
  /** 当前颜色（任意 CSS 写法）；没有时为跟随外层 */
  value?: string | null
  /** 排在常用色前面的分组，如主题色、片段原有配色 */
  groups?: { label: string; colors: Swatch[] }[]
  /** null 表示去掉颜色 */
  onPick: (color: string | null) => void
  /** 弹出层靠右展开（按钮在面板右侧时用） */
  alignRight?: boolean
  testId?: string
}

/**
 * 文字颜色选择：主题色、常用色、自定义取色，以及“默认颜色”。
 * 按钮在 mousedown 时阻止默认行为，富文本编辑器里的选区不会丢；点击（含键盘）才执行。
 */
export function ColorPicker({ value, groups = [], onPick, alignRight = false, testId = 'color-picker' }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const custom = useRef<HTMLInputElement>(null)
  const current = value ? toHex(value) : undefined
  const pick = (c: string | null) => {
    onPick(c)
    setOpen(false)
  }
  const pickRef = useRef(pick)
  pickRef.current = pick

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    // 打开时 Esc 只关闭取色板：焦点常留在富文本里，捕获阶段先拦下，编辑器不会跟着退出
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', esc, true)
    // 自定义取色：拖动时不提交，关闭系统取色器（change）后才应用一次
    const input = custom.current
    const change = () => input && pickRef.current(input.value)
    input?.addEventListener('change', change)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', esc, true)
      input?.removeEventListener('change', change)
    }
  }, [open])

  const swatch = (s: Swatch, i: number) => (
    <button
      key={`${s.color}-${i}`}
      type="button"
      className={`color-swatch ${current && current === toHex(s.color) ? 'on' : ''}`}
      style={{ background: s.color }}
      title={`${s.label} ${s.color}`}
      aria-label={s.label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(s.color)}
    />
  )
  return (
    <span className="color-picker" ref={box}>
      <button
        type="button"
        className="color-btn"
        title="文字颜色"
        aria-label="文字颜色"
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        data-testid={testId}
      >
        <span className="color-a" style={{ borderBottomColor: current ?? '#c8c8c8' }}>A</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className={`color-pop ${alignRight ? 'right' : ''}`} aria-label="选择文字颜色" data-testid={`${testId}-pop`}>
          {[...groups, { label: '常用色', colors: COMMON_COLORS }]
            .filter((g) => g.colors.length)
            .map((g) => (
              <div key={g.label} className="color-group">
                <small>{g.label}</small>
                <div className="swatches">{g.colors.map(swatch)}</div>
              </div>
            ))}
          <div className="color-foot">
            <label title="自定义颜色">
              <input ref={custom} type="color" defaultValue={current ?? '#333333'} data-testid={`${testId}-custom`} />
              自定义
            </label>
            <button type="button" className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(null)} data-testid={`${testId}-reset`}>
              默认颜色
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
