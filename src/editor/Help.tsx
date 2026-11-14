import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Explanations are opt-in; never put errors, consent or essential instructions here. */
export function Help({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const note = useRef<HTMLSpanElement>(null)
  const keyboard = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const clear = useCallback(() => { clearTimeout(timer.current); timer.current = undefined }, [])
  const show = () => {
    clear()
    setOpen(true)
  }
  const hide = useCallback(() => { clear(); setOpen(false) }, [clear])
  useLayoutEffect(() => {
    if (!open) return
    const box = ref.current?.getBoundingClientRect()
    const popup = note.current?.getBoundingClientRect()
    if (!box || !popup) return
    const top = box.bottom + 6 + popup.height <= window.innerHeight - 8 ? box.bottom + 6 : box.top - popup.height - 6
    setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - popup.width - 8)), top: Math.max(8, top) })
  }, [open])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Tab') keyboard.current = true }
    const pointer = () => { keyboard.current = false }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', pointer, true)
    return () => { clearTimeout(timer.current); window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', pointer, true) }
  }, [])
  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => { if (!(e.target instanceof Node) || (!ref.current?.contains(e.target) && !note.current?.contains(e.target))) hide() }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hide() } }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    const scroll = (e: Event) => { if (!(e.target instanceof Node) || !note.current?.contains(e.target)) hide() }
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', hide); window.removeEventListener('scroll', scroll, true) }
  }, [open, hide])
  return <span className="help" ref={ref} onMouseEnter={() => { clear(); timer.current = setTimeout(show, 650) }} onMouseLeave={() => { clear(); if (!ref.current?.contains(document.activeElement)) timer.current = setTimeout(() => setOpen(false), 160) }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hide() }}>
    <button type="button" className="help-trigger" aria-label={`${title}说明`} aria-expanded={open} aria-describedby={open ? id : undefined}
      onFocus={(e) => { if (keyboard.current || e.currentTarget.matches(':focus-visible')) show() }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open) hide(); else show() }}>
      {title}<span className="help-mark" aria-hidden="true"> ⓘ</span>
    </button>
    {open && createPortal(<span ref={note} id={id} role="tooltip" data-help-open className="help-note" style={position} onMouseEnter={clear} onMouseLeave={hide}>{children}</span>, document.body)}
  </span>
}
