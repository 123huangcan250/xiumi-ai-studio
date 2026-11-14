// 粘贴整页富文本：去掉来源页面的外框，把写死的像素尺寸换回百分比
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bestFrame } from '../../server/assets'
import { fluidStyle, sourceColumn, type BoxMetrics } from '../../src/core/fluid'
import type { Block } from '../../src/core/types'
import { articleToHtmlBlocks, extractArticle } from '../../src/core/wxImport'

const page = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'pasted-reader-page.html'), 'utf8')
const parse = (s: string) => new JSDOM(s).window.document
const box = (m: Partial<BoxMetrics> = {}): BoxMetrics => ({ cbw: 600, width: 0, height: 0, parentHeight: 0, parentDefinite: false, ...m })

describe('像素尺寸换回百分比', () => {
  it('converts fractional pixels and keeps authored integers', () => {
    const out = fluidStyle('box-sizing: border-box; width: 108.5px; margin-left: 491.5px; margin-top: 51.1875px; padding: 12px 32px 18px 22px; border-radius: 10px; font-size: 16.27px', box())
    expect(out).toContain('width: 18.0833%')
    expect(out).toContain('margin-left: 81.9167%')
    expect(out).toContain('margin-top: 8.5313%')
    expect(out).toContain('padding: 12px 32px 18px 22px')
    expect(out).toContain('border-radius: 10px')
    expect(out).toContain('font-size: 16.27px')
  })
  it('treats a full-width or round-percentage integer width as converted', () => {
    expect(fluidStyle('width: 600px', box())).toBe('width: 100%')
    expect(fluidStyle('width: 300px', box())).toBe('width: 50%')
    expect(fluidStyle('width: 40px; height: 6px', box())).toBe('width: 40px; height: 6px')
    expect(fluidStyle('width: 260px', box({ cbw: 634.547 }))).toBe('width: 260px')
  })
  it('converts shorthand components one by one and negative margins', () => {
    expect(fluidStyle('margin: 10px 0px 24.6px -34.4062px', box())).toBe('margin: 10px 0px 4.1% -5.7344%')
  })
  it('turns a derived height into a percentage of a definite parent, otherwise into an aspect ratio', () => {
    expect(fluidStyle('height: 144.25px', box({ parentDefinite: true, parentHeight: 400 }))).toBe('height: 36.0625%')
    expect(fluidStyle('height: 144.25px', box({ parentDefinite: true, parentHeight: 144.25 }))).toBe('height: 100%')
    expect(fluidStyle('width: 108.5px; height: 144.25px', box({ width: 108.5, height: 144.25 }))).toBe('width: 18.0833%; aspect-ratio: 108.5 / 144.25')
    expect(fluidStyle('height: 52px', box({ parentDefinite: true, parentHeight: 400 }))).toBe('height: 52px')
  })
  it('leaves a style without derived pixels untouched', () => {
    const st = 'box-sizing: border-box; width: 100%; margin: 0px; font-size: 15px'
    expect(fluidStyle(st, box())).toBe(st)
  })
})

describe('整页复制的阅读页', () => {
  const a = extractArticle(parse(page))
  const blocks = articleToHtmlBlocks(a.root) as Block<'html'>[]
  const html = blocks.map((b) => b.props.html).join('')

  it('keeps only the article body and reads the title from the page header', () => {
    expect(a.title).toBe('夏季运动会报名通知')
    expect(html).toContain('夏季运动会')
    expect(html).toContain('比赛项目包括')
    expect(html).not.toMatch(/投诉|阅读|2026-05-01|data:image/)
  })
  it('drops the negative margins of the page frame', () => {
    expect(html).not.toMatch(/margin-(left|right): -31px/)
    expect(html).not.toContain('padding-left: 16px')
  })
  it('finds the source column width', () => {
    expect(sourceColumn(a.root)?.width).toBe(600)
  })
  it('splits into modules and keeps the background shell around each without gaps', () => {
    expect(blocks.length).toBe(3)
    for (const b of blocks) {
      expect(b.props.html).toContain('background-color: rgb(238, 246, 255)')
      expect(b.props.html).toContain('display: flow-root')
    }
  })
  it('recognises the page frame without class names', () => {
    const bare = extractArticle(parse(page.replace(/ class="[^"]*"/g, '')))
    expect(bare.title).toBe('夏季运动会报名通知')
    const text = bare.root.textContent ?? ''
    expect(text).toContain('比赛项目包括')
    expect(text).not.toMatch(/投诉|2026-05-01/)
    expect(bare.root.innerHTML).not.toMatch(/data:image|margin-left: -31px/)
  })
  it('does not treat an ordinary pasted fragment as a page', () => {
    const plain = extractArticle(parse('<h2>标题</h2><p>第一段</p><p>第二段</p>'))
    expect(plain.root.textContent).toContain('标题')
    expect(plain.root.textContent).toContain('第二段')
  })
  it('drops an empty shell at the very beginning instead of making an empty module', () => {
    const doc = parse('<section style="box-sizing: border-box; font-size: 0px"><section style="box-sizing: border-box; width: 0px; height: 0px"></section></section><p>正文</p>')
    const list = articleToHtmlBlocks(extractArticle(doc).root) as Block<'html'>[]
    expect(list).toHaveLength(1)
    expect(list[0].props.html).toBe('<p>正文</p>')
  })
})

describe('复制时丢了动画的淡入图层', () => {
  const layer = (inner: string) =>
    `<section><svg viewBox="0 0 100 100"><svg width="20%" height="20%" x="0%" y="0%" opacity="0"><foreignObject width="100%" height="100%"></foreignObject>${inner}</svg><rect width="10" height="10" opacity="0"></rect></svg><p>正文</p></section>`
  it('shows a layer whose fade-in animation was lost, but leaves transparent hit areas alone', () => {
    const html = extractArticle(parse(layer(''))).root.innerHTML
    expect(html).toContain('<svg width="20%" height="20%" x="0%" y="0%">')
    expect(html).toContain('<rect width="10" height="10" opacity="0">')
  })
  it('keeps the starting state when the animation is still there', () => {
    const html = extractArticle(parse(layer('<animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"></animate>'))).root.innerHTML
    expect(html).toContain('y="0%" opacity="0"')
  })
})

describe('动图取帧', () => {
  /** 每一帧画满前 n 行，其余透明（GIF 的透明只有全透明和不透明两种） */
  const frames = async (rows: number[]) => {
    const w = 8
    const h = 8
    const raw = Buffer.alloc(w * h * 4 * rows.length)
    rows.forEach((n, f) => {
      for (let i = 0; i < w * n; i++) raw.set([30, 120 + f * 20, 230, 255], (f * w * h + i) * 4)
    })
    return sharp(raw, { raw: { width: w, height: h * rows.length, channels: 4, pageHeight: h } }).gif().toBuffer()
  }
  it('picks the fullest frame when the first one is blank', async () => {
    expect(await bestFrame(await frames([0, 4, 8]))).toBe(2)
  })
  it('keeps the first frame of an ordinary animation or a still image', async () => {
    expect(await bestFrame(await frames([8, 8, 8]))).toBe(0)
    expect(await bestFrame(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer())).toBe(0)
  })
})
