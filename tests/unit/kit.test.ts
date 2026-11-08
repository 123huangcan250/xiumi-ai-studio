// 清华电机 · 德国实践套件：大型文本框、轮播、图片框、双图 / 三图 / 四图
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { blockLabel, cloneBlock, coerceProps, createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileBlock, compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import { applyOp, validateOp } from '../../src/core/ops'
import { addPicTo, blockPhotos, replacePhoto, swapPhotos } from '../../src/core/photos'
import { aiContext } from '../../src/core/quickActions'
import { textToRich } from '../../src/core/richtext'
import { sanitizeHtml } from '../../src/core/sanitize'
import { getTheme, THEMES } from '../../src/core/themes'
import { findBlock, flatBlocks, insertBlocksAt, insertionPoint, moveBlockTo, removeBlockById, replaceBlockWith, updateBlock } from '../../src/core/tree'
import type { Block, Doc, PicItem } from '../../src/core/types'

const theme = getTheme('thu-eea-de')
const parse = (s: string) => new JSDOM(s).window.document
const body = (html: string) => parse(`<!doctype html><body>${html}`).body
const img = (n: number) => ({ src: `/media/p${n}.jpg`, width: 1200, height: 900 })
const pics = (...list: (number | null)[]): PicItem[] => list.map((n, i) => (n ? { image: img(n), caption: `图注${i + 1}` } : { caption: '' }))
const doc = (blocks: Block[], themeId = 'thu-eea-de'): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId, blocks, createdAt: 0, updatedAt: 0 })
const para = (t: string) => createBlock('paragraph', { content: textToRich(t) })
const styleOf = (el: Element | null | undefined) => (el?.getAttribute('style') ?? '').replace(/\s/g, '')

describe('kit theme and typography', () => {
  it('kit theme sets 14px black body and 12px gray notes', () => {
    expect(theme.fontSize).toBe(14)
    expect(theme.colors.text).toBe('#000000')
    expect(theme.smallSize).toBe(12)
    expect(theme.colors.muted).toBe('#888888')
  })
  it('captions are 12px gray; empty captions leave no element in the export', () => {
    const b = createBlock('photos', { count: 2, pics: [{ image: img(1), caption: '慕尼黑工业大学' }, { image: img(2), caption: '' }] })
    const root = body(compileBlock(b, THEMES[1]))
    const caps = [...root.querySelectorAll('p')]
    expect(caps).toHaveLength(1)
    expect(caps[0].textContent).toContain('慕尼黑工业大学')
    expect(styleOf(caps[0])).toContain('font-size:12px')
    expect(styleOf(caps[0])).toContain('color:#888888')
  })
  it('canvas mode shows a caption slot and image placeholders that never reach the export', () => {
    const b = createBlock('photos', { count: 3, pics: pics(1, null, null) })
    const canvas = compileBlock(b, theme, { hints: true })
    expect(canvas).toContain('图注（可留空）')
    expect(body(canvas).querySelectorAll('img[data-slot]')).toHaveLength(2)
    const out = compileBlock(b, theme)
    expect(out).not.toContain('data-slot')
    expect(out).not.toContain('可留空')
    expect(compileDoc(doc([b])).warnings.some((w) => w.includes('2 个图片位置'))).toBe(true)
  })
})

describe('large text box', () => {
  const box = createBlock('box', {
    title: '亚琛工业大学',
    label: 'BERICHT · 02',
    children: [para('正文第一段'), createBlock('carousel', { pics: pics(1, 2) }), createBlock('photos', { count: 4, pics: pics(1, 2, 3, 4) })],
  })
  it('compiles the children inside a 14px black body', () => {
    const html = compileBlock(box, THEMES[1])
    const root = body(html)
    const bodySec = [...root.querySelectorAll('section')].find((s) => styleOf(s).includes('font-size:14px;color:#000000'))
    expect(bodySec).toBeTruthy()
    expect(bodySec!.textContent).toContain('正文第一段')
    expect(bodySec!.querySelectorAll('img')).toHaveLength(6)
    expect(html).toContain('亚琛工业大学')
  })
  it('modules inside adapt to the box: kit purple and 14px base even in another theme', () => {
    const card = createBlock('card', { title: '要点', content: textToRich('内容') })
    const outside = compileBlock(card, THEMES[1])
    const inside = compileBlock(card, THEMES[1], { inBox: true })
    expect(outside).toContain(THEMES[1].colors.primary)
    expect(inside).toContain('#660874')
    expect(inside).not.toContain(THEMES[1].colors.primary)
    expect(inside).toContain('font-size:15px') // 卡片标题 = 正文 14 + 1
  })
  it('all three styles render a header, body and the three-phase mark', () => {
    for (const variant of ['plate', 'rule', 'paper'] as const) {
      const html = compileBlock({ ...box, props: { ...box.props, variant } }, theme)
      expect(html).toContain('TSINGHUA · EEA')
      expect(body(html).querySelectorAll('svg path').length).toBeGreaterThanOrEqual(3)
    }
  })
  it('boxes cannot be nested, and copies get fresh child ids', () => {
    const [b] = normalizeBlocks([{ type: 'box', props: { children: [{ type: 'box', props: {} }, { type: 'paragraph', props: { content: 'x' } }] } }])
    expect((b as Block<'box'>).props.children.map((c) => c.type)).toEqual(['paragraph'])
    const copy = cloneBlock(box)
    expect(copy.props.children.map((c) => c.id)).not.toEqual(box.props.children.map((c) => c.id))
  })
})

describe('carousel', () => {
  it('scrolls horizontally with one slide per filled image and page numbers', () => {
    const b = createBlock('carousel', { pics: pics(1, null, 2, 3) })
    const html = compileBlock(b, theme)
    const root = body(html)
    const viewport = [...root.querySelectorAll('section')].find((s) => styleOf(s).includes('overflow-x:auto'))
    expect(viewport).toBeTruthy()
    const track = viewport!.firstElementChild!
    expect(styleOf(track)).toContain('width:252%') // 3 张 × 84%，露出下一张
    expect(styleOf(track)).toContain('max-width:252%!important')
    expect(track.children).toHaveLength(3)
    expect(html).toContain('/ 03')
    expect(html).toContain('左右滑动')
  })
  it('a single image is not a scroller; an empty carousel exports nothing', () => {
    expect(compileBlock(createBlock('carousel', { pics: pics(1) }), theme)).not.toContain('overflow-x')
    expect(compileBlock(createBlock('carousel', { pics: pics(null, null) }), theme)).toBe('')
  })
  it('full variant uses whole-width slides', () => {
    const html = compileBlock(createBlock('carousel', { variant: 'full', pics: pics(1, 2) }), theme)
    expect(html).toContain('width:200%')
  })
})

describe('frame and multi-image', () => {
  it('every frame style renders the photo, caption and label', () => {
    for (const variant of ['flag', 'circuit', 'ticket'] as const) {
      const html = compileBlock(createBlock('frame', { image: img(1), caption: '市政厅', label: 'MÜNCHEN', variant }), theme)
      expect(html).toContain('/media/p1.jpg')
      expect(html).toContain('市政厅')
      expect(html).toContain('MÜNCHEN')
    }
  })
  it('two / three / four images in both layouts keep every slot', () => {
    for (const count of [2, 3, 4] as const)
      for (const layout of ['even', 'feature'] as const) {
        const list = pics(...Array.from({ length: count }, (_, i) => i + 1))
        const html = compileBlock(createBlock('photos', { count, layout, pics: list }), theme)
        expect(body(html).querySelectorAll('img')).toHaveLength(count)
        expect(html).toContain(`图注${count}`)
      }
  })
  it('crops each slot with the layout ratio', () => {
    const html = compileBlock(createBlock('photos', { count: 3, layout: 'feature', pics: pics(1, 2, 3) }), theme)
    expect(html).toContain('/media/p1.jpg?fit=16%3A9')
    expect(html).toContain('/media/p2.jpg?fit=4%3A3')
  })
  it('pics always match the image count', () => {
    expect(coerceProps('photos', { count: 4, pics: pics(1) }).pics).toHaveLength(4)
    expect(coerceProps('photos', { count: 9 }).count).toBe(4)
    expect(blockLabel(createBlock('photos', { count: 3 }))).toBe('三图')
  })
  it('output passes the static WeChat checks and survives the importer sanitizer', () => {
    const blocks = [createBlock('box', { children: [para('a'), createBlock('frame', { image: img(1), variant: 'circuit' })] }), createBlock('carousel', { pics: pics(1, 2) }), createBlock('photos', { count: 2, pics: pics(1, 2) })]
    const r = compileDoc(doc(blocks))
    expect(r.warnings.filter((w) => !w.includes('本地图片'))).toEqual([])
    const clean = sanitizeHtml(r.html, parse)
    expect(clean).toContain('overflow-x: auto')
    expect(clean).toMatch(/<path d="M/)
  })
})

describe('module tree', () => {
  const kid = para('框内')
  const box = createBlock('box', { children: [kid] })
  const top = para('顶层')
  const blocks: Block[] = [box, top]

  it('finds, updates and removes blocks inside a box', () => {
    expect(findBlock(blocks, kid.id)).toMatchObject({ parent: { id: box.id }, index: 0 })
    expect(flatBlocks(blocks).map((b) => b.id)).toEqual([box.id, kid.id, top.id])
    const up = updateBlock(blocks, kid.id, (b) => ({ ...b, props: { ...b.props, align: 'center' } }) as Block)
    expect((findBlock(up, kid.id)!.block as Block<'paragraph'>).props.align).toBe('center')
    expect((removeBlockById(blocks, kid.id)[0] as Block<'box'>).props.children).toEqual([])
  })
  it('moves blocks into and out of a box, but never a box into a box', () => {
    const inBox = moveBlockTo(blocks, top.id, box.id, 1)
    expect(inBox).toHaveLength(1)
    expect((inBox[0] as Block<'box'>).props.children.map((c) => c.id)).toEqual([kid.id, top.id])
    const out = moveBlockTo(inBox, kid.id, null, 1)
    expect(out.map((b) => b.id)).toEqual([box.id, kid.id])
    const other = createBlock('box')
    expect(insertBlocksAt(blocks, box.id, 0, [other])).toBe(blocks)
  })
  it('replaces a child in place', () => {
    const parts = [para('一'), para('二')]
    const next = replaceBlockWith(blocks, kid.id, parts)
    expect((next[0] as Block<'box'>).props.children.map((c) => c.id)).toEqual(parts.map((p) => p.id))
  })
  it('clicking a module while a box is selected puts it in the box', () => {
    expect(insertionPoint(blocks, box.id, false)).toEqual({ parentId: box.id, index: 1 })
    expect(insertionPoint(blocks, kid.id, false)).toEqual({ parentId: box.id, index: 1 })
    expect(insertionPoint(blocks, kid.id, true)).toEqual({ parentId: null, index: 1 })
    expect(insertionPoint(blocks, top.id, false)).toEqual({ parentId: null, index: 2 })
  })
})

describe('editing kit modules', () => {
  it('AI can edit a module inside a box, and only captions of image slots', () => {
    const c = createBlock('carousel', { pics: pics(1, 2) })
    const d = doc([createBlock('box', { children: [para('旧'), c] })])
    const r = validateOp(d, { op: 'update', id: c.id, props: { pics: [{ image: '[图片]', caption: '新图注' }], children: [] } })
    expect(r.error).toBeUndefined()
    const next = applyOp(d, r.op!)
    const got = findBlock(next.blocks, c.id)!.block as Block<'carousel'>
    expect(got.props.pics.map((x) => x.image?.src)).toEqual(['/media/p1.jpg', '/media/p2.jpg'])
    expect(got.props.pics[0].caption).toBe('新图注')
    const ctx = JSON.stringify(aiContext(next))
    expect(ctx).toContain(c.id)
    expect(ctx).not.toContain('/media/p1.jpg')
  })
  it('assets fill empty slots, append to carousels and stop when a grid is full', () => {
    const grid = createBlock('photos', { count: 2, pics: pics(null, 2) })
    const filled = addPicTo(grid, img(9)) as Block<'photos'>
    expect(filled.props.pics[0].image?.src).toBe('/media/p9.jpg')
    expect(addPicTo(filled, img(8))).toBeNull()
    const car = addPicTo(createBlock('carousel', { pics: pics(1) }), img(9)) as Block<'carousel'>
    expect(car.props.pics).toHaveLength(2)
  })
  it('photos can be dropped on an empty slot and swapped across a box', () => {
    const grid = createBlock('photos', { count: 2, pics: pics(1, null) })
    const single = createBlock('image', { image: img(5) })
    const d = doc([createBlock('box', { children: [grid] }), single])
    expect(blockPhotos(grid).map((x) => x?.src ?? null)).toEqual(['/media/p1.jpg', null])
    const dropped = replacePhoto(d, { blockId: grid.id, index: 1 }, img(7), { allowEmpty: true })
    expect((findBlock(dropped.blocks, grid.id)!.block as Block<'photos'>).props.pics[1].image?.src).toBe('/media/p7.jpg')
    const swapped = swapPhotos(dropped, { blockId: grid.id, index: 0 }, { blockId: single.id, index: 0 })
    expect((findBlock(swapped.blocks, grid.id)!.block as Block<'photos'>).props.pics[0].image?.src).toBe('/media/p5.jpg')
    expect((findBlock(swapped.blocks, single.id)!.block as Block<'image'>).props.image?.src).toBe('/media/p1.jpg')
  })
  it('markdown export includes box children and captions', () => {
    const md = docToMarkdown(doc([createBlock('box', { title: '收获', children: [para('框内正文'), createBlock('photos', { count: 2, pics: pics(1, 2) })] })]))
    expect(md).toContain('### 收获')
    expect(md).toContain('框内正文')
    expect(md).toContain('![图注2](/media/p2.jpg)')
  })
})
