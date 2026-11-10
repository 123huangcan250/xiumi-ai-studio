import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { cleanText, editableText, extractFrames, extractSlots, fillSlots, isPhotoSlot, removeBackgroundPhotos, removeImage, setSlotAlign, setSlotAlignment, skeleton, slotAligns, slotRawTexts, type ImageSlot, type TextSlot } from '../../src/core/slots'

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

describe('spaces and alignment in the side-panel editor', () => {
  const html = '<section style="padding: 8px"><p style="font-size: 20px">封面标题</p><p style="font-size: 15px">正文第一段</p></section>'
  it('keeps typed spaces as non-breaking spaces so they show on the page', () => {
    const out = fillSlots(html, { t0: '  封面  标题 ' }, { parse, keepSpaces: true })
    expect(out).toContain('封面&nbsp;&nbsp;标题')
    // 回读：表单里显示的文字和输入的一致，没有被吞掉
    expect(slotRawTexts(out, parse).t0).toBe('  封面  标题 ')
    expect(editableText('  封面  标题 ')).toBe('  封面  标题 ')
    // 单个空格留作普通空格（可换行），多行时空行去掉
    const two = fillSlots(html, { t1: '甲 乙\n\n丙' }, { parse, keepSpaces: true, split: false })
    expect(slotRawTexts(two, parse).t1).toBe('甲 乙\n丙')
    expect(editableText('甲 乙\n\n丙')).toBe('甲 乙\n丙')
  })
  it('still trims and collapses spaces everywhere else', () => {
    const out = fillSlots(html, { t0: '  封面   标题 ' }, { parse })
    expect(out).toContain('>封面   标题<')
    expect(texts(out)[0].text).toBe('封面 标题')
  })
  it('reads source whitespace the way the page shows it, but counts every &nbsp;', () => {
    const raw = slotRawTexts('<p>\n   前面\n  后面&nbsp;&nbsp;末尾 </p>', parse)
    expect(raw.t0).toBe('前面 后面  末尾')
  })
  it('sets alignment on the block holding the text and reads it back', () => {
    const flex = '<section style="display: flex; justify-content: flex-start"><section style="display: inline-block"><p style="font-size: 20px"><span>标题文字</span></p></section></section>'
    expect(slotAligns(flex, parse).t0).toEqual({ alignable: true, align: null })
    const out = setSlotAlign(flex, 't0', 'center', parse)
    expect(slotAligns(out, parse).t0).toEqual({ alignable: true, align: 'center' })
    // 文字所在的 <p> 设了 text-align，外面只有它一个孩子的弹性容器同步居中，否则看不出变化
    expect(out).toMatch(/<p style="[^"]*text-align: center/)
    expect(out).toContain('justify-content: center')
    const right = setSlotAlign(out, 't0', 'right', parse)
    expect(slotAligns(right, parse).t0.align).toBe('right')
    // 旧值被替换，不会叠加
    expect(right.match(/text-align/g)!.length).toBe(right.match(/text-align: right/g)!.length)
    // 文字内容不变
    expect(texts(right).map((x) => x.text)).toEqual(['标题文字'])
  })
  it('cannot align text inside svg shapes', () => {
    const svg = '<svg viewBox="0 0 300 40"><text font-size="18">活动回顾</text></svg>'
    expect(slotAligns(svg, parse).t0.alignable).toBe(false)
    expect(setSlotAlign(svg, 't0', 'center', parse)).toBe(svg)
  })
})


describe('merged imported-slot editing behavior', () => {
  it('round-trips blank lines and breakable word spaces through form values', () => {
    const input = '  hello world  again \n\n last line \n'
    for (const html of ['<p>原文</p>', '<section>原文<p>其他段落</p></section>']) {
      const out = fillSlots(html, { t0: input }, { parse, split: false, bold: false, preserveWhitespace: true })
      expect(slotRawTexts(out, parse).t0).toBe(input)
      expect(out).toContain('hello world')
      expect(out).not.toContain('hello&nbsp;world')
    }
  })

  it('reports all four alignments and retains both helper names', () => {
    const html = '<p style="color: red; text-align: center !important">正文</p><p>其他段落</p>'
    for (const align of ['left', 'center', 'right', 'justify'] as const) {
      const out = setSlotAlignment(html, 't0', align, parse)
      expect(out).toBe(setSlotAlign(html, 't0', align, parse))
      expect(slotAligns(out, parse).t0).toEqual({ alignable: true, align })
      const p = parse(out).querySelector('p')!
      expect(p.style.color).toBe('red')
      expect(p.style.getPropertyPriority('text-align')).toBe('')
      expect(parse(out).querySelectorAll('p')[1].getAttribute('style')).toBeNull()
    }
  })

  it('aligns bare and inline text in isolation and enables their controls', () => {
    for (const html of [
      '<section>原文<p>其他段落</p></section>',
      '<section><span>原文</span><p>其他段落</p></section>',
      '<span>原文</span><p>其他段落</p>',
      '原文<p>其他段落</p>',
    ]) {
      expect(slotAligns(html, parse).t0.alignable).toBe(true)
      const out = setSlotAlign(html, 't0', 'right', parse)
      const dom = parse(out)
      const sibling = [...dom.querySelectorAll('p')].find(p => p.textContent === '其他段落')!
      expect(sibling.closest('[style*="text-align"]')).toBeNull()
      expect(slotAligns(out, parse).t0.align).toBe('right')
      expect(texts(out).map(s => s.text)).toEqual(['原文', '其他段落'])
    }
  })

  it('never propagates alignment across bare-text, image, or decoration siblings', () => {
    for (const sibling of ['旁边文字', '<img src="/media/photo.jpg">', '<svg><path d="M0 0"></path></svg>', '<span style="display:inline-block;width:10px"></span>']) {
      const html = `<section data-parent style="display: flex; justify-content: flex-start">${sibling}<section style="width:100px"><p>目标段落</p></section></section>`
      const slot = texts(html).find(s => s.text === '目标段落')!
      const out = setSlotAlign(html, slot.id, 'right', parse)
      const parent = parse(out).querySelector('[data-parent]') as HTMLElement
      expect(parent.style.justifyContent).toBe('flex-start')
      expect(parent.style.textAlign).toBe('')
      expect(slotAligns(out, parse)[slot.id].align).toBe('right')
    }
  })

  it('positions fixed-width boxes without duplicating margins on repeated alignment', () => {
    const html = '<section><section data-box style="width: 120px; margin: 4px 6px; color: red"><p>正文段落</p></section></section>'
    let out = html
    for (const align of ['center', 'right', 'left', 'justify'] as const) {
      out = setSlotAlign(out, 't0', align, parse)
      const box = parse(out).querySelector('[data-box]') as HTMLElement
      expect(box.getAttribute('style')).toContain(`margin-left: ${align === 'left' || align === 'justify' ? '0' : 'auto'}`)
      expect(box.getAttribute('style')).toContain(`margin-right: ${align === 'right' ? '0' : 'auto'}`)
      expect(box.style.marginTop).toBe('4px')
      expect(box.style.color).toBe('red')
      expect(slotAligns(out, parse).t0.align).toBe(align)
    }
  })
})
