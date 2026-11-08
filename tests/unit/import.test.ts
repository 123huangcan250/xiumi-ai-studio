import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { exporterSmoke } from './helpers'
import { parseArticle } from '../../src/core/outline'
import { sanitizeHtml } from '../../src/core/sanitize'
import { THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'
import { componentPieces } from '../../src/core/fragments'
import { skeleton } from '../../src/core/slots'
import { articleToHtmlBlocks, articleToMarkdown, cardContent, extractArticle, splitHtmlBlock } from '../../src/core/wxImport'

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
  describe('sections that hold a whole chapter in one card', () => {
    // 仿秀米真实结构：整页底色 > 平铺纹理的单栏 > 单栏 > 白色卡片（内边距），卡片里是标题、正文和两个轮播
    const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
    const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 857 1142" style="width: 100%; background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
    const carousel = (a: number, b: number) => `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0px"><section style="display: inline-block; width: 100%; background-color: rgb(236, 246, 228); padding: 10px 30px"><section style="display: inline-block; width: 100%; border-style: dashed; border-width: 3px"><svg viewBox="0 0 857 1142" style="display: block">${slide(a)}${slide(b)}${slide(a)}<rect width="857" height="1142" fill="transparent"></rect></svg></section></section></section>`
    const pill = (t: string) => `<section style="text-align: center; margin: 10px 0px"><section style="display: inline-block; width: 180px; background-color: #9cc393"><p><b>${t}</b></p></section></section>`
    const para = (t: string) => `<section style="font-size: 14px; padding: 0px 5px"><p>${t}</p></section>`
    const card = (inner: string, shell = 'display: inline-block; width: 100%; background-color: rgb(255, 255, 255); padding: 20px; height: auto') =>
      `<section style="background-color: rgb(245, 254, 241); font-size: 16px"><section style="display: flex; flex-flow: row nowrap; width: 100%; background-repeat: repeat-y; padding: 0px 15px; background-image: url(&quot;${JPG(9)}&quot;)"><section style="display: flex; flex-flow: row nowrap; width: 100%"><section style="${shell}">${inner}</section></section></section></section>`
    const chapter = `${pill('风筝制作')}${para('下面展示的是制作风筝的有趣瞬间。')}${carousel(1, 2)}${pill('风筝成果展示')}${para('形态各异的风筝纷纷诞生。')}${carousel(3, 4)}`
    const blocksOf = (html: string) => articleToHtmlBlocks(parse(`<body><div id="r">${html}<p>后记</p></div></body>`).getElementById('r')!) as Block<'html'>[]
    const words = (html: string) => (parse(`<body>${html}</body>`).body.textContent ?? '').replace(/\s/g, '')

    it('gives each carousel a block of its own, wrapped in the same shells', () => {
      const blocks = blocksOf(card(chapter))
      expect(blocks.map((b) => b.props.label)).toEqual(['风筝制作', '下面展示的是制作风筝的有', '轮播（2 张）', '风筝成果展示', '形态各异的风筝纷纷诞生。', '轮播（2 张）', '后记'])
      const [first, , car, , , last] = blocks.map((b) => b.props.html)
      expect(car).toContain('<svg')
      expect(words(car)).toBe('')
      for (const b of blocks.slice(0, 6)) {
        expect(b.props.html).toContain('repeat-y')
        expect(b.props.html).toContain('background-color: rgb(255, 255, 255)')
      }
      // 卡片的上内边距只留给第一块，下内边距只留给最后一块，拼起来和原来一样
      expect(first).toContain('padding-top: 20px')
      expect(first).toContain('padding-bottom: 0')
      expect(car).toContain('padding-top: 0; padding-right: 20px; padding-bottom: 0')
      expect(last).toContain('padding-bottom: 20px')
      expect(blocks.map((b) => words(b.props.html)).join('')).toBe(words(card(chapter)) + '后记')
    })
    it('keeps the bare card content for the component library', () => {
      // 两个同样的小标题在卡片不同位置：模块的外壳边距不同，但收藏用的内容结构相同；纯文字段落不收
      const blocks = blocksOf(card(chapter))
      const content = blocks.map((b) => cardContent.get(b) ?? '')
      expect(content[0]).not.toBe('')
      expect(content[0]).not.toContain('repeat-y')
      expect(content[0]).toContain('font-size: 16px')
      expect(skeleton(content[0], parse)).toBe(skeleton(content[3], parse))
      expect(skeleton(blocks[0].props.html, parse)).not.toBe(skeleton(blocks[3].props.html, parse))
      expect(componentPieces(content[1], 'x', parse)).toEqual([])
      expect(componentPieces(content[2], 'x', parse)).toHaveLength(1)
      expect(cardContent.get(blocks[6])).toBeUndefined()
    })
    it('splits an already imported block on request, keeping its source', () => {
      const source = { kind: 'wechat' as const, title: '风筝', url: '', account: '' }
      const old = createBlock('html', { html: card(chapter), label: '大版块', source })
      const parts = splitHtmlBlock(old, parse)!
      expect(parts.map((b) => b.props.label)).toEqual(['风筝制作', '下面展示的是制作风筝的有', '轮播（2 张）', '风筝成果展示', '形态各异的风筝纷纷诞生。', '轮播（2 张）'])
      expect(parts.every((b) => b.props.source === source && b.id !== old.id)).toBe(true)
      expect(new Set(parts.map((b) => b.id)).size).toBe(parts.length)
      // 手动拆开时小卡片也拆；纯文字和拆不开的外壳不拆
      expect(splitHtmlBlock(createBlock('html', { html: card(`${pill('标题')}${para('正文')}`), label: 'x' }), parse)).toHaveLength(2)
      expect(splitHtmlBlock(createBlock('html', { html: '<p>一段</p><p>两段</p>', label: 'x' }), parse)).toBeNull()
      expect(splitHtmlBlock(createBlock('html', { html: card(chapter, 'display: inline-block; width: 100%; box-shadow: 0 0 4px #000'), label: 'x' }), parse)).toBeNull()
    })
    it('splits a very large card even without a carousel', () => {
      const long = Array.from({ length: 70 }, (_, i) => `${pill(`小标题${i}`)}${para('正文'.repeat(40))}`).join('')
      expect(blocksOf(card(long)).length).toBeGreaterThan(100)
    })
    it('keeps small cards, rows and shells that cannot be cut in one piece', () => {
      expect(blocksOf(card(`${pill('标题')}${para('正文')}`))).toHaveLength(2)
      // 固定高度、阴影、整张背景图的外壳拆开会变样
      for (const shell of ['display: inline-block; width: 100%; height: 900px', 'display: inline-block; width: 100%; box-shadow: 0 0 4px #000', `display: inline-block; width: 100%; background-image: url(&quot;${JPG(8)}&quot;); background-size: cover`]) {
        expect(blocksOf(card(chapter, shell))).toHaveLength(2)
      }
      // 横排的两栏
      expect(blocksOf(card(chapter, 'display: flex; flex-flow: row nowrap; width: 100%'))).toHaveLength(2)
    })
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
