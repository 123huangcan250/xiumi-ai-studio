import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { buildCatalog, renumber, templateTheme, type TemplateLike } from '../../src/core/templateFill'

const parse = (s: string) => new JSDOM(s).window.document
const html = (h: string) => createBlock('html', { html: h, label: '片段' })
const OLD = 'https://mmbiz.qpic.cn/old/640?wx_fmt=jpeg'

/** 仿照常见活动推文：封面、章节标题、正文、配图、花边、结尾署名 */
const template: TemplateLike = {
  id: 'tpl',
  name: '去年运动会',
  themeId: 'humanist-warm',
  blocks: [
    html(`<section style="background-color: #fdf3e7; padding: 20px"><p style="font-size: 24px; color: #a0522d"><strong>2025 秋季运动会圆满结束</strong></p><p style="font-size: 13px; color: #999">旧副标题：奔跑吧少年</p><img src="${OLD}" style="width: 100%"></section>`),
    html('<section style="text-align: center"><span style="font-size: 26px; color: #a0522d">01</span><p style="font-size: 18px"><strong>旧章节：开幕式</strong></p></section>'),
    html('<p style="font-size: 15px; text-indent: 2em">旧正文第一段，去年的开幕式在体育场举行。</p><p style="font-size: 15px; text-indent: 2em">旧正文第二段，三千名同学参加。</p>'),
    html(`<section style="padding: 8px; border: 1px solid #a0522d"><img src="${OLD}" style="width: 100%"><p style="font-size: 12px; text-align: center">▲ 旧图注</p></section>`),
    html(`<section style="display: flex"><img src="${OLD}" style="width: 50%"><img src="${OLD}" style="width: 50%"></section>`),
    html('<p style="text-align: center; color: #a0522d">· · ·</p>'),
    html('<section style="text-align: center"><p>END</p><p style="font-size: 12px">文字｜张三 图片｜李四</p><p style="font-size: 12px">点击蓝字关注我们</p></section>'),
  ],
}

describe('template catalog', () => {
  const parts = buildCatalog([template, template], { parse })
  it('classifies parts and merges duplicates', () => {
    const own = parts.filter((p) => !p.id.startsWith('b:'))
    expect(own.map((p) => p.kind)).toEqual(['cover', 'heading', 'body', 'image', 'image', 'decor', 'ending'])
    expect(own.find((p) => p.kind === 'image' && p.photos === 2)).toBeTruthy()
    // 没有装饰的光秃照片不提取为图片框
    expect(own.some((p) => p.id.startsWith('f'))).toBe(false)
    expect(parts.some((p) => p.id === 'b:timeline')).toBe(true)
  })
})

describe('renumber', () => {
  it('renumbers in the original style', () => {
    expect(renumber('01', 3)).toBe('03')
    expect(renumber('PART 1', 2)).toBe('PART 2')
    expect(renumber('第一章', 4)).toBe('第四章')
    expect(renumber('Ⅰ', 2)).toBe('Ⅱ')
  })
})

describe('template theme and mixed sections', () => {
  it('derives colours from imported fragments so built-in blocks match', () => {
    const t = templateTheme([template], parse)!
    expect(t.themeOverrides?.colors?.primary?.toLowerCase()).toBe('#a0522d')
    const builtinOnly = templateTheme([{ id: 'b', name: 'b', themeId: 'tech-blue', blocks: [createBlock('heading'), createBlock('paragraph')] }], parse)
    expect(builtinOnly).toEqual({ themeId: 'tech-blue', themeOverrides: undefined })
  })
})
