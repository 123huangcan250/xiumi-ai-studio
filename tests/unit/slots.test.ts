import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { cleanText, extractFrames, extractSlots, fillSlots, isPhotoSlot, removeBackgroundPhotos, removeImage, skeleton, type ImageSlot, type TextSlot } from '../../src/core/slots'

const parse = (s: string) => new JSDOM(s).window.document
const texts = (html: string) => extractSlots(html, parse).filter((s): s is TextSlot => s.kind === 'text')
const images = (html: string) => extractSlots(html, parse).filter((s): s is ImageSlot => s.kind === 'image')

const SECTION = `<section style="background-color: #f5f0e6; padding: 16px">
  <section style="text-align: center"><span style="font-size: 12px; color: #999">PART 01</span></section>
  <p style="font-size: 20px"><strong><span style="color: #8a1c2b">【</span>开幕式<span style="color: #8a1c2b">】</span></strong></p>
  <p style="font-size: 15px; text-indent: 2em"><span style="color: #333">9 月 20 日上午，开幕式在大礼堂举行，</span><span style="color: #8a1c2b">320 名同学</span>参加。</p>
  <img src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" style="width: 100%">
  <p style="font-size: 12px; color: #999; text-align: center">▲ 开幕式现场</p>
  <img src="https://mmbiz.qpic.cn/icon/640?wx_fmt=png" style="width: 24px">
  <img src="https://mmbiz.qpic.cn/sticker/0?wx_fmt=gif">
</section>`

describe('slot extraction', () => {
  it('finds text slots in document order with roles', () => {
    const t = texts(SECTION)
    expect(t.map((s) => s.id)).toEqual(['t0', 't1', 't2', 't3'])
    expect(t.map((s) => s.role)).toEqual(['number', 'title', 'body', 'caption'])
    expect(t[1].text).toBe('【开幕式】')
    expect(t[2].text).toBe('9 月 20 日上午，开幕式在大礼堂举行，320 名同学参加。')
    expect(t[2].max).toBe(0)
    expect(t[1].max).toBeGreaterThanOrEqual(6)
  })
  it('marks icons, stickers and data uris as decoration', () => {
    const i = images(SECTION + '<img src="data:image/png;base64,AAAA">')
    expect(i.map((s) => s.decor)).toEqual([false, true, true, true])
    expect(isPhotoSlot(i[0], { [i[0].src]: 0.3 })).toBe(false) // 细长条视为花边
    expect(isPhotoSlot(i[0], { [i[0].src]: 0 })).toBe(false) // 原图太小
    expect(isPhotoSlot(i[0], { [i[0].src]: 0.66 })).toBe(true)
  })
  it('treats wechat png art and narrow columns as decoration but keeps photo grids', () => {
    const i = images(
      '<img src="https://mmbiz.qpic.cn/sz_mmbiz_png/x/640?wx_fmt=png" style="width: 100%">' +
        '<section style="display: inline-block; width: 20%"><img src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" style="width: 100%"></section>' +
        '<section style="display: inline-block; width: 33.33%"><img src="https://mmbiz.qpic.cn/b/640?wx_fmt=jpeg" style="width: 100%"></section>' +
        '<img src="/media/own.png" style="width: 100%">',
    )
    expect(i.map((s) => s.decor)).toEqual([true, true, false, false])
  })
  it('treats svg text as tight slots and keeps foreignObject html', () => {
    const t = texts('<svg viewBox="0 0 300 40"><text font-size="18">活动回顾</text></svg><svg viewBox="0 0 1 1"><foreignObject width="100%" height="100%"><section><p>齐鲁文化谈</p></section></foreignObject></svg>')
    expect(t.map((s) => [s.text, s.tight, s.role])).toEqual([
      ['活动回顾', true, 'title'],
      ['齐鲁文化谈', true, 'title'],
    ])
    expect(t[0].max).toBe(4)
  })
  it('recognises numbers and stray text mixed with blocks', () => {
    const t = texts('<section>序言<p>01</p><p>第二章</p></section>')
    expect(t.map((s) => [s.text, s.role])).toEqual([
      ['序言', 'body'],
      ['01', 'number'],
      ['第二章', 'number'],
    ])
  })
})

describe('slot filling', () => {
  it('keeps the style of the main text run and drops emptied spans', () => {
    const html = fillSlots(SECTION, { t1: '颁奖典礼', t2: '晚上七点，**颁奖典礼**开始。' }, { parse })
    const t = texts(html)
    expect(t[1].text).toBe('颁奖典礼')
    expect(html).toContain('<p style="font-size: 20px"><strong>颁奖典礼</strong></p>')
    expect(html).toContain('<span style="color: #333">晚上七点，<strong>颁奖典礼</strong>开始。</span>')
    expect(html).not.toContain('320 名同学')
    expect(t[0].text).toBe('PART 01') // 未提供的槽位保持原样
  })
  it('splits multi-paragraph body text into copies of the paragraph', () => {
    const html = fillSlots(SECTION, { t2: '第一段。\n第二段。\n\n第三段。' }, { parse })
    expect(html.match(/text-indent: 2em/g)).toHaveLength(3)
    expect(texts(html).filter((s) => s.role === 'body').map((s) => s.text)).toEqual(['第一段。', '第二段。', '第三段。'])
  })
  it('uses line breaks instead of copies in form mode', () => {
    const html = fillSlots(SECTION, { t2: '第一段。\n第二段 **不加粗**' }, { parse, split: false, bold: false })
    expect(html.match(/text-indent: 2em/g)).toHaveLength(1)
    expect(texts(html)[2].text).toBe(cleanText('第一段。\n第二段 **不加粗**'))
  })
  it('removes a line when the value is empty', () => {
    const html = fillSlots(SECTION, { t3: '' }, { parse })
    expect(html).not.toContain('开幕式现场')
    expect(texts(html)).toHaveLength(3)
  })
  it('replaces photos with cropped local variants and ignores unsafe sources', () => {
    const src = 'https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg'
    const html = fillSlots(SECTION, { i0: { src: '/media/abc.jpg' }, i1: { src: 'javascript:alert(1)' } }, { parse, ratios: { [src]: 0.75 } })
    expect(html).toContain('src="/media/abc.jpg?fit=100%3A75&amp;w=1080"')
    expect(html).toContain('wx_fmt=png')
    expect(html).not.toContain('javascript')
  })
  it('writes plain text into svg text elements', () => {
    const html = fillSlots('<svg viewBox="0 0 300 40"><text font-size="18"><tspan>活动</tspan><tspan>回顾</tspan></text></svg>', { t0: '**精彩**\n瞬间' }, { parse })
    expect(html).toContain('精彩 瞬间')
    expect(html).not.toMatch(/<strong|<br/)
  })
})

describe('photo frames', () => {
  const FRAMED = `<section style="padding: 10px"><section style="border: 2px solid green"><img src="https://mmbiz.qpic.cn/p/640?wx_fmt=jpeg" style="width: 100%"><img src="https://mmbiz.qpic.cn/arrow/0?wx_fmt=png" style="width: 20px"></section><p>图注</p></section>`
  it('extracts the frame around a photo with its ornaments but without captions', () => {
    expect(extractFrames(FRAMED, { parse })).toEqual(['<section style="border: 2px solid green"><img src="https://mmbiz.qpic.cn/p/640?wx_fmt=jpeg" style="width: 100%"><img src="https://mmbiz.qpic.cn/arrow/0?wx_fmt=png" style="width: 20px"></section>'])
  })
  it('removes the whole frame when an image slot is emptied', () => {
    const html = fillSlots(FRAMED, { i0: '' }, { parse })
    expect(html).not.toContain('border: 2px solid green')
    expect(html).toContain('图注')
  })
})

describe('deleting images', () => {
  // 仿秀米 SVG 轮播：照片是 foreignObject 里 svg 的 JPG 背景图，外面套着虚线框；旁边是正文和一张普通照片
  const slide = (n: number) => `<g transform="translate(${n * 1080} 0)"><foreignObject width="100%" height="100%"><svg style="background-image: url(&quot;https://mmbiz.qpic.cn/sz_mmbiz_jpg/old${n}/640?wx_fmt=jpeg&quot;); background-size: 100%" viewBox="0 0 1080 1440"></svg></foreignObject></g>`
  const CAROUSEL = `<section><p>正文段落。</p><section style="display: flex"><section style="background-color: rgb(236, 246, 228); padding: 10px"><section style="border-style: dashed"><svg viewBox="0 0 1080 1440">${slide(0)}${slide(1)}</svg></section></section></section><section style="background-image: url(https://mmbiz.qpic.cn/paper/0?wx_fmt=jpeg)"><p>纸纹底色上的文字</p></section><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/deco/0?wx_fmt=png" style="width: 100%"></section>`

  it('removes background-image photos with their whole carousel frame', () => {
    const r = removeBackgroundPhotos(CAROUSEL, parse)
    expect(r.removed).toBe(1)
    expect(r.html).not.toMatch(/old0|old1|border-style: dashed|display: flex/)
    expect(r.html).toContain('正文段落。')
    expect(r.html).toContain('纸纹底色上的文字') // 带文字的背景（纹理）保留
    expect(r.html).toContain('wx_fmt=png')
    expect(removeBackgroundPhotos('<p>无背景图</p>', parse)).toEqual({ html: '<p>无背景图</p>', removed: 0 })
  })
  it('deletes a photo with its frame, or just the image for decorations', () => {
    const FRAMED = `<section><section style="border: 2px solid green"><img src="https://mmbiz.qpic.cn/p/640?wx_fmt=jpeg" style="width: 100%"></section><p>图注</p><img src="https://mmbiz.qpic.cn/deco/0?wx_fmt=gif"></section>`
    const a = removeImage(FRAMED, 0, parse)
    expect(a).not.toContain('border: 2px solid green')
    expect(a).toContain('图注')
    const b = removeImage(FRAMED, 1, parse)
    expect(b).not.toContain('wx_fmt=gif')
    expect(b).toContain('border: 2px solid green')
    expect(removeImage(FRAMED, 9, parse)).toBe(FRAMED)
  })
})

describe('skeleton', () => {
  it('matches parts that differ only in text and images', () => {
    const a = skeleton(fillSlots(SECTION, { t1: '甲', i0: { src: '/media/x.jpg' } }, { parse }), parse)
    const b = skeleton(fillSlots(SECTION, { t1: '乙乙乙', i0: { src: '/media/y.jpg' } }, { parse }), parse)
    expect(a).toBe(b)
    expect(skeleton('<p style="color: red">x</p>', parse)).not.toBe(skeleton('<p style="color: blue">x</p>', parse))
  })
})

describe('AI edits on imported fragments', () => {
  // ops.ts 在浏览器中使用全局 DOMParser
  globalThis.DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser
  const block = { id: 'h1', type: 'html' as const, props: { html: SECTION, label: '开幕式' } }
  const doc = { id: 'd', title: 't', author: '', digest: '', themeId: 'x', blocks: [block], createdAt: 0, updatedAt: 0 }

  it('updates text slots and recomputes html from the current block', async () => {
    const { validateOp, applyOp } = await import('../../src/core/ops')
    const r = validateOp(doc, { op: 'update', id: 'h1', slots: { t1: '颁奖典礼', t9: 'x' }, props: { html: '<script>bad()</script>' } })
    expect(r.op).toMatchObject({ op: 'update', slots: { t1: '颁奖典礼' } })
    const next = applyOp(doc, r.op!)
    expect((next.blocks[0].props as any).html).toContain('<strong>颁奖典礼</strong>')
    expect((next.blocks[0].props as any).html).not.toContain('script')
    // 接受时按当前文档重新计算
    const again = validateOp(next, r.op)
    expect((again.op as any).props.html).toBe((next.blocks[0].props as any).html)
  })
  it('rejects raw html and unknown slots', async () => {
    const { validateOp } = await import('../../src/core/ops')
    expect(validateOp(doc, { op: 'update', id: 'h1', props: { html: '<p>x</p>' } }).error).toBeTruthy()
    expect(validateOp(doc, { op: 'update', id: 'h1', slots: { zz: 'x' } }).error).toBeTruthy()
    expect(validateOp(doc, { op: 'insert', index: 0, block: { type: 'html', props: { html: '<p>x</p>' } } }).error).toBeTruthy()
  })
  it('gives the model text slots instead of html', async () => {
    const { aiContext } = await import('../../src/core/quickActions')
    const ctx = aiContext(doc)
    expect(ctx.blocks[0].props).toMatchObject({ label: '开幕式', slots: [{ id: 't0', role: 'number' }, { id: 't1', role: 'title', text: '【开幕式】' }, { id: 't2' }, { id: 't3' }] })
    expect(JSON.stringify(ctx)).not.toContain('<section')
  })
})
