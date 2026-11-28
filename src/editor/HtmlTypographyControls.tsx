import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { TEXT_FONTS, TEXT_SIZES } from '../core/textTypography'
import { preserveAdjacentText, restoreTextRange, styledSelectionHtml, textRangeWithinRegion } from './importedTextSelection'
import './rich-typography.css'

const MARKS = [['bold', 'B', '加粗'], ['italic', 'I', '斜体'], ['underline', 'U', '下划线']] as const
const SELECT_TEXT = '先选中原文中的文字'
type Mark = typeof MARKS[number][0]
type Command = Mark | 'fontFamily' | 'fontSize' | 'foreColor'
const readMarks = (): Record<string, boolean | 'mixed'> => Object.fromEntries(MARKS.map(([command]) =>
  [command, document.queryCommandIndeterm?.(command) ? 'mixed' as const : document.queryCommandState?.(command) ?? false]))

/** Reuse native editing transactions so the browser can undo typography. */
export function HtmlTypographyControls({ rootRef, onCommit }: { rootRef: RefObject<HTMLDivElement | null>; onCommit: () => void }) {
  const toolbar = useRef<HTMLSpanElement>(null)
  const saved = useRef<{ range: Range; html: string } | null>(null)
  const [available, setAvailable] = useState(false)
  const [marks, setMarks] = useState<Record<string, boolean | 'mixed'>>({})
  const [message, setMessage] = useState(SELECT_TEXT)
  useEffect(() => {
    const capture = () => {
      const root = rootRef.current
      if (!root || toolbar.current?.contains(document.activeElement)) return
      const selection = document.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const valid = range && !range.collapsed && !!range.toString().trim() &&
        root.contains(range.startContainer) && root.contains(range.endContainer)
      saved.current = valid ? { range: range.cloneRange(), html: root.innerHTML } : null
      setAvailable(!!valid)
      setMarks(valid ? readMarks() : {})
      setMessage(valid ? '仅调整选中文字' : SELECT_TEXT)
    }
    document.addEventListener('selectionchange', capture)
    return () => document.removeEventListener('selectionchange', capture)
  }, [rootRef])

  function apply(command: Command, value = '') {
    const root = rootRef.current
    const snapshot = saved.current
    if (!root || !snapshot || root.innerHTML !== snapshot.html) {
      saved.current = null
      setMessage('选区已变化，请重新选择文字')
      setAvailable(false)
      return
    }
    if (!textRangeWithinRegion(root, snapshot.range)) {
      setMessage('请在同一个文本区域内选择，避免修改链接或原文结构')
      return
    }
    if (command === 'foreColor' && !/^#[0-9a-f]{6}$/i.test(value)) return
    const font = command === 'fontFamily' || command === 'fontSize'
    const html = font ? styledSelectionHtml(root, snapshot.range, command, value) : null
    if (font && !html) return
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(snapshot.range.startContainer, snapshot.range.startOffset)
    const start = prefix.toString().length
    const length = snapshot.range.toString().length
    const target = html ? preserveAdjacentText(snapshot.range, html) : { range: snapshot.range, html: value }
    if (!target) {
      setMessage('请在同一个文本区域内选择，避免改变原文空白布局')
      return
    }
    root.focus()
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(target.range)
    if (!document.execCommand?.(font ? 'insertHTML' : command, false, target.html)) {
      setMessage('此浏览器不支持该文字格式操作')
      return
    }
    const restored = restoreTextRange(root, start, length)
    selection.removeAllRanges()
    selection.addRange(restored)
    onCommit()
    saved.current = { range: restored.cloneRange(), html: root.innerHTML }
    setMarks(readMarks())
    setMessage('已应用，可继续调整选中文字或撤销')
  }

  function onToolbarKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    event.stopPropagation()
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    const root = rootRef.current
    if (!root) return
    event.preventDefault()
    root.focus()
    if (document.execCommand?.(key === 'y' || event.shiftKey ? 'redo' : 'undo')) onCommit()
  }

  return <span ref={toolbar} className="rich-typography-controls imported-typography-controls" onKeyDown={onToolbarKeyDown}>
    <label>字体<select aria-label="原文字体" disabled={!available} value="" onChange={e => { apply('fontFamily', e.target.value); e.currentTarget.focus() }}>
      <option value="">选择字体</option>{TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
    </select></label>
    <label>字号<select aria-label="原文字号" disabled={!available} value="" onChange={e => { apply('fontSize', e.target.value); e.currentTarget.focus() }}>
      <option value="">选择字号</option>{TEXT_SIZES.map(n => <option key={n} value={n + 'px'}>{n}px</option>)}
    </select></label>
    {MARKS.map(([command, label, name]) =>
      <button type="button" key={command} aria-label={'原文' + name} title={name} aria-pressed={marks[command] ?? false}
        className={marks[command] === true ? 'on' : ''} disabled={!available} onMouseDown={e => e.preventDefault()}
        onClick={e => { apply(command); e.currentTarget.focus() }}>{label}</button>)}
    <label>文字颜色<input type="color" aria-label="原文文字颜色" disabled={!available} defaultValue="#222222"
      onChange={e => { apply('foreColor', e.target.value); e.currentTarget.focus() }} /></label>
    <span className="rich-typography-hint" role="status">{message}</span>
  </span>
}
