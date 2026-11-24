// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { preserveAdjacentText, restoreTextRange, textRangeWithinRegion, styledSelectionHtml } from '../../src/editor/importedTextSelection'

function fixture(html: string, first: string, last = first) {
  const root = document.createElement('div')
  root.innerHTML = html
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const start = nodes.find(node => node.data === first)!
  const end = nodes.find(node => node.data === last)!
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.length)
  return { root, range }
}

it('only paints the selected text runs without changing existing live markup and unrelated styles', () => {
  const html = '<p><strong style="font-size: 14px; color: red">alpha</strong><em>beta</em> end</p><p>next</p>'
  const { root, range } = fixture(html, 'alpha', 'beta')
  const styled = styledSelectionHtml(root, range, 'fontSize', '24px')
  expect(root.innerHTML).toBe(html)
  const clone = document.createElement('div')
  clone.innerHTML = styled ?? ''
  expect(clone.textContent).toBe('alphabeta')
  expect(clone.querySelector('strong')?.style.color).toBe('red')
  expect(clone.querySelector('strong')?.style.fontSize).toBe('')
  expect([...clone.querySelectorAll('span')].map(span => span.style.fontSize)).toEqual(['24px', '24px'])
  expect(styledSelectionHtml(root, range, 'fontSize', '8rem')).toBeNull()
})

it.each([
  ['<p>one</p><p>two</p>', 'one', 'two'],
  ['<table><tbody><tr><td>one</td><td>two</td></tr></tbody></table>', 'one', 'two'],
  ['<p>one<img src="/media/test.png">two</p>', 'one', 'two'],
  ['<svg xmlns="http://www.w3.org/2000/svg"><text>one</text></svg>', 'one', 'one'],
  ['<p>one</p><span>two</span>', 'one', 'two'],
])('refuses formatting across structural boundaries: %s', (html, start, end) => {
  const { root, range } = fixture(html, start, end)
  expect(textRangeWithinRegion(root, range)).toBe(false)
  expect(styledSelectionHtml(root, range, 'fontFamily', 'Arial, sans-serif')).toBeNull()
})

it('restores a selection to the next text region at an exact text boundary', () => {
  const { root } = fixture('<p>first</p><p><span>second</span></p>', 'second')
  const range = restoreTextRange(root, 'first'.length, 'second'.length)
  expect(range.toString()).toBe('second')
  expect(textRangeWithinRegion(root, range)).toBe(true)
})

it('includes adjoining whitespace in the undoable edit without applying the style to it', () => {
  const { range } = fixture('<p>before chosen after</p>', 'before chosen after')
  range.setStart(range.startContainer, 7)
  range.setEnd(range.endContainer, 13)
  const edit = preserveAdjacentText(range, '<span style="font-size:24px">chosen</span>')!
  expect(range.toString()).toBe('chosen')
  expect(edit.range.toString()).toBe('e chosen a')
  const holder = document.createElement('div')
  holder.innerHTML = edit.html
  expect(holder.textContent).toBe('e chosen a')
  expect(holder.querySelector('span[style*="24px"]')?.textContent).toBe('chosen')
})
