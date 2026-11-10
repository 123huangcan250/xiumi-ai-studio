import { useEffect, useRef, type ReactNode } from 'react'

const focusable = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, children, onClose, width = 560 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement as HTMLElement | null
    const isTop = () => [...document.querySelectorAll('[role="dialog"]')].at(-1) === dialog
    const items = () => [...dialog.querySelectorAll<HTMLElement>(focusable)].filter(el => !el.hidden && !el.closest('[hidden]') && el.closest('[role="dialog"]') === dialog)
    if (isTop()) (items()[0] ?? dialog).focus()
    const k = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close.current()
      } else if (e.key === 'Tab') {
        const all = items()
        const first = all[0] ?? dialog
        const last = all.at(-1) ?? dialog
        if (!dialog.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        }
      }
    }
    window.addEventListener('keydown', k, true)
    return () => {
      window.removeEventListener('keydown', k, true)
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header>
          <h3>{title}</h3>
          <button className="close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
