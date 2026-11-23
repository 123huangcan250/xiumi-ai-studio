// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileReplay } from '../../src/core/compiler'
import { ReplayPreviewModal } from '../../src/editor/ReplayPreview'

it('exposes the exact fractional playback duration without quantizing the range', () => {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  const animate = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const setTime = vi.fn()
  const svg = SVGSVGElement.prototype
  const animationMethods = {
    pauseAnimations: vi.fn(),
    setCurrentTime: setTime,
  }
  const previousSvg = Object.getOwnPropertyDescriptors(svg)
  for (const [name, value] of Object.entries(animationMethods)) {
    Object.defineProperty(svg, name, { configurable: true, value })
  }
  const target = document.createElement('div')
  document.body.append(target)
  const root = createRoot(target)
  try {
    const block = createBlock('replay', { textMode: 'svg-text' })
    const expected = Math.max(...compileReplay(block).scenes.map(scene => scene.cycle ?? scene.total))
    expect(Math.abs(expected * 100 - Math.round(expected * 100))).toBeGreaterThan(1e-6)
    act(() => root.render(createElement(ReplayPreviewModal, { block, onClose: vi.fn() })))
    const rail = document.querySelector<HTMLInputElement>('[data-testid="replay-seek"]')!
    expect(Number(rail.max)).toBe(expected)
    expect(rail.step).toBe('any')
    expect(setTime).toHaveBeenCalledWith(0)
  } finally {
    act(() => root.unmount())
    target.remove()
    animate.mockRestore()
    cancel.mockRestore()
    for (const name of Object.keys(animationMethods)) {
      const descriptor = previousSvg[name as keyof typeof previousSvg]
      if (descriptor) Object.defineProperty(svg, name, descriptor)
      else Reflect.deleteProperty(svg, name)
    }
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  }
})
