import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Low-frequency actions stay mounted; only their shell presentation changes. */
export function ToolbarMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={root} className="toolbar-overflow" data-open={open}>
      <button ref={trigger} type="button" className="toolbar-more" aria-expanded={open} aria-controls={id}
        data-testid="toolbar-more" onClick={() => setOpen(!open)}>更多</button>
      <div id={id} className="toolbar-secondary" onClick={event => {
        if ((event.target as Element).closest('button:not(.help-trigger)')) {
          // Modal captures this visible trigger, not the about-to-be-hidden action.
          trigger.current?.focus()
          setOpen(false)
        }
      }}>{children}</div>
    </div>
  )
}
