import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { componentBlock, fingerprint, hueFamily, makeDraft, searchComponents, validateDraft, type LibraryComponent } from '../../src/core/components'
import { componentPieces, expandPick, fragmentHtml, fragmentLabel, fragmentStats, horizontalInset, insertionAnchor, isCarousel, pickElement, placeFragment, splitCandidates } from '../../src/core/fragments'
import { displayHtml, displayUrl, rehostUrls, rewriteImages, storedHtml } from '../../src/core/images'
import { collectColors, docMainColors, fixedDecorCount, harmonize, recolorHtml } from '../../src/core/recolor'
import { sanitizeHtml } from '../../src/core/sanitize'
import { backgroundPhotos, extractSlots, removeBackgroundPhotos, setBackgroundPhoto, skeleton } from '../../src/core/slots'
import { guessKind } from '../../src/core/templateFill'
import { asciiHtml, makeZip, replaceLocalImages, splitForXiumi, xiumiLength, xiumiReport, xiumiSvgBoxes } from '../../src/core/xiumiExport'
import { THEMES } from '../../src/core/themes'
import { toHsl } from '../../src/core/color'
import type { Doc } from '../../src/core/types'
import { detectSource } from '../../src/core/wxImport'

const parse = (s: string) => new JSDOM(s).window.document
const rootOf = (html: string) => parse(`<!doctype html><body><section id="r">${html}</section></body>`).getElementById('r')!
const source = { kind: 'xiumi' as const, title: '测试', url: '', account: '' }

/** 仿真实秀米版块：图片卡、胶囊标题（×2）、正文、轮播，都包在一层白底容器里 */
const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
const card = (t: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 100%; padding: 5px; border: 1px solid #528065"><img src="${JPG(1)}" style="width: 100%"><p style="font-size: 13px">${t}</p></section></section>`
const pill = (t: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 180px"><section style="display: flex; flex-flow: row nowrap"><section style="display: inline-block; width: 33%"><svg viewBox="0 0 10 10"><rect fill="#9cc393" width="10" height="10"></rect></svg></section><section style="display: inline-block; width: auto"><p style="color: #528065"><strong>${t}</strong></p></section><section style="display: inline-block; width: 33%"><svg viewBox="0 0 10 10"><rect fill="#9cc393" width="10" height="10"></rect></svg></section></section></section></section>`
const para = (t: string) => `<section style="padding: 0 5px; box-sizing: border-box"><p>${t}</p></section>`
const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 1080 720" style="background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
const carousel = `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0"><section style="display: inline-block; width: 100%; background-color: #ecf6e4"><svg viewBox="0 0 1080 720" style="display: block">${slide(1)}${slide(2)}${slide(1)}<animate attributeName="opacity" values="0;1"></animate></svg></section></section>`
const BIG = `<section style="background-color: #f5fef1; font-size: 16px; color: rgb(62, 62, 62); letter-spacing: 1px"><section style="display: flex; flex-flow: row nowrap; width: 100%"><section style="display: inline-block; width: 100%; background-color: #ffffff; padding: 20px">${card('图注甲')}${pill('制作准备')}${para('一段正文。')}${card('图注乙')}${pill('成果展示')}${para('又一段正文。')}${carousel}</section></section></section>`
/** 秀米拼图标题：网格里的碎片 + 标题 */
const GRID = `<section style="display: grid; width: 100%"><section style="width: 40%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/a/0?wx_fmt=png" style="width: 100%"></section><section style="width: 30%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/b/0?wx_fmt=png" style="width: 100%"></section><section style="display: flex"><svg viewBox="0 0 90 20"><foreignObject width="100%" height="100%"><p style="font-size: 18px">章节标题</p></foreignObject></svg></section></section>`

describe('fragment picking', () => {
  it('picks the outermost svg, the enclosing block for inline text, and the whole grid for collage pieces', () => {
    const r = rootOf(`<section style="padding: 4px"><p>文字<strong id="s">加粗</strong></p><p>第二段</p></section>${GRID}${carousel}`)
    expect(pickElement(r.querySelector('#s')!, r)!.tagName.toLowerCase()).toBe('p')
    const grid = r.children[1]
    expect(pickElement(grid.querySelector('img')!, r)).toBe(grid)
    const rect = r.querySelector('foreignObject svg')!
    const svg = rect.closest('svg')!.parentElement!.closest('svg')!
    expect(r.contains(svg)).toBe(true)
    // 透明外壳（只有一个子元素）一并选中，保留底色和内边距
    expect(pickElement(rect, r)).toBe(r.children[2])
    expect(pickElement(r, r)).toBeNull()
  })
  it('expands one level at a time and stops at the block', () => {
    const r = rootOf(`<section id="outer"><section id="inner"><p id="a">甲</p><p>乙</p></section><p>丙</p></section><p>丁</p>`)
    const a = pickElement(r.querySelector('#a')!, r)!
    expect(a.id).toBe('a')
    const up = expandPick(a, r)!
    expect(up.id).toBe('inner')
    expect(expandPick(up, r)!.id).toBe('outer')
    expect(expandPick(r.querySelector('#outer')!, r)).toBeNull()
  })
  it('keeps inherited text styles on the extracted fragment', () => {
    const r = rootOf('<section style="color: #528065; font-size: 18px; padding: 9px"><section style="letter-spacing: 2px"><p id="p" style="color: #111111; margin: 0">标题</p></section></section>')
    const out = fragmentHtml(r.querySelector('#p')!, r)
    expect(out).toContain('letter-spacing: 2px')
    expect(out).toContain('font-size: 18px')
    expect(out).toContain('color: #111111')
    expect(out).not.toContain('#528065') // 自身已有颜色，不覆盖
    // 不可继承的样式不写到片段自身；外层的内边距变成外面一圈左右空白
    expect(parse(`<body>${out}</body>`).getElementById('p')!.getAttribute('style')).not.toContain('padding')
    expect(out.startsWith('<section style="padding-left: 9px; padding-right: 9px; box-sizing: border-box"><p id="p"')).toBe(true)
  })
  it('keeps the side space the outer layers gave the fragment', () => {
    // 仿真实大版块：纹理单栏左右 15px、白色卡片 20px，里面的图片框插入后应和原来一样宽
    const r = rootOf(`<section style="background-color: #f5fef1"><section style="display: flex; padding: 0px 15px"><section style="display: inline-block; width: 100%; padding: 20px"><section id="frame" style="margin: 10px 0px; border: 1px solid #9cc393"><img src="${JPG(1)}"></section></section></section></section>`)
    const out = fragmentHtml(r.querySelector('#frame')!, r)
    expect(out.startsWith('<section style="padding-left: 35px; padding-right: 35px; box-sizing: border-box"><section id="frame"')).toBe(true)
    const el = (style: string) => rootOf(`<section style="${style}"></section>`).firstElementChild!
    expect(horizontalInset([el('padding: 4px 6px 8px'), el('margin: 0 auto; border: 2px dashed #000')])).toEqual([8, 8])
    expect(horizontalInset([el('padding: 10px; padding-left: 3px; border-left: 1px solid; border-right: none')])).toEqual([4, 10])
    expect(horizontalInset([el('padding: 0 5%; margin-left: -12px; border-width: 0 3px')])).toEqual([0, 3])
    expect(horizontalInset([el('padding: 0'), el('')])).toEqual([0, 0])
    expect(fragmentHtml(r.querySelector('#frame')!, r.querySelector('#frame')!.parentElement!)).not.toContain('padding-left')
  })

  it('puts a component into the big block after the paragraph holding the caret, without doubling the side space', () => {
    const card = (body: string) =>
      rootOf(`<section style="background-color: #f5fef1"><section style="display: flex; padding: 0px 15px"><section id="card" style="display: inline-block; width: 100%; padding: 20px"><p id="p1"><span><strong id="b">文字一</strong></span></p>${body}<p id="p2">文字二</p></section></section></section>`)
    const frame = `<section style="padding-left: 35px; padding-right: 35px; box-sizing: border-box"><section id="frame" style="border: 1px solid #9cc393"><img src="${JPG(1)}"></section></section>`
    let r = card('')
    const caret = r.querySelector('#b')!.firstChild!
    const anchor = insertionAnchor(caret, r)!
    expect(anchor.id).toBe('p1')
    const added = placeFragment(anchor, r, frame)
    // 插回卡片里：外层已经留了 35px，外包的留白去掉，图片框就在第一段和第二段之间
    expect(added.map((e) => e.id)).toEqual(['frame'])
    expect(Array.from(r.querySelector('#card')!.children).map((e) => e.id)).toEqual(['p1', 'frame', 'p2'])
    expect(r.innerHTML).not.toContain('padding-left: 35px')
    // 只有一部分留白时补上差值
    r = card('')
    placeFragment(r.querySelector('#card')!, r, frame)
    expect(r.querySelector('#frame')!.parentElement!.getAttribute('style')).toBe('padding-left: 20px; padding-right: 20px; box-sizing: border-box')
    // 正文外面又包了一层 5px：最后一段后面插入时放到这层外面，宽度和原来一样；不是最后一段时留在原处
    r = card(`<section id="text" style="padding: 0 5px"><p id="t1">甲</p><p id="t2">乙</p><p><br></p></section>`)
    placeFragment(insertionAnchor(r.querySelector('#t2')!.firstChild, r)!, r, frame)
    expect(Array.from(r.querySelector('#card')!.children).map((e) => e.id)).toEqual(['p1', 'text', 'frame', 'p2'])
    r = card(`<section id="text" style="padding: 0 5px"><p id="t1">甲</p><p id="t2">乙</p></section>`)
    placeFragment(insertionAnchor(r.querySelector('#t1')!.firstChild, r)!, r, frame)
    expect(Array.from(r.querySelector('#text')!.children).map((e) => e.id)).toEqual(['t1', 'frame', 't2'])
    // 光标在一栏的段落里时放在这一栏里；光标就在横排的一格上时放到整行后面，不添一栏；SVG 轮播按整个轮播算；不在内容里时返回 null
    r = card(`<section id="row" style="display: flex"><section id="col" style="flex: 1"><p id="c">左栏</p></section><section id="cell" style="flex: 1">右栏</section></section><section id="wrap"><svg id="svg"><g><foreignObject><p id="deep">x</p></foreignObject></g></svg></section>`)
    expect(insertionAnchor(r.querySelector('#c')!.firstChild, r)!.id).toBe('c')
    expect(insertionAnchor(r.querySelector('#cell')!.firstChild, r)!.id).toBe('row')
    expect(insertionAnchor(r.querySelector('#deep')!.firstChild, r)!.id).toBe('svg')
    expect(insertionAnchor(r, r)).toBeNull()
    expect(insertionAnchor(null, r)).toBeNull()
    expect(insertionAnchor(rootOf('<p>外面</p>').firstChild, r)).toBeNull()
  })
})

describe('split suggestions on a Xiumi-like block', () => {
  const list = splitCandidates(BIG, parse)
  it('finds the photo card, pill heading and carousel, merging repeats', () => {
    const cardItem = list.find((f) => f.html.includes('border: 1px solid #528065') && f.depth === 0)!
    expect(cardItem).toMatchObject({ repeat: 2, texts: 1, photos: 1 })
    const pillItem = list.find((f) => f.label === '制作准备')!
    expect(pillItem.repeat).toBe(2)
    const c = list.find((f) => f.bgPhotos > 0)!
    expect(c.bgPhotos).toBe(2) // 三张幻灯片里两张相同
  })
  it('lists a carousel that fills most of its block', () => {
    // 真实模板：轮播占整个模块九成以上，只多一段短文字，之前会被当成“几乎整块”漏掉
    const many = carousel.replace(slide(1) + slide(2), [1, 2, 3, 4, 5, 6, 7, 8].map(slide).join(''))
    const block = `<section style="background-color: #f5fef1"><section style="padding: 20px">${para('一段很短的正文。')}${many}</section></section>`
    expect(many.length / block.length).toBeGreaterThan(0.9)
    const c = splitCandidates(block, parse).find((f) => f.bgPhotos > 0)!
    expect(c.bgPhotos).toBe(8)
    expect(c.label).toBe('轮播（8 张）')
    expect(isCarousel(c.html, parse)).toBe(true)
  })
  it('does not repeat a fragment that is practically the whole block', () => {
    expect(splitCandidates(`<section><section style="margin: 1px">${carousel}</section></section>`, parse)).toEqual([])
  })
  it('recognises carousels and names components by content', () => {
    expect(isCarousel(carousel, parse)).toBe(true)
    expect(isCarousel(card('x'), parse)).toBe(false)
    expect(isCarousel(`<svg viewBox="0 0 10 10" style="background-image: url(${JPG(1)})"></svg>`, parse)).toBe(false)
    expect(fragmentLabel(carousel, parse)).toBe('轮播（2 张）')
    expect(fragmentLabel(pill('制作准备'), parse)).toBe('制作准备')
    expect(fragmentLabel(`<section><img src="${JPG(1)}"></section>`, parse)).toBe('图片框（1 张）')
    expect(fragmentLabel('<section style="border: 1px solid #000"></section>', parse)).toBe('装饰组件')
    const d = makeDraft({ name: 'x', tags: ['活动'], block: createBlock('html', { html: carousel }), source, via: 'fragment', attested: true }, parse)
    expect(d.tags).toEqual(['活动', '轮播'])
    expect(d.kind).toBe('image')
  })
  it('skips plain paragraphs even with box-sizing: border-box', () => {
    expect(list.some((f) => f.label.includes('正文'))).toBe(false)
  })
  it('does not split a pill heading row or a grid collage', () => {
    expect(list.some((f) => f.chars < 300 && f.html.includes('<rect'))).toBe(false)
    expect(splitCandidates(GRID, parse)).toEqual([])
  })
  it('carries inherited styles and sanitizes each fragment', () => {
    const dirty = BIG.replace('<p>一段正文。</p>', '<p onclick="x()">一段正文。</p>')
    for (const f of splitCandidates(dirty, parse)) {
      expect(f.html).not.toMatch(/onclick/)
      expect(f.html).toContain('letter-spacing: 1px')
    }
  })
  it('breaks big imported blocks into first-level pieces and skips plain text', () => {
    const pad = BIG.replace('一段正文。', '正文'.repeat(3000))
    expect(componentPieces(pad, '大版块', parse).length).toBeGreaterThanOrEqual(3)
    expect(componentPieces('<p>只有文字</p>', '段落', parse)).toEqual([])
    expect(componentPieces(card('小卡片'), '小卡片', parse)).toEqual([{ html: card('小卡片'), label: '小卡片' }])
  })
  it('counts fragment stats', () => {
    expect(fragmentStats(card('x'), parse)).toMatchObject({ texts: 1, photos: 1, bgPhotos: 0 })
  })
})

describe('background photos', () => {
  it('lists distinct photos with counts, ignoring textures and backgrounds with text', () => {
    const html = `${carousel}<section style="background-image: url(https://mmbiz.qpic.cn/paper/0?wx_fmt=png)"><p>纹理</p></section><section style="background-image: url(${JPG(9)})"><p>文字压在照片上</p></section>`
    expect(backgroundPhotos(html, parse).map((b) => [b.src, b.count])).toEqual([[JPG(1), 2], [JPG(2), 1]])
  })
  it('replaces every use of one photo, cropped to the viewBox, and survives sanitizing', () => {
    const out = setBackgroundPhoto(carousel, JPG(1), { src: '/media/new.jpg' }, { parse })
    expect(backgroundPhotos(out, parse).map((b) => b.src)).toEqual(['/media/new.jpg?fit=100%3A67&w=1080', JPG(2)])
    expect(out).not.toContain('p1/')
    expect(sanitizeHtml(out, parse)).toContain('/media/new.jpg?fit=100%3A67')
    expect(extractSlots(out, parse)).toEqual(extractSlots(carousel, parse))
  })
  it('rejects unsafe sources', () => {
    expect(setBackgroundPhoto(carousel, JPG(1), { src: 'javascript:alert(1)' }, { parse })).toBe(carousel)
  })
  it('exports replaced backgrounds through the image mapping', () => {
    const html = setBackgroundPhoto(carousel, JPG(1), { src: '/media/new.jpg' }, { parse })
    const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: [createBlock('html', { html })], createdAt: 0, updatedAt: 0 }
    const urls: string[] = []
    const r = compileDoc(doc, { mapImage: (u) => (urls.push(u), 'https://mmbiz.qpic.cn/uploaded') })
    expect(urls.filter((u) => u.startsWith('/media/'))).toHaveLength(2)
    expect(r.html).not.toContain('/media/')
    expect(r.html.split('https://mmbiz.qpic.cn/uploaded').length - 1).toBe(2)
    expect(compileDoc(doc).warnings.join()).toContain('本地图片')
  })
  it('treats photos that differ only by background as the same structure', () => {
    expect(skeleton(carousel, parse)).toBe(skeleton(setBackgroundPhoto(carousel, JPG(2), { src: '/media/x.jpg' }, { parse }), parse))
    expect(removeBackgroundPhotos(carousel, parse).html).not.toContain('<svg')
  })
})

describe('sanitize image sources', () => {
  it('keeps local and Xiumi backgrounds, drops others, and does not break data URIs', () => {
    const html = sanitizeHtml(
      '<section style="background-image: url(/media/a.jpg?fit=100%3A50&amp;w=1080)">甲</section><section style="background-image: url(//img.xiumi.us/x.jpg)">乙</section><section style="background-image: url(https://evil.com/x.jpg)">丙</section><section style="background-image: url(&quot;data:image/png;base64,AAAA&quot;); color: #123456">丁</section>',
      parse,
    )
    expect(html).toContain('/media/a.jpg?fit=100%3A50')
    expect(html).toContain('https://img.xiumi.us/x.jpg')
    expect(html).not.toContain('evil.com')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('color: #123456')
  })
  it('keeps protocol-relative images', () => {
    expect(sanitizeHtml('<img src="//img.xiumi.us/x.png">', parse)).toContain('src="https://img.xiumi.us/x.png"')
  })
})

describe('rehosting', () => {
  const html = '<img src="https://img.xiumi.us/a.png"><img src="https://mmbiz.qpic.cn/b/0"><section style="background-image: url(&quot;https://statics.xiumi.us/c.jpg&quot;); color: red">甲</section>'
  it('only collects Xiumi hosted images', () => {
    expect(rehostUrls(html, parse)).toEqual(['https://img.xiumi.us/a.png', 'https://statics.xiumi.us/c.jpg'])
  })
  it('rewrites what was saved and leaves the rest', () => {
    const out = rewriteImages(html, { 'https://statics.xiumi.us/c.jpg': '/media/c.jpg' }, parse)
    expect(out).toContain('url(&quot;/media/c.jpg&quot;)')
    expect(out).toContain('https://img.xiumi.us/a.png')
    expect(out).toContain('https://mmbiz.qpic.cn/b/0')
  })
  it('warns about Xiumi images that were not rehosted', () => {
    const doc = (h: string): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: [createBlock('html', { html: h })], createdAt: 0, updatedAt: 0 })
    expect(compileDoc(doc('<img src="https://img.xiumi.us/a.png">')).warnings.join()).toContain('秀米图片')
    expect(compileDoc(doc('<section style="background-image: url(&quot;https://img.xiumi.us/a.png&quot;)"></section>')).warnings.join()).toContain('秀米图片')
    expect(compileDoc(doc('<img src="https://mmbiz.qpic.cn/a/0">')).warnings.join()).not.toContain('秀米图片')
  })
  it('detects the source of pasted content', () => {
    expect(detectSource(parse('<section powered-by="xiumi.us"><p>甲</p></section>'))).toBe('xiumi')
    expect(detectSource(parse('<img src="https://img.xiumi.us/a.png">'))).toBe('xiumi')
    expect(detectSource(parse('<section powered-by="xiumi.us"><img src="https://mmbiz.qpic.cn/a/0"></section>'))).toBe('wechat')
    expect(detectSource(parse('<p>甲</p>'), 'https://mp.weixin.qq.com/s/abc')).toBe('wechat')
    expect(detectSource(parse('<p>甲</p>'))).toBe('other')
  })
})

describe('displaying WeChat backgrounds', () => {
  const stored = '<section style="background-image: url(&quot;https://mmbiz.qpic.cn/sz_mmbiz_jpg/a/640?wx_fmt=jpeg&amp;x=1&quot;)"><img src="https://mmbiz.qpic.cn/b/0"></section><svg style="background-image: url(/media/a.jpg)"></svg>'
  it('routes only WeChat backgrounds through the local server', () => {
    const shown = displayHtml(stored)
    expect(shown).toContain('url(&quot;/api/wx-image?u=https%3A%2F%2Fmmbiz.qpic.cn')
    expect(shown).toContain('<img src="https://mmbiz.qpic.cn/b/0">')
    expect(shown).toContain('url(/media/a.jpg)')
    expect(displayUrl('https://img.xiumi.us/a.jpg')).toBe('https://img.xiumi.us/a.jpg')
  })
  it('round-trips back to the original address', () => {
    expect(storedHtml(displayHtml(stored))).toBe(stored)
  })
  it('keeps the original address through DOM serialisation and sanitizing', () => {
    const el = parse(`<!doctype html><body>${displayHtml(stored)}`).body
    const back = sanitizeHtml(storedHtml(el.innerHTML), parse)
    expect(back).toContain('https://mmbiz.qpic.cn/sz_mmbiz_jpg/a/640?wx_fmt=jpeg')
    expect(back).not.toContain('wx-image')
  })
})

describe('export for Xiumi', () => {
  const html = '<img src="/media/a.jpg?fit=100%3A50&amp;w=1080"><section style="background-image: url(&quot;/media/b.png?w=1080&quot;)"></section><img src="https://mmbiz.qpic.cn/x/0?wx_fmt=png"><svg style="background-image: url(&quot;/media/a.jpg?fit=100%3A50&amp;w=1080&quot;)"></svg><img src="data:image/gif;base64,AAAA"><section style="background-image: url(&quot;https://mmbiz.qpic.cn/y/0&quot;)"></section>'
  it('numbers local images in article order and reuses the number for repeats', () => {
    const seen: string[] = []
    const r = replaceLocalImages(html, (u, i) => (seen.push(u), `data:image/jpeg;base64,P${i}`))
    expect(seen).toEqual(['/media/a.jpg?fit=100%3A50&w=1080', '/media/b.png?w=1080'])
    expect(r.urls).toEqual(seen)
    expect(r.html).not.toContain('/media/')
    expect(r.html.split('base64,P0').length - 1).toBe(2)
    expect(r.html).toContain('https://mmbiz.qpic.cn/x/0?wx_fmt=png')
    expect(r.html).toContain('url(&quot;data:image/jpeg;base64,P1&quot;)')
  })
  it('reports what Xiumi cannot take', () => {
    expect(xiumiReport(html)).toEqual({ localImages: 2, localBackgrounds: 2, dataImages: 1, backgrounds: 3 })
    expect(xiumiReport('<img src="https://mmbiz.qpic.cn/x/0">')).toEqual({ localImages: 0, localBackgrounds: 0, dataImages: 0, backgrounds: 0 })
  })
  it('builds a valid stored zip with utf-8 names', async () => {
    const data = new TextEncoder().encode('内容')
    const zip = makeZip([{ name: '图片/01.jpg', data }, { name: 'a.txt', data: new Uint8Array() }])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true)).toBe(0x0800)
    expect(view.getUint32(14, true)).toBe(zlib.crc32(data))
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(zip.length - 12, true)).toBe(2)
    const nameLen = view.getUint16(26, true)
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe('图片/01.jpg')
    expect(new TextDecoder().decode(zip.slice(30 + nameLen, 30 + nameLen + data.length))).toBe('内容')
  })
  it('writes the import file as pure ASCII, so reading it as GBK cannot garble the Chinese', () => {
    const src =
      `<section style="font-family: 'PingFang SC', 微软雅黑"><p>清华电机 · 赴德国实践 × 2026 🇩🇪&nbsp;50 Hz · 3φ · 120°</p>` +
      `<img src="https://example.com/图片.jpg" alt="双图 · 建议 4:3"><svg viewBox="0 0 10 10"><text x="0" y="5">TSINGHUA · EST. 1911</text></svg></section>` +
      compileDoc({ id: 'd', title: '实践', author: '', digest: '', themeId: 'thu-eea-de', createdAt: 0, updatedAt: 0, blocks: [createBlock('box'), createBlock('photos')] }).html
    const out = asciiHtml(src)
    expect(out).not.toMatch(/[\u0080-\u{10FFFF}]/u)
    // 解析后与原文完全一致：正文、属性、SVG 文字、emoji（两个码位）都还原
    expect(rootOf(out).innerHTML).toBe(rootOf(src).innerHTML)
    expect(out).toContain('&#x1F1E9;&#x1F1EA;')
    // 原问题：不带 BOM 的 UTF-8 按 GBK 读，· 变成“路”；ASCII 文件按 GBK 读不变
    const asGbk = (s: string) => new TextDecoder('gbk').decode(new TextEncoder().encode(s))
    expect(asGbk(src)).toContain('路')
    expect(asGbk(out)).toBe(out)
  })
  it('splits an article longer than the xiumi import limit at module boundaries, keeping the outer container', () => {
    const para = (i: number, n: number) => `<section style="margin-bottom: 16px"><p title="a>b">段落${i} ${'字'.repeat(n)}</p><img src="x.jpg" alt=""><br><svg viewBox="0 0 2 2"><rect width="1" height="1"/></svg></section>`
    const root = (kids: string) => `<section style="font-size: 16px; color: #333">${kids}</section>`
    const kids = Array.from({ length: 10 }, (_, i) => para(i, 2000)).join('')
    const html = root(kids)
    expect(splitForXiumi(html, 1_000_000)).toEqual([html])
    const parts = splitForXiumi(html, 7000)
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) {
      expect(xiumiLength(p)).toBeLessThanOrEqual(7000)
      expect(p.startsWith('<section style="font-size: 16px; color: #333"><section style="margin-bottom: 16px">')).toBe(true)
      expect(rootOf(p).children.length).toBe(1) // 每段是一个完整闭合的元素
    }
    // 拼回去与原文一致：一个模块都不少、不重复
    expect(parts.map((p) => p.slice(root('').length - '</section>'.length, -'</section>'.length)).join('')).toBe(kids)

    // 单个模块太长：往里一层切，外层两级容器都保留
    const big = root(`<section style="border: 1px solid #000">${Array.from({ length: 6 }, (_, i) => `<p>${i}${'长'.repeat(3000)}</p>`).join('')}</section>`)
    const pieces = splitForXiumi(big, 7000)
    expect(pieces.length).toBe(3)
    for (const p of pieces) expect(p).toMatch(/^<section style="font-size: 16px; color: #333"><section style="border: 1px solid #000"><p>\d长/)
    expect(pieces.map((p) => rootOf(p).textContent).join('')).toBe(rootOf(big).textContent)

    // 实体按还原后的一个字符算（导出文件里中文写成实体，秀米按还原后计数）
    expect(xiumiLength('&#x6587;&#x5B57;&amp;')).toBe(3)
  })
  it('puts every svg in a zero line-height box so xiumi cannot push it down and clip it', () => {
    const icon = '<svg viewBox="0 0 14 14" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;width:14px;height:14px;overflow:hidden;margin:2px 6px 0 0"><rect x="1" y="4" width="11" height="8"></rect></svg>'
    const inline = '<svg viewBox="0 0 9 9" width="9" height="9" style="display:inline-block;vertical-align:middle;width:9px"><circle cx="4" cy="4" r="3"></circle></svg>'
    const src = `<section style="display:flex;align-items:flex-start">${icon}<span>图｜变电设备</span></section><p>前${inline}后</p><svg viewBox="0 0 1 1"></svg>`
    const out = xiumiSvgBoxes(src)
    const root = rootOf(out)
    const [a, b] = [...root.querySelectorAll('svg')].map((s) => s as SVGElement)
    // 外层盒子：行高 0，带走外边距和 flex；SVG 本身是块级、只保留尺寸
    const boxA = a.parentElement as HTMLElement
    expect(boxA.tagName).toBe('SECTION')
    expect(boxA.style.lineHeight).toBe('0')
    expect(boxA.style.fontSize).toBe('0px')
    expect(boxA.style.margin).toBe('2px 6px 0px 0px')
    expect(boxA.style.flexShrink).toBe('0')
    expect(boxA.style.width).toBe('14px')
    expect(a.style.display).toBe('block')
    expect(a.style.margin).toBe('')
    expect(a.style.width).toBe('14px')
    expect(a.style.overflow).toBe('hidden')
    expect(boxA.parentElement!.style.display).toBe('flex')
    // 行内的 SVG 用行内块包，不打断段落
    const boxB = b.parentElement as HTMLElement
    expect(boxB.tagName).toBe('SPAN')
    expect(boxB.parentElement!.tagName).toBe('P')
    expect(boxB.style.display).toBe('inline-block')
    expect(boxB.style.verticalAlign).toBe('middle')
    expect(boxB.style.lineHeight).toBe('0')
    // 内容不变、没写样式的 SVG 不动
    expect(a.innerHTML).toBe('<rect x="1" y="4" width="11" height="8"></rect>')
    expect(root.textContent).toBe(rootOf(src).textContent)
    expect(out).toContain('<svg viewBox="0 0 1 1"></svg>')
  })
})

describe('recolor', () => {
  const GREEN = '<section style="background-color: #eef6ea; border: 1px solid rgb(82, 128, 101); color: #333333"><p style="color: rgba(82, 128, 101, 0.5)">甲</p><svg><rect fill="#9cc393" stroke="#ffffff"></rect><animate attributeName="fill" values="#9cc393;#528065"></animate></svg><section style="background-image: url(https://mmbiz.qpic.cn/a#abcdef)"></section></section>'
  it('collects chromatic colours and ignores urls', () => {
    const colors = collectColors(GREEN, parse)
    expect(colors.find((c) => c.hex === '#333333')?.chroma).toBe(false)
    expect(colors.find((c) => c.hex === '#ffffff')?.chroma).toBe(false)
    expect(colors.find((c) => c.hex === '#9cc393')?.chroma).toBe(true)
    expect(colors.some((c) => c.hex === '#abcdef')).toBe(false)
  })
  it('recolours styles, svg attributes and animations while keeping alpha and urls', () => {
    const out = recolorHtml(GREEN, { '#9cc393': '#aa00aa', '#528065': '#112233' }, parse)
    expect(out).toContain('fill="#aa00aa"')
    expect(out).toContain('values="#aa00aa;#112233"')
    expect(out).toContain('rgba(17, 34, 51, 0.5)')
    expect(out).toContain('border: 1px solid #112233')
    expect(out).toContain('#abcdef')
    expect(out).toContain('#333333')
  })
  it('moves hue to the target while keeping lightness', () => {
    const map = harmonize(collectColors(GREEN, parse), { primary: '#7f5bc8', accent: '#c8a44d' })
    const target = toHsl('#7f5bc8').h
    for (const [from, to] of Object.entries(map)) {
      expect(Math.abs(toHsl(to).h - target)).toBeLessThan(3)
      expect(Math.abs(toHsl(to).l - toHsl(from).l)).toBeLessThan(0.02)
    }
    expect(map['#333333']).toBeUndefined()
    expect(Object.keys(map).length).toBeGreaterThan(1)
  })
  it('maps a separate hue group to the accent colour', () => {
    const two = '<section style="background-color: #eef6ea"><p style="color: #528065">绿</p><p style="color: #e8913a">橙</p></section>'
    const map = harmonize(collectColors(two, parse), { primary: '#3f7fd1', accent: '#c8a44d' })
    expect(hueFamily(map['#528065'])).toBe('blue')
    expect(hueFamily(map['#e8913a'])).toBe('orange')
  })
  it('does nothing when the target colour is grey', () => {
    expect(harmonize(collectColors(GREEN, parse), { primary: '#666666', accent: '#999999' })).toEqual({})
  })
  it('unifies components from two templates into one palette', () => {
    const purple = createBlock('html', { html: '<section style="background-color: #f3eefa"><p style="color: #5b3a9c">紫色模板</p></section>' })
    const green = createBlock('html', { html: GREEN })
    const main = docMainColors([purple], THEMES[0], parse)
    expect(hueFamily(main.primary)).toBe('purple')
    const out = recolorHtml(green.props.html, harmonize(collectColors(green.props.html, parse), main), parse)
    const families = collectColors(out, parse).filter((c) => c.chroma).map((c) => hueFamily(c.hex))
    expect(new Set(families)).toEqual(new Set(['purple']))
  })
  it('falls back to theme colours and reports fixed decor', () => {
    expect(docMainColors([createBlock('paragraph')], THEMES[0], parse).primary).toBe(THEMES[0].colors.primary)
    expect(fixedDecorCount(GRID, parse)).toBe(2)
    expect(fixedDecorCount(carousel, parse)).toBe(0)
  })
})

describe('component records', () => {
  const block = createBlock('html', { html: card('图注'), label: '图片卡', source })
  it('builds a draft with stats, palette, fingerprint and private origin', () => {
    const d = makeDraft({ name: ' 图片卡 ', tags: ['活动', '活动', ' '], block, source, via: 'fragment', attested: true }, parse)
    expect(d).toMatchObject({ name: '图片卡', kind: guessKind(block, parse), tags: ['活动'], stats: { texts: 1, photos: 1 } })
    expect(d.origin).toMatchObject({ kind: 'xiumi', via: 'fragment', attested: true, redistributable: false })
    expect(hueFamily(d.palette[0])).toBe('green')
    expect(d.text).toContain('图注')
  })
  it('gives the same fingerprint to the same structure with different text and photos', () => {
    const other = createBlock('html', { html: card('别的图注').replace(JPG(1), JPG(5)) })
    expect(fingerprint(other, parse)).toBe(fingerprint(block, parse))
    expect(fingerprint(createBlock('html', { html: pill('x') }), parse)).not.toBe(fingerprint(block, parse))
    expect(fingerprint(createBlock('heading', { title: '甲' }), parse)).not.toBe(fingerprint(createBlock('heading', { title: '乙' }), parse))
  })
  it('classifies pieces', () => {
    expect(guessKind(createBlock('html', { html: pill('标题') }), parse)).toBe('heading')
    expect(guessKind(createBlock('html', { html: carousel }), parse)).toBe('image')
    expect(guessKind(createBlock('html', { html: '<section style="border: 1px solid #000"></section>' }), parse)).toBe('decor')
    expect(guessKind(createBlock('html', { html: '<p>文字｜张三</p><p>点击蓝字关注我们</p>' }), parse)).toBe('ending')
    expect(guessKind(createBlock('quote'), parse)).toBe('body')
  })
  it('requires attestation for imported content and forces it to stay private', () => {
    const d = makeDraft({ name: 'x', block, source, via: 'block', attested: false }, parse)
    expect(validateDraft(d).error).toContain('确认使用权')
    const ok = validateDraft({ ...makeDraft({ name: 'x', block, source, via: 'block', attested: true }, parse), origin: { ...source, attested: true, redistributable: true } })
    expect(ok.draft?.origin.redistributable).toBe(false)
    expect(validateDraft({ ...d, block: createBlock('heading'), origin: { kind: 'original' } }).draft?.origin.redistributable).toBe(true)
  })
  it('rejects bad data and neutralises stored scripts', () => {
    expect(validateDraft(null).error).toBeTruthy()
    expect(validateDraft({ block: { type: 'nope' } }).error).toBeTruthy()
    expect(validateDraft({ block: createBlock('html', { html: '   ' }), origin: { attested: true } }).error).toContain('为空')
    expect(validateDraft({ block: createBlock('html', { html: 'x'.repeat(400_001) }), origin: { attested: true } }).error).toContain('拆分')
    const d = validateDraft({ name: 'x', kind: 'bogus', palette: ['red', '#112233'], block: createBlock('html', { html: '<p onclick="a()">甲</p><script>b()</script>' }), origin: { attested: true, url: 'javascript:x' } }).draft!
    expect(d.block.type === 'html' && d.block.props.html).toBe('<p>甲</p>')
    expect(d).toMatchObject({ kind: 'body', palette: ['#112233'], origin: { url: '' } })
  })
  it('creates a fresh, clean block on each insert', () => {
    const dirty = { ...block, props: { ...block.props, html: '<p style="color: red" onclick="a()">甲</p><script>b()</script>' } }
    const a = componentBlock(dirty, parse)
    const b = componentBlock(dirty, parse)
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe(dirty.id)
    expect(a.type === 'html' && a.props.html).toBe('<p style="color: red">甲</p>')
  })
  it('keeps source through normalisation so loading a project does not rewrite it', () => {
    const b = componentBlock(block, parse)
    expect(b.type === 'html' && b.props.source).toEqual(source)
  })
  it('searches by text, tag, kind, source and hue', () => {
    const c = (name: string, kind: LibraryComponent['kind'], color: string, extra = {}) => ({ name, kind, tags: ['活动'], text: '风筝制作', palette: [color], origin: { title: '能源44', account: '', kind: 'xiumi' }, ...extra }) as any
    const list = [c('绿色相框', 'image', '#57a55a'), c('紫色标题', 'heading', '#7f5bc8', { tags: ['团日'], text: '开幕' })]
    expect(searchComponents(list, { text: '相框' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { text: '团日' }).map((x) => x.name)).toEqual(['紫色标题'])
    expect(searchComponents(list, { text: '风筝 活动' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { kind: 'heading' }).map((x) => x.name)).toEqual(['紫色标题'])
    expect(searchComponents(list, { hue: 'green' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { text: '能源44' })).toHaveLength(2)
    expect(searchComponents(list, { text: '不存在' })).toEqual([])
  })
})

describe('component storage', () => {
  let dir: string
  let store: typeof import('../../server/components')
  const draft = (html: string) => makeDraft({ name: '卡片', block: createBlock('html', { html, source }), source, via: 'block', attested: true }, parse)

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xiumi-comp-'))
    vi.stubEnv('DATA_DIR', dir)
    vi.resetModules()
    store = await import('../../server/components')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves, lists, renames and removes', async () => {
    const { component, duplicate } = await store.saveComponent(draft(card('甲')))
    expect(duplicate).toBe(false)
    expect(component).toMatchObject({ schema: 1, rev: 1 })
    const updated = await store.updateComponent(component.id, { name: '新名字', tags: ['甲', '甲'], kind: 'image', block: 'ignored' })
    expect(updated).toMatchObject({ name: '新名字', tags: ['甲'], kind: 'image', rev: 2 })
    expect(updated.block).toEqual(component.block)
    expect((await store.listComponents()).map((c) => c.id)).toEqual([component.id])
    await store.removeComponent(component.id)
    expect(await store.listComponents()).toEqual([])
    await expect(store.updateComponent(component.id, {})).rejects.toThrow('不存在')
  })
  it('does not store the same structure twice', async () => {
    const a = await store.saveComponent(draft(card('甲')))
    const b = await store.saveComponent(draft(card('乙')))
    expect(b.duplicate).toBe(true)
    expect(b.component.id).toBe(a.component.id)
    await store.removeComponent(a.component.id)
  })
  it('refuses unattested imports', async () => {
    await expect(store.saveComponent({ ...draft(card('甲')), origin: { ...source, attested: false } })).rejects.toThrow('确认使用权')
  })
  it('reports images whose asset was deleted', async () => {
    const { component } = await store.saveComponent(draft('<section style="border: 1px solid #000"><img src="/media/gone.jpg?fit=1:1"><img src="/media/kept.jpg"></section>'))
    writeFileSync(join(dir, 'assets', 'kept.jpg'), 'x')
    const [c] = await store.listComponents()
    expect(c.missing).toEqual(['gone.jpg'])
    await store.removeComponent(component.id)
  })
  it('skips corrupt files and records from a newer schema', async () => {
    writeFileSync(join(dir, 'components', 'broken.json'), '{not json')
    writeFileSync(join(dir, 'components', 'future.json'), JSON.stringify({ id: 'future', schema: 99, block: createBlock('heading'), createdAt: 1 }))
    expect(await store.listComponents()).toEqual([])
  })
})
