// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SuggestionInput } from '../../src/editor/SuggestionInput'

let host: HTMLDivElement
let root: Root
const change = vi.fn()
const suggestion = '缩短开头介绍，突出活动主题，不改动事实'
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  change.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove() })
function render(value = '', text = suggestion, disabled = false) {
  act(() => root.render(createElement(SuggestionInput, { value, suggestion: text, onChange: change, disabled })))
  return host.querySelector('textarea')!
}
function key(input: HTMLTextAreaElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options })
  act(() => input.dispatchEvent(event))
  return event
}
it('keeps ghost text separate from value and accepts Tab without submitting', () => {
  const input = render()
  expect(input.value).toBe('')
  expect(input.placeholder).toBe(suggestion)
  expect(key(input).defaultPrevented).toBe(true)
  expect(change).toHaveBeenCalledWith(suggestion)
})
it('does not replace manual text or intercept Tab when the user is typing', () => {
  const input = render('我的修改要求')
  expect(key(input).defaultPrevented).toBe(false)
  expect(input.value).toBe('我的修改要求')
  expect(change).not.toHaveBeenCalled()
})
it('preserves Shift+Tab, IME composition and disabled keyboard navigation', () => {
  const input = render()
  expect(key(input, { shiftKey: true }).defaultPrevented).toBe(false)
  expect(key(input, { isComposing: true }).defaultPrevented).toBe(false)
  key(render('', suggestion, true))
  expect(change).not.toHaveBeenCalled()
})
it('dismisses with Escape and shows a different contextual suggestion later', () => {
  const input = render()
  key(input, { key: 'Escape' })
  expect(input.placeholder).not.toBe(suggestion)
  expect(key(input).defaultPrevented).toBe(false)
  expect(render('', '优化选中图片的图注').placeholder).toBe('优化选中图片的图注')
})
it('provides a click acceptance action for touch and screen reader users', () => {
  render()
  const button = host.querySelector('button')!
  act(() => button.click())
  expect(change).toHaveBeenCalledWith(suggestion)
  expect(button.type).toBe('button')
})
