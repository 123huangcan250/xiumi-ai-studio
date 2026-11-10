// 三栏工作区：左右侧栏的宽度可以拖动调整（双击恢复默认，方向键微调），宽度记在本机浏览器里。
import { useEffect, useRef, useState, type ReactNode } from 'react'

const KEY = 'xiumi-panel-widths'
type Side = 'left' | 'right'
type Widths = Partial<Record<Side, number>>

export const PANEL_LIMITS: Record<Side, [number, number]> = { left: [200, 560], right: [240, 640] }
/** 中间的文章至少要留出的宽度 */
export const MIN_CENTER = 360

export const clampWidth = (side: Side, want: number, workspace: number, other: number) => {
  const [lo, hi] = PANEL_LIMITS[side]
  const room = Math.max(lo, workspace - other - MIN_CENTER)
  return Math.round(Math.min(Math.min(hi, room), Math.max(lo, want)))
}

/** 没有自己设宽度时，样式表里的默认值（窄屏用小一号） */
const defaultWidths = (): Record<Side, number> => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1100px)').matches ? { left: 210, right: 280 } : { left: 260, right: 320 })

/** 按工作区实际宽度，把用户设的宽度让到文章还够宽；工作区量不出宽度时原样返回 */
export function effectiveWidths(w: Widths, width: number, defaults = defaultWidths()): Widths {
  if (width <= 0) return w
  const out: Widths = {}
  if (w.left !== undefined) out.left = clampWidth('left', w.left, width, w.right ?? defaults.right)
  if (w.right !== undefined) out.right = clampWidth('right', w.right, width, out.left ?? defaults.left)
  return out
}

function load(): Widths {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const out: Widths = {}
    for (const side of ['left', 'right'] as Side[]) if (Number.isFinite(v?.[side])) out[side] = Math.min(PANEL_LIMITS[side][1], Math.max(PANEL_LIMITS[side][0], v[side]))
    return out
  } catch {
    return {}
  }
}

const save = (w: Widths) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(w))
  } catch {
    /* 隐私模式等拿不到本地存储：只是不记住宽度 */
  }
}

export function Workspace({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [widths, setWidths] = useState<Widths>(load)
  const [dragging, setDragging] = useState<Side | null>(null)
  // 拖动开始时的指针位置和侧栏宽度：按指针移动的距离改宽度，开始拖动时不会跳一下
  const start = useRef({ x: 0, w: 0 })
  const current = (side: Side) => {
    const el = ref.current
    if (!el) return PANEL_LIMITS[side][0]
    return parseFloat(getComputedStyle(el).getPropertyValue(`--${side === 'left' ? 'left' : 'right'}-w`)) || PANEL_LIMITS[side][0]
  }
  const set = (side: Side, want: number | null, persist = true) => {
    const el = ref.current
    setWidths((w) => {
      const next = { ...w }
      if (want === null) delete next[side]
      else next[side] = el ? clampWidth(side, want, el.clientWidth, w[side === 'left' ? 'right' : 'left'] ?? current(side === 'left' ? 'right' : 'left')) : want
      if (persist) save(next)
      return next
    })
  }
  // 工作区的实际宽度：窗口比上次小、或还没显示出来时，存下的宽度只在显示时让一让，不改掉用户设的值
  const [box, setBox] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const shown = effectiveWidths(widths, box)
  useEffect(() => {
    document.body.classList.toggle('resizing', dragging !== null)
    return () => document.body.classList.remove('resizing')
  }, [dragging])

  const handle = (side: Side) => (
    <div
      key={side}
      className={`panel-resizer ${side} ${dragging === side ? 'on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '拖动调整左侧栏宽度' : '拖动调整右侧栏宽度'}
      title="拖动调整宽度，双击恢复默认"
      tabIndex={0}
      data-testid={`resizer-${side}`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: current(side) }
        setDragging(side)
      }}
      onPointerMove={(e) => {
        if (dragging !== side) return
        const moved = e.clientX - start.current.x
        set(side, start.current.w + (side === 'left' ? moved : -moved), false)
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(null)
        setWidths((w) => (save(w), w))
      }}
      onDoubleClick={() => set(side, null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const grow = (e.key === 'ArrowRight') === (side === 'left') ? 1 : -1
        set(side, current(side) + grow * (e.shiftKey ? 48 : 16))
      }}
    />
  )
  return (
    <main
      className="workspace"
      ref={ref}
      style={{ ...(shown.left !== undefined && { ['--left-w' as string]: `${shown.left}px` }), ...(shown.right !== undefined && { ['--right-w' as string]: `${shown.right}px` }) }}
    >
      {children}
      {handle('left')}
      {handle('right')}
    </main>
  )
}
