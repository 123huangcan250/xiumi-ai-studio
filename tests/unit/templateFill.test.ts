import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { parseArticle } from '../../src/core/outline'
import { buildCatalog, buildFromPlan, catalogBrief, normalizePlan, renumber, rulePlan, templateTheme, type TemplateLike } from '../../src/core/templateFill'
import type { ImageRef } from '../../src/core/types'

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
const photos: ImageRef[] = Array.from({ length: 10 }, (_, i) => ({ src: `/media/photo-${String(i + 1).padStart(2, '0')}.jpg`, width: 1600, height: 1067 }))
const outline = parseArticle(readFileSync(join(import.meta.dirname, '..', '..', 'samples', 'activity.txt'), 'utf8'))

describe('template catalog', () => {
  const parts = buildCatalog([template, template], { parse })
  it('classifies parts and merges duplicates', () => {
    const own = parts.filter((p) => !p.id.startsWith('b:'))
    expect(own.map((p) => p.kind)).toEqual(['cover', 'heading', 'body', 'image', 'image', 'decor', 'ending'])
    expect(own.find((p) => p.kind === 'image' && p.photos === 2)).toBeTruthy()
    expect(parts.some((p) => p.id === 'b:timeline')).toBe(true)
  })
  it('briefs slots for the model without full html', () => {
    const brief = catalogBrief(parts)
    expect(brief[1]).toMatchObject({ id: 'p1', kind: 'heading', texts: [{ id: 't0', role: 'number' }, { id: 't1', role: 'title' }] })
    expect(JSON.stringify(brief)).not.toContain('<section')
  })
})

describe('rule-based template fill', () => {
  const parts = buildCatalog([template], { parse })
  const { doc, warnings } = buildFromPlan(rulePlan(outline, parts, photos.length), parts, photos, { parse, theme: template })
  const out = compileDoc(doc).html

  it('keeps the template look with the new content', () => {
    expect(doc.themeId).toBe('humanist-warm')
    expect(out).toContain(outline.title)
    expect(out).toContain('background-color: #fdf3e7')
    expect(out).toContain(outline.sections[1].heading)
    expect(out).toContain('>02<')
    expect(compileDoc(doc).warnings.filter((w) => w.includes('数据异常'))).toEqual([])
  })
  it('leaves no text or photos from the old article', () => {
    for (const old of ['2025 秋季运动会', '旧副标题', '旧章节', '旧正文', '旧图注', '张三', '李四']) expect(out).not.toContain(old)
    expect(out).not.toContain(OLD)
    expect(warnings).toEqual([])
  })
  it('uses every photo exactly once and keeps branding text', () => {
    for (const p of photos) expect(out.split(p.src).length - 1).toBe(1)
    expect(out).toContain('文字：学生科协宣传部<br>图片：摄影协会')
    expect(out).toContain('点击蓝字关注我们')
    expect(out).toContain('END')
    expect(out).toContain(outline.subtitle)
  })
  it('strips old names from credits when the new text has none', () => {
    const o = { ...outline, ending: { ...outline.ending, author: '' } }
    const parts = buildCatalog([template], { parse })
    const r = compileDoc(buildFromPlan(rulePlan(o, parts, 0), parts, [], { parse }).doc).html
    expect(r).toContain('文字｜ 图片｜')
    expect(r).not.toContain('张三')
  })
  it('keeps every paragraph of the source', () => {
    for (const s of outline.sections) for (const p of s.paragraphs) expect(out).toContain(p.slice(0, 20))
  })
})

describe('AI plan', () => {
  const parts = buildCatalog([template], { parse })
  it('drops unknown parts, truncates tight slots and dedupes photos', () => {
    const svgPart = buildCatalog([{ id: 's', name: 's', blocks: [html('<svg viewBox="0 0 10 2"><text>回顾</text></svg>')] }], { parse })
    const plan = normalizePlan(
      { title: '新标题', parts: [{ part: 'nope' }, { part: 'p1', text: { t0: 3, t1: '新章节', bogus: 'x' }, images: [0, 0, 99] }, { part: 'p0', images: [0, 1] }] },
      parts,
      10,
    )
    expect(plan.items).toEqual([
      { part: 'p1', text: { t0: '3', t1: '新章节' }, images: [0] },
      { part: 'p0', text: {}, images: [1] },
    ])
    expect(normalizePlan({ parts: [{ part: 'p0', text: { t0: '精彩回顾瞬间' } }] }, svgPart, 0).items[0].text.t0).toBe('精彩')
  })
  it('fills missing photo slots from unassigned photos and appends the rest', () => {
    const plan = normalizePlan({ title: 'T', parts: [{ part: 'p4', text: {}, images: [3] }, { part: 'b:paragraph', text: { content: '正文' } }] }, parts, 4)
    const { doc } = buildFromPlan(plan, parts, photos.slice(0, 4), { parse })
    const out = compileDoc(doc).html
    expect(out.indexOf('photo-04')).toBeLessThan(out.indexOf('photo-01'))
    for (const p of photos.slice(0, 4)) expect(out).toContain(p.src)
    expect(doc.blocks.at(-1)!.type).toBe('gallery')
  })
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
  it('puts section text and photos into mixed blocks when the template has no plain text block', () => {
    // 秀米常见结构：每节一个图文混排大版块
    const xiumi: TemplateLike = {
      id: 'x',
      name: '图文模板',
      blocks: [
        template.blocks[0],
        template.blocks[1],
        html(`<section style="background-color: #eef6ea"><img src="${OLD}" style="width: 100%"><p style="font-size: 12px">旧图注一</p><p style="font-size: 15px">旧正文甲。</p><p style="font-size: 15px">旧正文乙。</p></section>`),
        html(`<section style="background-color: #eef6ea"><img src="${OLD}" style="width: 100%"><img src="${OLD}" style="width: 100%"><p style="font-size: 15px">旧正文丙。</p></section>`),
        template.blocks[6],
      ],
    }
    const parts = buildCatalog([xiumi], { parse })
    const { doc, warnings } = buildFromPlan(rulePlan(outline, parts, photos.length), parts, photos, { parse })
    const out = compileDoc(doc).html
    expect(out.match(/#eef6ea/g)!.length).toBeGreaterThanOrEqual(outline.sections.length - 1)
    for (const old of ['旧图注', '旧正文']) expect(out).not.toContain(old)
    for (const s of outline.sections) for (const p of s.paragraphs) expect(out).toContain(p.slice(0, 20))
    for (const p of photos) expect(out).toContain(p.src)
    expect(warnings).toEqual([])
  })
})
