import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

type Model = { id: string; contextWindow?: number }
export function ModelPicker({ models, value, disabled, onSelect }: { models: Model[]; value: string; disabled?: boolean; onSelect: (id: string) => void }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = models.findIndex(m => m.id === value)
  const close = (restore = false) => {
    setOpen(false)
    if (restore) trigger.current?.focus({ preventScroll: true })
  }
  const show = (index = selected >= 0 ? selected : 0) => {
    if (disabled || !models.length) return
    setActive(index)
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const box = list.current
    box?.focus({ preventScroll: true })
    // Reveal only on opening; cursor movement below scrolls the list, never the page.
    const body = box?.closest<HTMLElement>('.modal-body')
    if (box && body) {
      const inner = box.getBoundingClientRect()
      const outer = body.getBoundingClientRect()
      const top = outer.top + body.clientTop
      const bottom = top + body.clientHeight
      if (inner.bottom > bottom) body.scrollTop += inner.bottom - bottom
      else if (inner.top < top) body.scrollTop -= top - inner.top
    }
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (!open) return
    const box = list.current
    const item = box?.children[active] as HTMLElement | undefined
    if (!box || !item) return
    const outer = box.getBoundingClientRect()
    const inner = item.getBoundingClientRect()
    if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom
  }, [open, active])
  const choose = (index: number) => {
    const model = models[index]
    if (!model || disabled) return
    onSelect(model.id)
    close(true)
  }
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) show(event.key === 'End' || (event.key === 'ArrowUp' && selected < 0) ? models.length - 1 : event.key === 'Home' ? 0 : selected >= 0 ? selected : 0)
      else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? models.length - 1 : Math.max(0, Math.min(models.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (open && (event.key === 'Enter' || event.key === ' ') && event.target === list.current) {
      event.preventDefault(); choose(active)
    }
  }
  return <div className="model-picker field" ref={root} data-model-picker-open={open || undefined} onKeyDown={keys}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close() }}>
    <span id={id + '-label'}>可用模型（也可在上方手动填写）</span>
    <button className="model-picker-trigger" ref={trigger} type="button" disabled={disabled} data-testid="ai-model-picker"
      aria-label={'可用模型：' + (selected >= 0 ? value : '请选择模型')} aria-haspopup="listbox" aria-expanded={open} aria-controls={id + '-list'}
      onClick={() => open ? close() : show()}>
      <span className="model-picker-value">{selected >= 0 ? value : `请选择模型（${models.length} 个）`}</span>
      <span className="model-picker-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="model-picker-list" id={id + '-list'} ref={list} role="listbox" aria-label="可用模型" tabIndex={0}
      aria-activedescendant={id + '-option-' + active}>
      {models.map((model, index) => <div key={model.id} id={id + '-option-' + index} className="model-picker-option"
        role="option" aria-selected={model.id === value} data-active={index === active} title={model.id}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {model.id}{model.contextWindow ? `（${model.contextWindow} tokens）` : ''}
      </div>)}
    </div>}
  </div>
}
