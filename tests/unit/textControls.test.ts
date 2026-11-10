// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { slotRawTexts } from '../../src/core/slots'
import type { Block } from '../../src/core/types'
import { PropsForm } from '../../src/editor/PropsForm'
import { useStore } from '../../src/editor/store'

let root: Root
let host: HTMLDivElement
const initial = useStore.getState()
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState(initial, true)
  vi.clearAllTimers()
  vi.useRealTimers()
})

function Form() {
  const block = useStore(s => s.doc.blocks[0])
  return createElement(PropsForm, { block })
}
function renderBlock(block: Block) {
  useStore.setState({ doc: { ...initial.doc, blocks: [block] }, saveStatus: 'saved' })
  act(() => root.render(createElement(Form)))
}
const click = (label: string) => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click())

it('module alignment buttons replace inline alignment and preserve formatting', () => {
  renderBlock(createBlock('paragraph', { content: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '正文', marks: [{ type: 'bold' }] }] }] } }))
  for (const [label, align] of [['右对齐', 'right'], ['左对齐', 'left'], ['居中', 'center'], ['两端', 'justify']]) {
    click(label)
    expect(useStore.getState().doc.blocks[0].props).toMatchObject({
      align,
      content: { content: [{ attrs: { textAlign: align }, content: [{ marks: [{ type: 'bold' }] }] }] },
    })
  }
})

it('the imported-text form saves blank lines and all deliberate spaces when reopened', () => {
  renderBlock(createBlock('html', { html: '<p>原文</p>' }))
  const input = '  hello world  again \n\n last line \n'
  const area = host.querySelector<HTMLTextAreaElement>('[data-testid="slot-t0"] textarea')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, input)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const block = useStore.getState().doc.blocks[0]
  expect(block.type).toBe('html')
  if (block.type !== 'html') throw new Error('Expected imported HTML')
  expect(slotRawTexts(block.props.html).t0).toBe(input)
  act(() => root.render(null))
  act(() => root.render(createElement(Form)))
  expect(host.querySelector<HTMLTextAreaElement>('[data-testid="slot-t0"] textarea')!.value).toBe(input)
})

it('imported-text controls show four alignment choices and the selected state', () => {
  renderBlock(createBlock('html', { html: '<p style="text-align:justify">正文</p><svg><text>固定</text></svg>' }))
  for (const align of ['left', 'center', 'right', 'justify']) {
    const button = host.querySelector<HTMLButtonElement>(`[data-testid="align-t0-${align}"]`)
    expect(button).not.toBeNull()
    act(() => button!.click())
    expect(button!.getAttribute('aria-pressed')).toBe('true')
  }
  expect([...host.querySelectorAll<HTMLButtonElement>('[data-testid="slot-t1"] button')].every(b => b.disabled)).toBe(true)
})

it('keeps cover title alignment separate from image and subtitle fields', () => {
  const cover = createBlock('cover', { title: '封面', subtitle: '保留副标题', image: { src: '/media/cover.jpg' } })
  renderBlock(cover)
  const select = host.querySelector<HTMLSelectElement>('select')!
  expect(select.value).toBe('auto')
  act(() => {
    select.value = 'center'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(useStore.getState().doc.blocks[0].props).toEqual({ ...cover.props, titleAlign: 'center' })
})
