// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RichEditor } from '../../src/editor/RichEditor'
import { THEMES } from '../../src/core/themes'
let host: HTMLDivElement, root: Root, editor: Editor
const done = vi.fn(), changed = vi.fn()
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(createElement(RichEditor, { theme: THEMES[0], onDone: done, onChange: changed, value: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta gamma', marks: [{ type: 'textStyle', attrs: { color: '#123456' } }] }] }] } })) })
  editor = (host.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })
function select(label: string, value: string) {
  const control = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  expect(control).not.toBeNull()
  act(() => { control!.focus(); control!.value = value; control!.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(document.activeElement).toBe(control)
}
it('changes only selected text and resets font/size without clearing explicit color', () => {
  act(() => { editor.commands.setTextSelection({ from: 7, to: 11 }) })
  select('正文字体', 'Arial, sans-serif'); select('正文字号', '24px')
  let nodes = editor.getJSON().content![0].content!
  expect(nodes.map(n => 'text' in n ? n.text : undefined)).toEqual(['alpha ', 'beta', ' gamma'])
  expect(nodes[1].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining({ color: '#123456', fontFamily: 'Arial, sans-serif', fontSize: '24px' }) }])
  expect(nodes[0].marks?.[0].attrs?.fontSize).toBeFalsy()
  select('正文字体', ''); select('正文字号', '')
  nodes = editor.getJSON().content![0].content!
  expect(nodes.every(n => n.marks?.[0].attrs?.color === '#123456')).toBe(true)
  expect(nodes.every(n => !n.marks?.[0].attrs?.fontFamily && !n.marks?.[0].attrs?.fontSize)).toBe(true)
})
it('collapsed selection formats only subsequent input', () => {
  act(() => { editor.commands.setTextSelection(17) })
  select('正文字号', '32px')
  act(() => { editor.commands.insertContent(' NEW') })
  const nodes = editor.getJSON().content![0].content!
  expect('text' in nodes[0] ? nodes[0].text : undefined).toBe('alpha beta gamma')
  expect(nodes[0].marks?.[0].attrs?.fontSize).toBeFalsy()
  expect('text' in nodes[1] ? nodes[1].text : undefined).toBe(' NEW'); expect(nodes[1].marks?.[0].attrs?.fontSize).toBe('32px')
})
it('keeps upstream ColorPicker and supports a click/keyboard activation of Done', () => {
  expect(host.querySelector('[data-testid="rich-color"]')).not.toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('.done')!.click())
  expect(done).toHaveBeenCalledOnce()
})

it('keeps ColorPicker theme groups and Escape only closes its popover', () => {
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="rich-color"]')!.click())
  expect(host.querySelector('[data-testid="rich-color-pop"]')!.textContent).toContain('主题色')
  expect(host.querySelector('[data-testid="rich-color-pop"]')!.textContent).toContain('常用色')
  expect(host.querySelector('[data-testid="rich-color-custom"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="rich-color-reset"]')).not.toBeNull()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(host.querySelector('[data-testid="rich-color-pop"]')).toBeNull()
  expect(done).not.toHaveBeenCalled()
})
it('reports font and size independently as mixed and returns to a uniform value', () => {
  act(() => {
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'one', marks: [{ type: 'textStyle', attrs: { color: '#123456', fontFamily: 'Arial, sans-serif', fontSize: '24px' } }] },
      { type: 'text', text: 'two', marks: [{ type: 'textStyle', attrs: { color: '#123456', fontFamily: 'Times New Roman, serif', fontSize: '32px' } }] },
    ] }] })
    editor.commands.setTextSelection({ from: 1, to: 7 })
  })
  const family = host.querySelector<HTMLSelectElement>('[aria-label="正文字体"]')!
  const size = host.querySelector<HTMLSelectElement>('[aria-label="正文字号"]')!
  expect(family.selectedOptions[0].textContent).toBe('混合格式')
  expect(family.selectedOptions[0].disabled).toBe(true)
  expect(size.selectedOptions[0].textContent).toBe('混合格式')
  select('正文字体', 'Arial, sans-serif')
  expect(family.value).toBe('Arial, sans-serif')
  expect(size.selectedOptions[0].textContent).toBe('混合格式')
  select('正文字号', '24px'); expect(size.value).toBe('24px')
  select('正文字体', ''); select('正文字号', '')
  const nodes = editor.getJSON().content![0].content!
  expect(nodes.every(n => n.marks?.[0].attrs?.color === '#123456')).toBe(true)
  expect(family.value).toBe(''); expect(size.value).toBe('')
})
