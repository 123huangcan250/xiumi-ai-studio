// 按标准名称套用模块：文案结构决定顺序，模板只提供模块
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { assemble, autoPlace, kitLevels, type Kit } from '../../src/core/assemble'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { checkCopy, copyLevels, findAnchor, limitLevels, normalizeCopyText, parseCopy } from '../../src/core/copy'
import { aiPlaceRequest, checkPlan, fixedPlacements, normalizeAiPlacements, type PhotoUnit } from '../../src/core/photoPlan'
import { guessRole, guessTemplateRoles, rolesForPhotos, type RoleId } from '../../src/core/roles'
import type { Block, ImageRef } from '../../src/core/types'

const parse = (s: string) => new JSDOM(s).window.document
const html = (h: string, label = '片段') => createBlock('html', { html: h, label })
const OLD = 'https://mmbiz.qpic.cn/old/640?wx_fmt=jpeg'
const photos: ImageRef[] = Array.from({ length: 8 }, (_, i) => ({ src: `/media/photo-${i + 1}.jpg`, width: 1600, height: 1067 }))

/** 仿照常见活动推文：封面、章节标题、正文、单图、双图、花边、结尾署名 */
const blocks: Block[] = [
  html(`<section style="background-color: #fdf3e7; padding: 20px"><p style="font-size: 24px; color: #a0522d"><strong>2025 秋季运动会圆满结束</strong></p><p style="font-size: 18px; color: #999"><strong>旧副标题奔跑吧少年</strong></p></section>`),
  html('<section style="text-align: center"><span style="font-size: 26px; color: #a0522d">01</span><p style="font-size: 18px"><strong>旧章节开幕式</strong></p></section>'),
  html('<p style="font-size: 15px; text-indent: 2em">旧正文第一段，去年的开幕式在体育场举行，三千名同学参加了入场式。</p>'),
  html(`<section style="padding: 8px; border: 1px solid #a0522d"><img src="${OLD}" style="width: 100%"><p style="font-size: 12px; text-align: center">▲图｜旧图注</p></section>`),
  html(`<section style="display: flex"><section style="width: 50%"><img src="${OLD}"></section><section style="width: 50%"><img src="${OLD}"></section></section><p style="font-size: 12px">组图｜旧组图说明</p>`),
  html('<p style="text-align: center; color: #a0522d">· · ·</p>'),
  html('<section style="text-align: center"><p>END</p><p style="font-size: 12px">文字｜张三 图片｜李四</p><p style="font-size: 12px">点击蓝字关注我们</p></section>'),
]
const roles = guessTemplateRoles(blocks, { parse })
const kitOf = (list: Block[], rs: RoleId[]): Kit => {
  const kit: Kit = {}
  list.forEach((b, i) => {
    if (rs[i] !== 'other' && !kit[rs[i]]) kit[rs[i]] = { role: rs[i], block: b, from: '模板' }
  })
  return kit
}
const kit = kitOf(blocks, roles)

const MD = `# 2026 秋季科技文化节圆满落幕
副标题：十天四十场活动

十天、四十余场活动，三千余人次参与。

## 开幕式

主楼广场的灯一盏盏亮起来。

五个院系的同学完成了光的接力。

## 创客市集

四十二个摊位上摆满了作品。

> 科学是每个愿意提问的人的冒险 —— 王老师

文字：学生科协宣传部
图片：摄影协会`

describe('standard module names', () => {
  it('guesses roles for a typical template', () => {
    expect(roles).toEqual(['cover', 'h1', 'body', 'img1', 'img2lr', 'divider', 'ending'])
  })
  it('reads photo layouts from widths', () => {
    const two = (a: number, b: number) => html(`<section style="display: flex"><section style="width: ${a}%"><img src="${OLD}"></section><section style="width: ${b}%"><img src="${OLD}"></section></section>`)
    expect(guessRole(two(66, 34), { parse })).toBe('img2big')
    expect(guessRole(html(`<img src="${OLD}" style="width: 100%"><img src="${OLD}" style="width: 100%">`), { parse })).toBe('img2tb')
    expect(guessRole(html(`<section style="display: flex"><img src="${OLD}"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('img3row')
    expect(guessRole(html(`<img src="${OLD}" style="width: 100%"><section style="display: flex"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('img3big')
    expect(guessRole(html(`<section style="overflow-x: auto; white-space: nowrap"><img src="${OLD}"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('carousel')
    expect(guessRole(html('<p>标题</p>', '二级标题 · 实验室见闻'), { parse })).toBe('h2')
    expect(guessRole(createBlock('photos', { count: 4 }))).toBe('img4')
    expect(rolesForPhotos(3)).toEqual(['img3big', 'img3row', 'carousel'])
  })
})

describe('copy with heading levels', () => {
  it('parses title, subtitle, levels, quotes and credits', () => {
    const c = parseCopy(MD.replace('## 创客市集', '### 市集现场'))
    expect(c.title).toBe('2026 秋季科技文化节圆满落幕')
    expect(c.subtitle).toBe('十天四十场活动')
    expect(c.items.filter((i) => i.kind === 'heading').map((i) => [i.text, (i as { level: number }).level])).toEqual([['开幕式', 1], ['市集现场', 2]])
    expect(c.items.find((i) => i.kind === 'quote')).toMatchObject({ text: '科学是每个愿意提问的人的冒险', source: '王老师' })
    expect(c.credits).toEqual(['文字：学生科协宣传部', '图片：摄影协会'])
  })
  it('accepts labeled headings and falls back to short lines', () => {
    expect(copyLevels(parseCopy('标题\n【一级标题】开场\n正文。\n【二级标题】细节\n正文。'))).toBe(2)
    const plain = parseCopy('活动回顾\n导语一段话，交代背景。\n开幕式\n正文内容。')
    expect(plain.items.find((i) => i.kind === 'heading')).toMatchObject({ level: 1, text: '开幕式' })
  })
  it('limits levels by turning deeper headings into bold lines', () => {
    const c = limitLevels(parseCopy('# T\n## 一\n正文\n### 二\n正文'), 1)
    expect(copyLevels(c)).toBe(1)
    expect(c.items.some((i) => i.kind === 'para' && i.text === '**二**')).toBe(true)
  })
  it('finds the paragraph holding a pasted sentence', () => {
    const c = parseCopy(MD)
    expect(findAnchor(c, ' 主楼广场的灯一盏盏亮起来 ')).toBe(c.items.find((i) => i.text.startsWith('主楼'))!.id)
    expect(findAnchor(c, '不存在的句子')).toBe('')
  })
  it('flags robotic phrases, skipped levels and missing headings', () => {
    const r = checkCopy('# T\n## 一\n首先，本次活动旨在助力成长。\n#### 三\n正文', 3)
    expect(r.robot).toEqual(expect.arrayContaining(['首先', '旨在', '助力']))
    expect(r.problems.some((p) => p.includes('跳级'))).toBe(true)
    expect(checkCopy('# T\n只有正文', 2).problems.some((p) => p.includes('没有标出章节标题'))).toBe(true)
    expect(normalizeCopyText({ markdown: '```markdown\n标题\n## 一\n```' })).toBe('# 标题\n## 一')
  })
})

describe('assemble by roles', () => {
  const copy = parseCopy(MD)
  const placements = autoPlace(copy, [[0], [1, 2], [3]])
  const { doc, warnings } = assemble(copy, kit, photos.slice(0, 4), placements, { parse, captions: ['开幕式全景', '', '', ''] })
  const out = compileDoc(doc).html

  it('follows the copy order and uses template modules only', () => {
    expect(doc.blocks.every((b) => b.type === 'html')).toBe(true)
    const pos = (s: string) => out.indexOf(s)
    expect(pos('2026 秋季科技文化节')).toBeLessThan(pos('十天、四十余场'))
    expect(pos('十天、四十余场')).toBeLessThan(pos('>开幕式<'))
    expect(pos('>开幕式<')).toBeLessThan(pos('创客市集'))
    expect(out).toContain('>02<')
    expect(out).toContain('background-color: #fdf3e7')
    // 章节之间用模板的分割装饰
    expect(out.split('· · ·').length - 1).toBe(1)
  })
  it('leaves nothing from the old article and uses every photo once', () => {
    for (const old of ['2025 秋季运动会', '旧副标题', '旧章节', '旧正文', '旧图注', '旧组图', '张三', '李四']) expect(out).not.toContain(old)
    expect(out).not.toContain(OLD)
    for (const p of photos.slice(0, 4)) expect(out.split(p.src).length - 1).toBe(1)
    expect(warnings).toEqual([])
  })
  it('writes captions with the template prefix and credits by label', () => {
    expect(out).toContain('▲图｜开幕式全景')
    expect(out).toContain('文字｜学生科协宣传部 图片｜摄影协会')
    expect(out).toContain('点击蓝字关注我们')
    // 两张照片用双图版式
    expect(doc.blocks.filter((b) => b.type === 'html' && b.props.html.includes('display: flex'))).toHaveLength(1)
  })
  it('renumbers decorative section labels including the chapter total', () => {
    const head = html('<section><p style="font-size: 11px">SECTION 01 / 04</p><p style="font-size: 20px"><strong>旧章节标题</strong></p></section>')
    const r = assemble(parseCopy('# T\n## 一\n正文。\n## 二\n正文。'), kitOf([head], ['h1']), [], [], { parse })
    const out = compileDoc(r.doc).html
    expect(out).toContain('SECTION 02 / 02')
    expect(out).not.toContain('旧章节')
  })
  it('turns missing heading levels into bold body text with a warning', () => {
    const r = assemble(parseCopy('# T\n## 一\n正文一。\n### 细节\n正文二。'), kit, [], [], { parse })
    expect(r.warnings.some((w) => w.includes('二级标题'))).toBe(true)
    expect(compileDoc(r.doc).html).toContain('<strong>细节</strong>')
    expect(kitLevels(kit)).toBe(1)
  })
  it('nests each chapter into the container when there is no plain body module', () => {
    const box = html('<section style="background-color: #eef6ea; padding: 12px"><p style="font-size: 15px; color: #333">旧正文甲，很长的一段旧内容，用来测试容器里的正文样式能否沿用。</p></section>')
    const k = kitOf([blocks[1], box, blocks[3]], ['h1', 'container', 'img1'])
    const r = assemble(copy, k, photos.slice(0, 1), [{ after: copy.items[2].id, photos: [0] }], { parse })
    const containers = r.doc.blocks.filter((b) => b.type === 'html' && b.props.html.includes('#eef6ea'))
    expect(containers).toHaveLength(3) // 导语 + 两个一级章节
    const first = (containers[1] as Block<'html'>).props.html
    expect(first).toContain('主楼广场的灯')
    expect(first).toContain(photos[0].src) // 照片也装进容器
    expect(first).toContain('font-size: 15px; color: #333')
    expect(compileDoc(r.doc).html).not.toContain('旧正文')
  })
  it('removes the emptied photo area of a container together with its labels', () => {
    const box = html(`<section style="background-color: #eef6ea; padding: 12px"><p style="font-size: 15px">旧正文甲，很长的一段旧内容，用来测试容器里的正文样式能否沿用。</p><section class="area"><section><span>IMG 01</span><img src="${OLD}" style="width: 100%"></section><p style="font-size: 12px">组图｜旧组图</p></section></section>`)
    const r = assemble(copy, kitOf([blocks[1], box], ['h1', 'container']), [], [], { parse })
    const out = compileDoc(r.doc).html
    expect(out).toContain('主楼广场的灯')
    expect(out).not.toMatch(/IMG 01|旧组图|旧正文/)
    expect(r.doc.blocks.filter((b) => b.type === 'html' && b.props.html.includes('#eef6ea'))).toHaveLength(3)
  })
})

describe('photo plan', () => {
  const copy = parseCopy(MD)
  const anchor = '主楼广场的灯一盏盏亮起来'
  const singles = (ids: number[], a = anchor): PhotoUnit[] => ids.map((i) => ({ key: `a${i}`, photos: [i], grouped: false, anchor: a }))

  it('asks when several single photos follow the same sentence', () => {
    const c = checkPlan(copy, kit, singles([0, 1]), { parse })
    expect(c.crowded).toHaveLength(1)
    expect(c.crowded[0]).toMatchObject({ photos: [0, 1], layouts: ['img2lr'], section: '开幕式' })
    expect(checkPlan(copy, kit, singles([0], '没有这句'), { parse }).unmatched).toHaveLength(1)
    expect(checkPlan(parseCopy('# T\n## 一\n### 二\n正文'), kit, []).levels).toEqual({ copy: 2, kit: 1 })
    const group: PhotoUnit = { key: 'g', photos: [0, 1, 2], grouped: true, layout: '' }
    expect(checkPlan(copy, kit, [group], { parse }).noLayout).toHaveLength(1)
  })
  it('applies the decision for crowded sentences', () => {
    const input = { copy, kit, units: singles([0, 1]), singlesFor: new Set<string>(), opts: { parse } }
    const after = findAnchor(copy, anchor)
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'group', layout: 'img2lr' } } }).fixed).toEqual([{ after, photos: [0, 1], layout: 'img2lr' }])
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'singles' } } }).fixed[0].layout).toBe('singles')
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'ai', request: '并排' } } }).askAi).toEqual([{ after, photos: [0, 1], request: '并排' }])
  })
  it('validates AI placements: groups stay whole, unknown layouts dropped, missing photos filled in', () => {
    const units: PhotoUnit[] = [{ key: 'g', photos: [0, 1], grouped: true, layout: '' }, { key: 'x', photos: [2], grouped: false }, { key: 'y', photos: [3], grouped: false }]
    const input = { copy, kit, units, crowd: {}, singlesFor: new Set<string>(), opts: { parse } }
    const { fixed, free, askAi } = fixedPlacements(input)
    const req = aiPlaceRequest(input, free, askAi, ['', '', '市集', ''])
    expect(req.units.map((u) => u.id)).toEqual(['U1', 'U2', 'U3'])
    const p3 = copy.items.find((i) => i.text.startsWith('四十二'))!.id
    const raw = { placements: [{ photos: [1], after: 'P2' }, { photos: [3], after: p3, layout: '三图一大二小' }, { photos: [3], after: 'P2' }] }
    const out = normalizeAiPlacements(raw, input, req, free, askAi, fixed)
    // 拆开的组被拒绝后按规则放回；照片 3 放在 AI 指定的位置；漏掉的照片 4 补上
    expect(out.find((p) => p.photos.includes(2))).toEqual({ after: p3, photos: [2], layout: undefined })
    expect(out.find((p) => p.photos.includes(0))!.photos).toEqual([0, 1])
    expect(out.flatMap((p) => p.photos).sort()).toEqual([0, 1, 2, 3])
  })
})
