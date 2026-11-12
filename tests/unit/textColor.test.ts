import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { setSlotColor, slotColors } from '../../src/core/slots'
import { THEMES } from '../../src/core/themes'
import type { RichText } from '../../src/core/types'

const parse = (s: string) => new JSDOM(s).window.document
// 浏览器/微信会重新解析保存的 HTML：结构必须原样保持
const reparse = (html: string) => parse(`<body>${html}</body>`).body.innerHTML

describe('snippet text color', () => {
  const html = `<p style="font-size: 20px; color: rgb(51, 51, 51)"><strong><span style="color: #8a1c2b">【</span>开幕式<span style="color: #8a1c2b">】</span></strong></p><p style="font-size: 15px">正文<font color="#ff0000">一段</font>文字</p>`

  it('reads the color each slot shows', () => {
    expect(slotColors(html, parse)).toEqual({ t0: 'rgb(51, 51, 51)', t1: null })
  })

  it('sets one color on the whole line and drops inner colors that would cover it', () => {
    const out = setSlotColor(html, 't0', '#2e86de', parse)
    const first = parse(`<body>${out}</body>`).body.firstElementChild!
    expect(first.getAttribute('style')).toBe('font-size: 20px; color: #2e86de')
    expect(first.innerHTML).not.toMatch(/color/)
    expect(first.textContent).toBe('【开幕式】')
    // 另一行不受影响
    expect(out).toContain('<p style="font-size: 15px">正文<font color="#ff0000">一段</font>文字</p>')
    expect(reparse(out)).toBe(out)
    expect(slotColors(out, parse).t0).toBe('#2e86de')
  })

  it('removes <font color> inside the line', () => {
    const out = setSlotColor(html, 't1', '#27ae60', parse)
    expect(out).toContain('<p style="font-size: 15px; color: #27ae60">正文<font>一段</font>文字</p>')
  })

  it('reset removes the line colors so it follows the outer box', () => {
    const out = setSlotColor(html, 't0', null, parse)
    expect(out.startsWith('<p style="font-size: 20px"><strong><span>【</span>')).toBe(true)
    expect(slotColors(out, parse).t0).toBeNull()
  })

  it('wraps loose text in an inline span so siblings and the parent keep their color', () => {
    const loose = '<section style="color: #666">说明文字<p>下一段</p></section>'
    const out = setSlotColor(loose, 't0', '#c0392b', parse)
    expect(out).toBe('<section style="color: #666"><span style="color: #c0392b">说明文字</span><p>下一段</p></section>')
    expect(reparse(out)).toBe(out)
    expect(slotColors(out, parse)).toEqual({ t0: '#c0392b', t1: '#666' })
  })

  it('uses fill for SVG text and color for HTML inside foreignObject', () => {
    const svg = '<svg viewBox="0 0 100 20"><text fill="#000" x="0" y="15">标题<tspan fill="#f00">01</tspan></text><foreignObject width="100" height="20"><p style="color: #000">框内文字</p></foreignObject></svg>'
    const out = setSlotColor(setSlotColor(svg, 't0', '#8e44ad', parse), 't1', '#1f3a93', parse)
    expect(out).toContain('<text x="0" y="15" style="fill: #8e44ad">标题<tspan>01</tspan></text>')
    expect(out).toContain('<p style="color: #1f3a93">框内文字</p>')
  })

  it('ignores invalid colors and unknown slots', () => {
    expect(setSlotColor(html, 't0', 'url(javascript:alert(1))', parse)).toBe(html)
    expect(setSlotColor(html, 't9', '#000', parse)).toBe(html)
  })
})

describe('rich text color', () => {
  const rich = (marks: { type: string; attrs?: Record<string, unknown> }[]): RichText => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '关键句', marks }] }],
  })
  const theme = THEMES[0]
  const html = (marks: { type: string; attrs?: Record<string, unknown> }[]) =>
    compileBlock(createBlock('paragraph', { content: rich(marks), align: 'justify' }), theme)

  it('renders the chosen color', () => {
    expect(html([{ type: 'textStyle', attrs: { color: '#c0392b' } }])).toContain('<span style="color:#c0392b;">关键句</span>')
  })

  it('bold text keeps the chosen color instead of the theme color', () => {
    const out = html([{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#27ae60' } }])
    expect(out).toContain('<strong style="font-weight:700;color:#27ae60;">关键句</strong>')
    expect(html([{ type: 'bold' }])).toContain(`color:${theme.colors.primary};`)
  })
})
