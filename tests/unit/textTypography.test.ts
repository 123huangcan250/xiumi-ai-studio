import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { compileBlock } from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { sampleReplay, renderReplay } from '../../src/core/replay'
import { THEMES } from '../../src/core/themes'
import { safeTextFont, safeTextSize } from '../../src/core/textTypography'
import type { RichNode } from '../../src/core/types'
const theme = THEMES[0]
const compile = (nodes: RichNode[]) => compileBlock(createBlock('paragraph', { content: { type: 'doc', content: [{ type: 'paragraph', content: nodes }] } }), theme)
describe('document typography validation', () => {
  it.each(['Noto Serif SC Variable, Noto Serif SC, SimSun, serif', 'Arial, sans-serif', '"Times New Roman", serif', "'宋体', serif", 'Consolas, Courier New, monospace'])('accepts restricted family syntax %s', font => expect(safeTextFont(font)).toBe(font))
  it.each([undefined, null, 12, '', '   ', ',', 'Arial,,serif', '"Arial', 'Arial"', 'serif;position:fixed', 'url(http://example)', 'var(--font)', '<script>', 'a\\62', 'a\nfont', 'a'.repeat(181)])('rejects invalid or injectable family %j', font => expect(safeTextFont(font)).toBeUndefined())
  it.each(['8px', '96px', '15.5px'])('accepts bounded pixel size %s', size => expect(safeTextSize(size)).toBe(size))
  it.each([null, 24, '', '7px', '97px', '-1px', '1e1px', 'calc(2px)', '16em', '12px;color:red', 'Infinitypx'])('rejects invalid size %j', size => expect(safeTextSize(size)).toBeUndefined())
})
it('compiles B/I/U, explicit color, font and size without changing adjacent text or spacing', () => {
  const html = compile([{ type: 'text', text: 'before ' }, { type: 'text', text: 'selected', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'textStyle', attrs: { color: '#123456', fontFamily: 'Arial, sans-serif', fontSize: '24px' } }] }, { type: 'text', text: ' after' }])
  const body = new JSDOM(html).window.document.body
  expect(body.textContent).toBe('before selected after')
  expect(html).not.toContain('before&nbsp;')
  const span = body.querySelector<HTMLElement>('span[style*="font-family"]')!
  expect(span).not.toBeNull(); expect(span.textContent).toBe('selected')
  expect(span.style.fontFamily).toBe('Arial, sans-serif'); expect(span.style.fontSize).toBe('24px')
  expect(body.querySelector<HTMLElement>('strong')!.style.color).toBe('rgb(18, 52, 86)')
  expect(body.querySelector('em')).not.toBeNull()
  expect(body.querySelector('span[style*="text-decoration:underline"]')).not.toBeNull()
})
it('drops invalid typography without dropping valid color or escaping into attributes', () => {
  const html = compile([{ type: 'text', text: 'safe', marks: [{ type: 'textStyle', attrs: { color: '#123456', fontFamily: 'serif;position:fixed', fontSize: '99999px' } }] }])
  expect(html).toContain('color:#123456'); expect(html).not.toContain('position:fixed'); expect(html).not.toContain('99999px')
})
it('leaves existing rich output unchanged when typography is absent', () => {
  const text: RichNode = { type: 'text', text: '  deliberate  spaces ', marks: [{ type: 'bold' }] }
  expect(compile([text])).toBe(compile([{ ...text, marks: [...text.marks!, { type: 'textStyle', attrs: { fontFamily: 'bad;', fontSize: '1px' } }] }]))
})
it('keeps replay compilation on its original renderer and identifier contract', () => {
  const props = sampleReplay(), id = 'replay-typography'
  expect(compileBlock({ id, type: 'replay', props }, theme)).toBe(renderReplay(props, { idPrefix: 'rpreplay' }).html)
})
it.each([{ fontFamily: '"Times New Roman", serif' }, { fontSize: '15.5px' }])('supports a single typography attribute without requiring color %j', attrs => {
  const html = compile([{ type: 'text', text: '独立格式', marks: [{ type: 'textStyle', attrs }] }])
  const doc = new JSDOM(html).window.document
  const span = doc.querySelector<HTMLElement>('span')!
  expect(span).not.toBeNull()
  if (attrs.fontFamily) expect(span.style.fontFamily).toContain('Times New Roman')
  if (attrs.fontSize) expect(span.style.fontSize).toBe('15.5px')
  expect(doc.body.textContent).toBe('独立格式')
  expect(span.attributes.length).toBe(1)
})
