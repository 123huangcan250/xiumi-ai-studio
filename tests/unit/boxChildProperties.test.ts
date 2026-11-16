// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { findBlock } from '../../src/core/tree'
import { textToRich } from '../../src/core/richtext'
import { RightPanel } from '../../src/editor/RightPanel'
import { emptyDoc, useStore } from '../../src/editor/store'

let host: HTMLDivElement
let root: Root
const store = () => useStore.getState()
const box = createBlock('box', {children: []})
const original = createBlock('paragraph', { content: textToRich('Keep me') })
const sibling = createBlock('paragraph', { content: textToRich('Keep me too') })
function children() {
  const block = findBlock(store().doc.blocks, box.id)!.block
  if (block.type !== 'box') throw Error('Missing text box')
  return block.props.children
}
function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button).not.toBeNull()
  act(() => button!.click())
}
function position(value: string) {
  const found = host.querySelector<HTMLSelectElement>('[data-testid="box-children"] select')
  expect(found).not.toBeNull()
  const control = found!
  act(() => {
    control.value = value
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store().load({ ...emptyDoc(), blocks: [{ ...box, props: { ...box.props, children: [original] } }, sibling] })
  store().select(box.id)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(RightPanel)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
it('inserts heading and body at specified positions, then removes and restores only the specified child', () => {
  const originalBefore = children()[0]
  const siblingBefore = store().doc.blocks[1]
  position('start')
  click('[data-testid="add-box-heading"]')
  const heading = children()[0]
  expect(heading.type).toBe('heading')
  position(`after:${heading.id}`)
  click('[data-testid="add-box-paragraph"]')
  expect(children().map(c => c.type)).toEqual(['heading', 'paragraph', 'paragraph'])
  expect(children()[2]).toBe(originalBefore)
  expect(store().doc.blocks[1]).toBe(siblingBefore)
  click(`[data-child-id="${heading.id}"] [data-testid="remove-box-child"]`)
  expect(children().map(c => c.type)).toEqual(['paragraph', 'paragraph'])
  act(() => store().undo())
  expect(children()[0].id).toBe(heading.id)
  act(() => store().redo())
  expect(children().some(c => c.id === heading.id)).toBe(false)
  expect(store().doc.blocks[1]).toBe(siblingBefore)
})
it('adds to an empty box and ignores stale actions after selection changes', () => {
  click('[data-testid="remove-box-child"]')
  expect(children()).toEqual([])
  expect(host.textContent).toContain('暂无模块')
  click('[data-testid="add-box-paragraph"]')
  expect(children().map(c => c.type)).toEqual(['paragraph'])
  const stale = host.querySelector<HTMLButtonElement>('[data-testid="add-box-heading"]')!
  act(() => {
    store().select(sibling.id)
    stale.click()
  })
  expect(children().map(c => c.type)).toEqual(['paragraph'])
})
