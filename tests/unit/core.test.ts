import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { BLOCK_TYPES, createBlock } from '../../src/core/blocks'
import { compileBlock, compileDoc, css, lintWechatHtml } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import { buildVariants } from '../../src/core/layouts'
import { applyOps, validateOp } from '../../src/core/ops'
import { parseArticle } from '../../src/core/outline'
import { analyzeStyle, themeFromReport } from '../../src/core/styleExtract'
import { THEMES } from '../../src/core/themes'
import type { ImageRef } from '../../src/core/types'

const SAMPLES = join(import.meta.dirname, '..', '..', 'samples')
const text = readFileSync(join(SAMPLES, 'activity.txt'), 'utf8')
const md = readFileSync(join(SAMPLES, 'activity.md'), 'utf8')
const images: ImageRef[] = Array.from({ length: 10 }, (_, i) => ({ src: `/media/p${i}.jpg`, alt: `photo-${String(i + 1).padStart(2, '0')}.jpg` }))
const httpsImages = (u: string) => `https://example.com${u}`

describe('css()', () => {
  it('drops unsupported or unsafe declarations', () => {
    expect(css({ position: 'absolute', color: '#fff', 'background-color': 'url(x)', width: 'var(--a)' })).toBe('color:#fff;')
    expect(css({ margin: 0, 'line-height': 1.8, 'font-size': 15 })).toBe('margin:0;line-height:1.8;font-size:15px;')
  })
})

describe('outline parsing', () => {
  it('plain text: title, sections, timeline, quotes, credits', () => {
    const o = parseArticle(text)
    expect(o.title).toBe('2026 秋季校园科技文化节圆满落幕')
    expect(o.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(['开幕式：从一盏灯开始', '数据一览', '结语']))
    const forum = o.sections.find((s) => s.heading.startsWith('主题论坛'))!
    expect(forum.timeline.length).toBe(6)
    expect(forum.timeline[0]).toMatchObject({ time: '09:00' })
    expect(o.sections.flatMap((s) => s.quotes).length).toBeGreaterThanOrEqual(1)
    expect(o.ending.author).toContain('摄影协会')
  })
  it('markdown: headings, tables, blockquotes', () => {
    const o = parseArticle(md)
    expect(o.title).toContain('科技文化节')
    expect(o.sections.find((s) => s.heading === '数据一览')?.table?.rows.length).toBe(5)
    expect(o.sections.flatMap((s) => s.quotes).some((q) => q.text.includes('科学不是少数人的游戏'))).toBe(true)
  })
})

describe('layout recipes', () => {
  const variants = buildVariants(parseArticle(text), images)
  it('produces three structurally different docs that use all 10 images', () => {
    expect(variants).toHaveLength(3)
    const signatures = variants.map(({ doc }) => doc.blocks.map((b) => b.type).join(','))
    expect(new Set(signatures).size).toBe(3)
    for (const { doc } of variants) {
      const used = new Set<string>()
      for (const b of doc.blocks) {
        const p: any = b.props
        if (p.image) used.add(p.image.src)
        p.images?.forEach((i: ImageRef) => used.add(i.src))
      }
      expect(used.size).toBe(10)
      expect(doc.blocks[0].type).toBe('cover')
      expect(doc.blocks.at(-1)!.type).toBe('ending')
    }
  })
  it('compiles to wechat-safe HTML within the draft API limit', () => {
    for (const { doc } of variants) {
      for (const theme of THEMES) {
        const r = compileDoc({ ...doc, themeId: theme.id }, { mapImage: httpsImages })
        expect(r.warnings, `${doc.themeId}/${theme.id}`).toEqual([])
        expect(r.html).not.toMatch(/class=|<script|<style|position:/)
        expect(r.charCount).toBeLessThan(20000)
      }
    }
  })
})

describe('compiled markup is well-formed', () => {
  it('only style/src/alt/href attributes survive parsing', () => {
    const doc = buildVariants(parseArticle(text), images)[1].doc
    for (const theme of THEMES) {
      const { html } = compileDoc({ ...doc, themeId: theme.id }, { mapImage: httpsImages })
      const dom = new JSDOM(html)
      const bad = new Set<string>()
      for (const el of dom.window.document.body.querySelectorAll('*'))
        for (const a of el.getAttributeNames()) if (!['style', 'src', 'alt', 'href'].includes(a)) bad.add(`${el.tagName}[${a}]`)
      expect([...bad], theme.id).toEqual([])
      // 根节点的字体栈完整保留
      expect(dom.window.document.body.firstElementChild!.getAttribute('style')).toContain('font-family')
    }
  })
})

describe('every block renders with every theme', () => {
  it('no throws and non-empty output', () => {
    for (const t of BLOCK_TYPES) for (const theme of THEMES) expect(compileBlock(createBlock(t), theme).length).toBeGreaterThan(10)
  })
  it('escapes user text', () => {
    const html = compileBlock(createBlock('quote', { text: '<img src=x onerror=alert(1)>' }), THEMES[0])
    expect(html).not.toContain('<img')
  })
  it('turns external links into text', () => {
    const b = createBlock('paragraph', {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '官网', marks: [{ type: 'link', attrs: { href: 'https://a.com' } }] }] }] },
    })
    const html = compileBlock(b, THEMES[0])
    expect(html).not.toContain('<a ')
    expect(html).toContain('https://a.com')
  })
})

describe('lint', () => {
  it('flags local images and forbidden markup', () => {
    expect(lintWechatHtml('<img src="/media/a.jpg">').length).toBe(1)
    expect(lintWechatHtml('<p class="x"><script></script></p>').length).toBe(2)
  })
})

describe('doc ops', () => {
  const doc = buildVariants(parseArticle(text), images)[0].doc
  it('validates and applies insert/update/move/remove', () => {
    const ins = validateOp(doc, { op: 'insert', index: 1, block: { type: 'card', props: { title: 'AI', content: '一段**文字**' } } })
    expect(ins.error).toBeUndefined()
    let d = applyOps(doc, [ins.op!])
    const card = d.blocks[1]
    expect(card.type).toBe('card')
    expect((card.props as any).content.type).toBe('doc')
    d = applyOps(d, [validateOp(d, { op: 'update', id: card.id, props: { title: '改' } }).op!])
    expect((d.blocks[1].props as any).title).toBe('改')
    d = applyOps(d, [{ op: 'move', id: card.id, to: 0 }])
    expect(d.blocks[0].id).toBe(card.id)
    d = applyOps(d, [{ op: 'remove', id: card.id }])
    expect(d.blocks.length).toBe(doc.blocks.length)
    expect(validateOp(d, { op: 'insert', block: { type: 'nope' } }).error).toBeTruthy()
    expect(validateOp(d, { op: 'update', id: 'missing', props: {} }).error).toBeTruthy()
  })
})

describe('markdown export', () => {
  it('round-trips the main structure', () => {
    const doc = buildVariants(parseArticle(text), images)[1].doc
    const out = docToMarkdown(doc)
    expect(out).toMatch(/^# 2026/)
    expect(out).toContain('## ')
    expect(out).toContain('| 项目 | 数据 |')
  })
})

describe('reference style learning', () => {
  it('extracts tokens and builds an original theme', () => {
    const html = `<section style="font-size:16px;color:#333333;line-height:2;letter-spacing:1px">
      <p style="margin:0 0 20px;font-size:16px;color:#333">正文段落内容比较长一点</p>
      <p style="font-size:20px;color:#c0392b;border-left:4px solid #c0392b">小标题</p>
      <p style="font-size:20px;color:#c0392b;border-left:4px solid #c0392b">小标题二</p>
      <p style="font-size:20px;color:#c0392b;border-left:4px solid #c0392b">小标题三</p>
      <section style="background-color:#fdf2f0;border-radius:8px"><p style="font-size:16px;margin-bottom:20px">卡片</p></section>
    </section>`
    const dom = new JSDOM(html)
    const r = analyzeStyle(dom.window.document)
    expect(r.lineHeight).toBe(2)
    const t = themeFromReport(r, '参考主题')
    expect(t.colors.primary).toBe('#c0392b')
    expect(t.fontSize).toBe(16)
    expect(t.headingVariant).toBe('bar')
    expect(t.radius).toBe(8)
  })
})
