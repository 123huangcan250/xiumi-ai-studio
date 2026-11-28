// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect } from 'vitest'
import { Modal } from '../../src/editor/Modal'

it('includes rich text inputs in the dialog focus cycle', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(h(Modal, { title: 'Paste', onClose() {}, children:
      [h('button', { 'data-before': true, key: 'tab' }, 'Paste tab'),
        h('div', { contentEditable: true, role: 'textbox', 'aria-label': 'Paste input', key: 'paste' })] })))
    const before = host.querySelector<HTMLButtonElement>('[data-before]')!
    const editable = host.querySelector<HTMLElement>('[contenteditable]')!
    before.focus()
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => before.dispatchEvent(forward))
    expect(forward.defaultPrevented).toBe(false)
    editable.focus()
    const wrap = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => editable.dispatchEvent(wrap))
    expect(wrap.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(host.querySelector('.close'))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('cycles backwards to the last visible enabled field', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(h(Modal, { title: 'Focus', onClose() {}, children: [
      h('button', { 'data-last': true, key: 'last' }, 'Last visible'),
      h('input', { type: 'hidden', key: 'hidden' }),
      h('div', { style: { display: 'none' }, key: 'invisible' }, h('button', null, 'Invisible')),
      h('div', { inert: true, key: 'inert' }, h('button', null, 'Inert')),
      h('div', { contentEditable: true, 'aria-disabled': true, key: 'disabled-edit' }),
      h('div', { contentEditable: false, key: 'non-edit' }),
      h('button', { disabled: true, key: 'disabled' }, 'Disabled'),
    ] })))
    const first = host.querySelector<HTMLButtonElement>('.close')!
    first.focus()
    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(host.querySelector('[data-last]'))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
