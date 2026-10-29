import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { exporterSmoke } from './helpers'
import { parseArticle } from '../../src/core/outline'
import { sanitizeHtml } from '../../src/core/sanitize'
import { THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'
import { articleToHtmlBlocks, articleToMarkdown, extractArticle } from '../../src/core/wxImport'

const page = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wechat-article.html'), 'utf8')
const parse = (s: string) => new JSDOM(s).window.document
const doc = (blocks: Block[]): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks, createdAt: 0, updatedAt: 0 })

describe('sanitize', () => {
  it('keeps inline styles and drops scripts, handlers, classes and hidden nodes', () => {
    const html = sanitizeHtml(
      '<section class="a" id="b" style="color:red;visibility:hidden;position:fixed"><p onclick="x()">hi</p><script>bad()</script><p style="display:none">gone</p><a href="javascript:alert(1)">link</a></section>',
      parse,
    )
    expect(html).toBe('<section style="color: red"><p>hi</p><a>link</a></section>')
  })
  it('turns lazy images into https src and rejects foreign background urls', () => {
    const html = sanitizeHtml(
      '<img data-src="http://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" src="data:image/svg+xml,x" width="300"><section style="background-image:url(https://evil.com/x.png)" data-lazy-bgimg="https://mmbiz.qpic.cn/bg/0"></section>',
      parse,
    )
    expect(html).toContain('src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"')
    expect(html).toContain('style="width: 300px"')
    expect(html).not.toContain('evil.com')
    expect(html).toContain('mmbiz.qpic.cn/bg/0')
  })
  it('keeps svg but strips event handlers', () => {
    const html = sanitizeHtml('<svg viewBox="0 0 1 1" onload="x()"><rect width="1" height="1" class="c"></rect></svg>', parse)
    expect(html).toContain('<svg viewBox="0 0 1 1">')
    expect(html).not.toMatch(/onload|class=/)
  })
})

describe('wechat article import', () => {
  const a = extractArticle(parse(page))
  it('reads meta information', () => {
    expect(a.title).toBe('测试推文：社团招新季')
    expect(a.account).toBe('测试公众号')
    expect(a.cover).toBe('https://mmbiz.qpic.cn/mmbiz_jpg/COVERcover123/0?wx_fmt=jpeg')
    expect(a.digest).toBe('一年一度的社团招新来啦')
  })
  it('cleans the content and replaces widgets', () => {
    const html = a.root.innerHTML
    expect(html).not.toMatch(/<script|<iframe|onclick|onload|class=|visibility: hidden|mp-style/)
    expect(html).toContain('［原文此处为公众号名片，导入时已移除］')
    expect(html).toContain('<section style="color: #333;">'.replace(';', '')) // div → section
  })
  it('splits into html blocks: styled sections alone, plain paragraphs grouped', () => {
    const blocks = articleToHtmlBlocks(a.root) as Block<'html'>[]
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    expect(blocks[0].props.html).toContain('社团招新季')
    expect(blocks[0].props.label.startsWith('社团招新季')).toBe(true)
    expect(blocks.some((b) => b.props.label === '原文图片')).toBe(true)
    // 编译后无脚本，图片地址可被映射
    const r = compileDoc(doc(blocks), { mapImage: (u) => u.replace('mmbiz.qpic.cn', 'img.test') })
    expect(r.html).toContain('https://img.test/mmbiz_jpg/ABCdef123/640?wx_fmt=jpeg')
    expect(r.html).not.toMatch(/<script|onclick/)
  })
  it('converts to markdown for re-layout', () => {
    const { markdown, images } = articleToMarkdown(a)
    expect(markdown.startsWith('# 测试推文：社团招新季')).toBe(true)
    expect(markdown).toContain('## 活动安排')
    expect(images).toEqual(['https://mmbiz.qpic.cn/mmbiz_jpg/ABCdef123/640?wx_fmt=jpeg'])
    const o = parseArticle(markdown)
    expect(o.sections.map((s) => s.heading)).toContain('活动安排')
    expect(o.sections.flatMap((s) => s.quotes).some((q) => q.source.includes('张同学'))).toBe(true)
  })
  it('exports html blocks to markdown text', () => {
    expect(exporterSmoke(articleToHtmlBlocks(a.root))).toContain('温馨提示：请携带学生证')
  })
})
