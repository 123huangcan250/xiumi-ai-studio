// 模板里没有单独的“单图”模块时，从照片位提取带图注的相框
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractSingleFrames } from '../../src/core/slots'

const parse = (s: string) => new JSDOM(s).window.document
const IMG = 'https://mmbiz.qpic.cn/old/640?wx_fmt=jpeg'

describe('extractSingleFrames', () => {
  it('把照片、相框和图注一起提出来，不带上旁边的正文', () => {
    const body = '这是一段很长的正文，用来确认提取单图框时不会把整个模块的文字都带上，所以它必须超过四十个字才行，再多写几句凑够数量。'
    const html = `<section><p style="font-size:14px">${body}</p><section style="border:1px solid #9cc393;padding:5px"><img src="${IMG}" style="width:100%"><p style="font-size:12px;text-align:center">风筝制作的火热场面</p></section></section>`
    const frames = extractSingleFrames(html, { parse })
    expect(frames).toHaveLength(1)
    expect(frames[0]).toContain('风筝制作的火热场面')
    expect(frames[0]).toContain('border:1px solid #9cc393')
    expect(frames[0]).not.toContain('这是一段很长的正文')
  })

  it('两张照片共用的容器不算单图框', () => {
    const html = `<section style="display:flex"><section style="padding:4px"><img src="${IMG}"></section><section style="padding:4px"><img src="${IMG}"></section></section>`
    const frames = extractSingleFrames(html, { parse })
    expect(frames).toHaveLength(2)
    for (const f of frames) expect((f.match(/<img/g) ?? []).length).toBe(1)
  })

  it('光秃的照片没有相框，不提取', () => {
    expect(extractSingleFrames(`<img src="${IMG}">`, { parse })).toEqual([])
  })
})
