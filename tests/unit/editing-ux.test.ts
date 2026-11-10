// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Modal } from '../../src/editor/Modal'
import { textToRich, richToPlain } from '../../src/core/richtext'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('preserves editing spaces and blank paragraphs without changing import defaults', () => {
  const input = '  首段  \n\n 尾段 '
  expect(richToPlain(textToRich(input, { preserveWhitespace: true }), { preserveWhitespace: true })).toBe(input)
  expect(richToPlain(textToRich(input))).toBe('首段\n尾段')
})

it('focuses dialog on opening and restores trigger after dismissal', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  act(() => root.render(createElement(Modal, { title: '测试', onClose() {}, children: createElement('button', null, '最后') })))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
  act(() => root.render(null))
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('Escape closes only the top dialog', () => {
  const closed: string[] = []
  act(() => root.render(createElement(Modal, { title: '父', onClose: () => closed.push('父'), children:
    createElement(Modal, { title: '子', onClose: () => closed.push('子'), children: '内容' }) })))
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(closed).toEqual(['子'])
})

it('changing module alignment replaces inline alignment while retaining marks', async () => {
  const { setRichAlignment } = await import('../../src/core/richtext')
  const rich = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '正文', marks: [{ type: 'bold' }] }] }] }
  expect(setRichAlignment(rich, 'right')).toMatchObject({ content: [{ attrs: { textAlign: 'right' }, content: [{ marks: [{ type: 'bold' }] }] }] })
  expect(rich.content[0].attrs.textAlign).toBe('center')
})

it('imported HTML slot editing retains spaces and empty lines on reopen', async () => {
  const { extractSlots, fillSlots } = await import('../../src/core/slots')
  const html = '<section><p style="color:red">原文段落</p></section>'
  const next = fillSlots(html, { t0: '  开头  \n\n结尾 ' }, { split: false, bold: false, preserveWhitespace: true })
  expect(extractSlots(next, undefined, true)[0]).toMatchObject({ text: '  开头  \n\n结尾 ' })
})

it('imported slot alignment changes only the selected paragraph', async () => {
  const { setSlotAlignment } = await import('../../src/core/slots')
  const next = setSlotAlignment('<p style="color:red"><strong>第一段</strong></p><p>第二段</p>', 't0', 'right')
  const dom = new DOMParser().parseFromString(next, 'text/html')
  expect(dom.querySelector('p')?.style.textAlign).toBe('right')
  expect(dom.querySelector('strong')?.textContent).toBe('第一段')
  expect(dom.querySelectorAll('p')[1].style.textAlign).toBe('')
})

it('exported paragraphs preserve deliberate indentation and repeated spaces', async () => {
  const { compileBlock } = await import('../../src/core/compiler')
  const { createBlock } = await import('../../src/core/blocks')
  const { THEMES } = await import('../../src/core/themes')
  const html = compileBlock(createBlock('paragraph', { content: textToRich('  缩进  间隔 ', { preserveWhitespace: true }) }), THEMES[0])
  const dom = new DOMParser().parseFromString(html, 'text/html')
  expect(dom.querySelector('p')?.textContent).toBe('\u00a0\u00a0缩进\u00a0\u00a0间隔\u00a0')
})

it('keeps English word gaps breakable when editing imported slots', async () => {
  const { fillSlots } = await import('../../src/core/slots')
  const html = fillSlots('<p>text</p>', { t0: '  hello world  again ' }, { preserveWhitespace: true })
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('p')?.textContent).toBe('\u00a0\u00a0hello world\u00a0\u00a0again\u00a0')
})

it('aligns inline or bare slots without changing siblings', async () => {
  const { setSlotAlignment } = await import('../../src/core/slots')
  for (const html of ['<section>lead<p>sibling</p></section>', '<span>lead</span><p>sibling</p>']) {
    const dom = new DOMParser().parseFromString(setSlotAlignment(html, 't0', 'right'), 'text/html')
    const sibling = [...dom.querySelectorAll('p')].find(el => el.textContent === 'sibling')!
    expect(sibling.closest('[style*="text-align"]')).toBeNull()
    expect(dom.querySelector('[style*="text-align"]')?.textContent).toBe('lead')
  }
})

it('exports heading and list alignment', async () => {
  const { compileBlock } = await import('../../src/core/compiler')
  const { createBlock } = await import('../../src/core/blocks')
  const { THEMES } = await import('../../src/core/themes')
  const content = { type: 'doc', content: [
    { type: 'heading', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'Heading' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Item' }] }] }] },
  ] }
  const dom = new DOMParser().parseFromString(compileBlock(createBlock('paragraph', { content }), THEMES[0]), 'text/html')
  expect([...dom.querySelectorAll('p')].map(p => p.style.textAlign)).toEqual(['right', 'center'])
})

it('preserves blank lines in bare imported text slots', async () => {
  const { fillSlots, extractSlots } = await import('../../src/core/slots')
  const next = fillSlots('<section>lead<p>sibling</p></section>', { t0: ' a\n\nb ' }, { preserveWhitespace: true })
  expect(extractSlots(next, undefined, true)[0]).toMatchObject({ text: ' a\n\nb ' })
})
