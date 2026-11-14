import { useEffect, useRef, useState } from 'react'
import { clampImageWidth } from '../core/imageResize'
import { resizePhoto, resolveResizeTarget } from './imageResizeTarget'
import { findBlock } from '../core/tree'
import type { Block } from '../core/types'
import { useStore } from './store'
import './ImageResize.css'

/** Editor-only sibling of the article; drag previews never enter history or output. */
export function ImageResize() {
  const selected = useStore((s) => s.selectedId)
  const doc = useStore((s) => s.doc)
  const editing = useStore((s) => s.editingId || s.pickingId)
  const [target, setTarget] = useState<{ blockId: string; index: number; docId: string } | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [handlePosition, setHandlePosition] = useState({ left: 0, top: 0 })
  const [width, setWidth] = useState(100)
  const handle = useRef<HTMLButtonElement>(null)
  const measuredImage = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ img: HTMLImageElement; original: string | null; block: Block; parentWidth: number; startX: number; startWidth: number; percent: number; pointer: number; docId: string } | null>(null)
  const image = () => {
    const current = useStore.getState().doc
    if (!target || current.id !== target.docId) return null
    const host = [...document.querySelectorAll<HTMLElement>('.article [data-block-id]')].find(b => b.dataset.blockId === target.blockId)
    const img = host && [...host.querySelectorAll<HTMLImageElement>('.block-html img')].find(img => img.closest('[data-block-id]') === host && resolveResizeTarget(img, current)?.pos.index === target.index)
    return img && resolveResizeTarget(img, current) ? img : null
  }

  const cancel = () => {
    const d = drag.current
    if (d) { if (d.original === null) d.img.removeAttribute('style'); else d.img.setAttribute('style', d.original); drag.current = null }
  }
  useEffect(() => {
    const pick = (e: MouseEvent) => {
      const img = (e.target as Element).closest?.('.article .block-html img') as HTMLImageElement | null
      if (img) {
        const resolved = resolveResizeTarget(img, useStore.getState().doc)
        if (resolved) setTarget({ ...resolved.pos, docId: resolved.docId })
        else { cancel(); setTarget(null); useStore.getState().notify('此图片的位置无法安全确认，请重新选择图片或使用原属性面板') }

      } else if (!(e.target as Element).closest?.('.image-resize-overlay')) { cancel(); setTarget(null) }
    }
    document.addEventListener('click', pick, true)
    return () => { document.removeEventListener('click', pick, true); cancel() }
  }, [])
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const img = image()
      measuredImage.current = img
      if (!img || selected !== target?.blockId || editing) { cancel(); setRect(null) }
      else {
        const r = img.getBoundingClientRect()
        const parent = img.parentElement!.getBoundingClientRect()
        const scroll = img.closest('.canvas-scroll')!.getBoundingClientRect()
        const canvasLeft = Math.max(scroll.left, 0)
        const canvasTop = Math.max(scroll.top, 0)
        const canvasRight = Math.min(scroll.right, window.innerWidth)
        const canvasBottom = Math.min(scroll.bottom, window.innerHeight)
        const left = Math.max(r.left, canvasLeft)
        const top = Math.max(r.top, canvasTop)
        const right = Math.min(r.right, canvasRight)
        const bottom = Math.min(r.bottom, canvasBottom)
        const visible = right > left && bottom > top && canvasRight - canvasLeft >= 44 && canvasBottom - canvasTop >= 44 ? new DOMRect(left, top, right - left, bottom - top) : null
        const nextHandle = {
          left: Math.max(canvasLeft, Math.min(right - left < 44 ? (right + 44 <= canvasRight ? right : left - 44) : right - 44, canvasRight - 44)),
          top: Math.max(canvasTop, Math.min(bottom - top < 44 ? (bottom + 44 <= canvasBottom ? bottom : top - 44) : bottom - 44, canvasBottom - 44)),
        }
        setHandlePosition(old => old.left === nextHandle.left && old.top === nextHandle.top ? old : nextHandle)
        setRect((old) => old?.left === visible?.left && old?.top === visible?.top && old?.width === visible?.width && old?.height === visible?.height ? old : visible)
        if (!drag.current && Number.isFinite(parent.width) && parent.width > 0) setWidth(clampImageWidth(r.width / parent.width * 100))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); cancel() }
  }, [target, selected, editing, doc]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (percent: number, expected: Block, docId: string, expectedImage?: HTMLImageElement) => {
    const s = useStore.getState()
    if (!target || s.doc.id !== docId || findBlock(s.doc.blocks, target.blockId)?.block !== expected || (expectedImage && (!expectedImage.isConnected || image() !== expectedImage))) {
      s.notify('图片所在模块已变化，请重新选择后调整')
      return
    }
    const next = resizePhoto(s.doc, target, percent)
    if (next !== s.doc) s.commit(next)
  }
  if (!rect || !target || selected !== target.blockId || editing) return null
  return <div className="image-resize-overlay" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} data-testid="image-resize-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <span className="image-resize-label" aria-live="polite">{width}% · 拖动缩放</span>
    <button ref={handle} style={{ left: handlePosition.left, top: handlePosition.top }} className="image-resize-handle" aria-label="调整图片大小" title="拖动等比缩放；方向键调整，Shift加速，Esc取消" data-testid="image-resize-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        const img = image()
        const s = useStore.getState()
        const block = findBlock(s.doc.blocks, target.blockId)?.block
        if (!img || !block) return
        const r = img.getBoundingClientRect()
        const parentWidth = img.parentElement!.getBoundingClientRect().width
        if (!Number.isFinite(parentWidth) || parentWidth <= 0) return
        drag.current = { img, original: img.getAttribute('style'), block, docId: s.doc.id, parentWidth, startX: e.clientX, startWidth: r.width, percent: width, pointer: e.pointerId }
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.pointer !== e.pointerId) return
        d.percent = clampImageWidth((d.startWidth + e.clientX - d.startX) / d.parentWidth * 100)
        d.img.style.width = `${d.percent}%`; d.img.style.maxWidth = '100%'; d.img.style.height = 'auto'
        setWidth(d.percent)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d || d.pointer !== e.pointerId) return
        const p = d.percent; cancel()
        if (Math.abs(p - d.startWidth / d.parentWidth * 100) > 0.05) commit(p, d.block, d.docId, d.img)
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); cancel(); setTarget(null); return }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const s = useStore.getState(); const block = findBlock(s.doc.blocks, target.blockId)?.block
        const expectedImage = measuredImage.current
        if (!block || !expectedImage || !expectedImage.isConnected || image() !== expectedImage) {
          s.notify('图片所在模块已变化，请重新选择后调整')
          return
        }
        const step = e.shiftKey ? 10 : 1
        commit(e.key === 'Home' ? 10 : e.key === 'End' ? 100 : width + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : -step), block, s.doc.id, expectedImage)
      }}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 13 13 5M8 13h5V8" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
  </div>
}
