// 文字样式与组件定位：字号、斜体、下划线、删除线、行距、字距、段距、左右边距
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { setSlotTypo, slotTypos } from '../../src/core/slots'

const parse = (s: string) => new JSDOM(s).window.document

describe('文字样式', () => {
  it('读出字号、行距、字距，并显示没有设置的项为空', () => {
    const html = '<p style="font-size: 16px; line-height: 2; letter-spacing: 1px; margin: 0px 0px 13px">正文第一段落内容在这里。</p>'
    const t = slotTypos(html, parse).t0!
    expect(t.size).toBe(16)
    expect(t.lineHeight).toBe(2)
    expect(t.letterSpacing).toBe(1)
    expect(t.paraSpacing).toBe(13)
    expect(t.sideMargin).toBe(0)
    expect([t.italic, t.underline, t.strike]).toEqual([false, false, false])
  })

  it('改字号，并去掉内层自己的字号', () => {
    const html = '<p style="font-size: 14px"><span style="font-size: 12px">正文第一段落内容在这里。</span></p>'
    const out = setSlotTypo(html, 't0', { size: 20 }, parse)
    expect(out).toContain('font-size: 20px')
    expect(out).not.toContain('12px')
    expect(slotTypos(out, parse).t0!.size).toBe(20)
  })

  it('斜体、下划线、删除线可以叠加，也能分别去掉', () => {
    const html = '<p style="font-size: 14px">正文第一段落内容在这里。</p>'
    let out = setSlotTypo(html, 't0', { italic: true, underline: true }, parse)
    out = setSlotTypo(out, 't0', { strike: true }, parse)
    const on = slotTypos(out, parse).t0!
    expect([on.italic, on.underline, on.strike]).toEqual([true, true, true])
    expect(out).toContain('text-decoration: underline line-through')
    out = setSlotTypo(out, 't0', { underline: false }, parse)
    const half = slotTypos(out, parse).t0!
    expect([half.italic, half.underline, half.strike]).toEqual([true, false, true])
    out = setSlotTypo(out, 't0', { italic: false, strike: false }, parse)
    const off = slotTypos(out, parse).t0!
    expect([off.italic, off.underline, off.strike]).toEqual([false, false, false])
    expect(out).not.toContain('text-decoration')
    expect(out).not.toContain('font-style')
  })

  it('段落间距和左右边距写在文字块上，外边距简写会被拆开保留其他边', () => {
    const html = '<p style="margin: 4px 0px 13px; font-size: 14px">正文第一段落内容在这里。</p>'
    const out = setSlotTypo(html, 't0', { paraSpacing: 8, sideMargin: 10 }, parse)
    const t = slotTypos(out, parse).t0!
    expect(t.paraSpacing).toBe(8)
    expect(t.sideMargin).toBe(10)
    expect(out).toContain('margin-top: 4px')
    expect(out).not.toContain('13px')
    expect(out).not.toMatch(/margin:\s/)
  })

  it('行距写在块上，只影响这一段，旁边的段落不动', () => {
    const html = '<section><p style="font-size: 14px">第一段正文内容在这里呢。</p><p style="font-size: 14px">第二段正文内容在这里呢。</p></section>'
    const out = setSlotTypo(html, 't1', { lineHeight: 1.5 }, parse)
    const t = slotTypos(out, parse)
    expect(t.t1!.lineHeight).toBe(1.5)
    expect(t.t0!.lineHeight).toBeNull()
  })

  it('数值超出范围时收到范围内；传 null 恢复默认', () => {
    const html = '<p style="font-size: 14px">正文第一段落内容在这里。</p>'
    expect(setSlotTypo(html, 't0', { size: 200 }, parse)).toContain('font-size: 96px')
    expect(setSlotTypo(html, 't0', { size: 1 }, parse)).toContain('font-size: 8px')
    const spaced = setSlotTypo(html, 't0', { letterSpacing: 3, sideMargin: 6 }, parse)
    const reset = setSlotTypo(spaced, 't0', { letterSpacing: null, sideMargin: null }, parse)
    expect(reset).not.toContain('letter-spacing')
    expect(reset).not.toContain('margin-left')
  })

  it('图形里的文字不提供样式，也不会被改', () => {
    const html = '<svg viewBox="0 0 100 20"><text x="0" y="10" font-size="6">图形里的文字</text></svg>'
    expect(slotTypos(html, parse).t0).toBeNull()
    expect(setSlotTypo(html, 't0', { size: 30 }, parse)).toBe(html)
  })
})
