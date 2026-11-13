// 编辑回放：排期、光标分配、flow 布局、schema、linter、SMIL 输出与解耦
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { CONTENT_W, layoutScene, PAD_BOTTOM, PAD_X } from '../../src/core/replay/layout'
import { paceTable, presetDuration } from '../../src/core/replay/pace'
import { renderScene } from '../../src/core/replay/render'
import { smil } from '../../src/core/replay/smil'
import { wrapText } from '../../src/core/replay/text'
import {
  defaultReplay,
  lintReplaySvg,
  makeItem,
  makeScene,
  normalizeReplay,
  planCursors,
  renderReplay,
  replayFinalTimes,
  sampleReplay,
  scheduleScene,
  validateReplay,
  type ReplayDoc,
} from '../../src/core/replay'
import { THEMES } from '../../src/core/themes'
import type { Doc } from '../../src/core/types'

const parse = (svg: string) => new JSDOM(`<body>${svg}</body>`).window.document
const scene0 = (doc: ReplayDoc, i = 0) => renderScene(doc.scenes[i], doc, { idsAllowed: doc.playback.trigger === 'tap', sid: 'rp0', warn: () => {} })

describe('时间轴排期', () => {
  const doc = sampleReplay()
  const tl = scheduleScene(doc.scenes[0], doc)
  const t = paceTable('fast')

  it('相邻元素重叠：下一个在上一个完成约 60% 时开始', () => {
    expect(tl.items[0].tStart).toBe(t.intro)
    for (let i = 1; i < tl.items.length; i++) {
      const prev = tl.items[i - 1]
      expect(tl.items[i].tStart).toBeCloseTo(prev.tStart + (prev.tEnd - prev.tStart) * 0.6, 2)
      expect(tl.items[i].tStart).toBeLessThan(prev.tEnd)
    }
  })
  it('一屏 6–10 个元素在 6 秒内完成（fast），单个元素进场 0.4–0.8 秒', () => {
    for (const s of doc.scenes) expect(scheduleScene(s, doc).end).toBeLessThanOrEqual(6)
    for (const it of tl.items.filter((x) => x.preset !== 'type-on')) {
      expect(it.tEnd - it.tStart).toBeGreaterThanOrEqual(0.4 - 1e-9)
      expect(it.tEnd - it.tStart).toBeLessThanOrEqual(0.8)
    }
  })
  it('标题打字按字数计时（每字 18–30ms）', () => {
    const title = tl.items.find((x) => x.item.type === 'title')!
    const chars = [...title.item.content].length
    expect(title.preset).toBe('type-on')
    expect((title.tEnd - title.tStart - 0.12) / chars).toBeGreaterThanOrEqual(0.018)
    expect((title.tEnd - title.tStart - 0.12) / chars).toBeLessThanOrEqual(0.03)
  })
  it('delay 在自动排期上偏移并顺延后面的元素', () => {
    const d = structuredClone(doc)
    d.scenes[0].items[2].delay = 0.5
    const tl2 = scheduleScene(d.scenes[0], d)
    expect(tl2.items[2].tStart).toBeCloseTo(tl.items[2].tStart + 0.5, 3)
    expect(tl2.items[3].tStart).toBeCloseTo(tl.items[3].tStart + 0.5, 3)
    expect(tl2.items[1].tStart).toBe(tl.items[1].tStart)
  })
  it('节奏档位：turbo 压缩约 35%，normal 放慢约 40%', () => {
    expect(presetDuration('pop', 'turbo') / presetDuration('pop', 'fast')).toBeCloseTo(0.65, 2)
    expect(presetDuration('pop', 'normal') / presetDuration('pop', 'fast')).toBeCloseTo(1.4, 2)
    const fast = scheduleScene(doc.scenes[0], doc).end
    const turbo = scheduleScene(doc.scenes[0], { ...doc, playback: { ...doc.playback, pace: 'turbo' } }).end
    expect(turbo).toBeLessThan(fast * 0.75)
  })
  it('预设对类型不适用时回退（按钮选打字 → 弹出）', () => {
    const d = defaultReplay()
    d.scenes = [makeScene([makeItem('button', { enter: 'type-on' }), makeItem('tag', { enter: 'count-up' })])]
    expect(scheduleScene(d.scenes[0], d).items.map((x) => x.preset)).toEqual(['pop', 'pop'])
  })
})

describe('光标分配', () => {
  const doc = sampleReplay()
  const checkPlan = (d: ReplayDoc, si: number) => {
    const tl = scheduleScene(d.scenes[si], d)
    const plan = planCursors(tl, d, d.scenes[si])
    const lead = paceTable(d.playback.pace).lead
    const seen = new Set<number>()
    for (const tr of plan.tracks) {
      let free = -Infinity
      for (const s of tr.stops) {
        // 同一光标的任务不重叠：上一个任务完成后才出发，且到达早于元素开始
        expect(s.depart).toBeGreaterThanOrEqual(free - 1e-6)
        expect(s.arrive).toBeGreaterThanOrEqual(s.depart)
        const ti = tl.items.find((x) => x.index === s.item)!
        expect(s.arrive).toBeCloseTo(ti.tStart - lead, 3)
        expect(s.act).toBe(ti.tStart)
        expect(seen.has(s.item)).toBe(false)
        seen.add(s.item)
        free = s.free
      }
    }
    return { tl, plan, seen }
  }
  it('示例模板：每个元素都分到光标，且没有冲突', () => {
    for (const si of [0, 1]) {
      const { tl, plan, seen } = checkPlan(doc, si)
      expect(plan.unassigned).toEqual([])
      expect(seen.size).toBe(tl.items.length)
    }
  })
  it('轮流分配：三个光标都参与', () => {
    const { plan } = checkPlan(doc, 0)
    expect(plan.tracks.filter((t) => t.stops.length > 0)).toHaveLength(3)
  })
  it('光标不够时元素照常排期，只是没有光标演示', () => {
    const d = structuredClone(doc)
    d.cursors.count = 1
    d.playback.pace = 'turbo'
    const { tl, plan } = checkPlan(d, 0)
    expect(plan.unassigned.length).toBeGreaterThan(0)
    expect(tl).toEqual(scheduleScene(doc.scenes[0], { ...doc, playback: { ...doc.playback, pace: 'turbo' } }))
  })
  it('收尾 swarm：所有出场的光标聚到焦点，绕圈（旋转 + 反向旋转保持朝向）后散开', () => {
    const out = scene0(doc, 1)
    expect(out.plan.swarm).not.toBeNull()
    expect(out.plan.swarm!.members).toHaveLength(3)
    expect(out.plan.swarm!.t).toBeGreaterThanOrEqual(out.end)
    expect(out.svg).toContain('type="rotate" begin="0s" dur=')
    expect(out.svg).toMatch(/values="0;0;360"/)
    expect(out.svg).toMatch(/values="0;0;-360"/)
    expect(scene0(doc, 0).plan.swarm).toBeNull()
  })
  it('指定光标在空闲时生效；action=none 不派光标', () => {
    const d = structuredClone(doc)
    d.scenes[0].items[0].cursor = { who: 2 }
    d.scenes[0].items[1].cursor = { action: 'none' }
    const { plan } = checkPlan(d, 0)
    expect(plan.tracks[2].stops[0].item).toBe(0)
    expect(plan.tracks.flatMap((t) => t.stops).some((s) => s.item === 1)).toBe(false)
  })
})

describe('与光标解耦', () => {
  it('元素层与光标无关：关掉光标层、改光标数量，元素输出完全一致', () => {
    const doc = sampleReplay()
    for (const si of [0, 1]) {
      const on = scene0(doc, si)
      const off = renderScene(doc.scenes[si], doc, { idsAllowed: false, sid: 'rp0', warn: () => {}, showCursors: false })
      const more = renderScene(doc.scenes[si], { ...doc, cursors: { ...doc.cursors, count: 6 } }, { idsAllowed: false, sid: 'rp0', warn: () => {} })
      expect(off.itemLayer).toBe(on.itemLayer)
      expect(more.itemLayer).toBe(on.itemLayer)
      expect(off.svg.length).toBeLessThan(on.svg.length)
      // 光标层在最上面（元素层之后的最后一层）
      expect(on.svg).toContain(`<g>${on.itemLayer}</g><g>`)
      expect(on.svg.endsWith('</g></svg>')).toBe(true)
      expect(off.svg.endsWith(`<g>${off.itemLayer}</g></svg>`)).toBe(true)
    }
  })
})

describe('flow 布局', () => {
  const doc = sampleReplay()
  const lay = layoutScene(doc.scenes[0], doc)
  it('元素在内容区内，自上而下不重叠', () => {
    const rows = new Map<number, typeof lay.items>()
    for (const l of lay.items) {
      expect(l.box.x).toBeGreaterThanOrEqual(PAD_X - 0.01)
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(PAD_X + CONTENT_W + 0.01)
      const key = Math.round(l.box.y)
      rows.set(key, [...(rows.get(key) ?? []), l])
    }
    const sorted = [...lay.items].sort((a, b) => a.box.y - b.box.y)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const sameRow = Math.abs(a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2)) < 2
      if (!sameRow) expect(b.box.y).toBeGreaterThanOrEqual(a.box.y + a.box.h)
    }
    expect(lay.height).toBeGreaterThanOrEqual(Math.max(...lay.items.map((l) => l.box.y + l.box.h)) + PAD_BOTTOM - 1)
  })
  it('数据卡等宽同行，按钮同行', () => {
    const stats = lay.items.filter((l) => l.item.type === 'stat')
    expect(new Set(stats.map((s) => s.box.y)).size).toBe(1)
    expect(new Set(stats.map((s) => Math.round(s.box.w))).size).toBe(1)
    const buttons = lay.items.filter((l) => l.item.type === 'button')
    expect(Math.abs(buttons[0].box.y - buttons[1].box.y)).toBeLessThan(1)
    expect(buttons[1].box.x).toBeGreaterThan(buttons[0].box.x + buttons[0].box.w)
    expect(buttons[1].outline).toBe(true)
  })
  it('长文自动断行并撑高场景', () => {
    const d = structuredClone(doc)
    d.scenes[0].items[2].content = '很长的正文'.repeat(60)
    const long = layoutScene(d.scenes[0], d)
    expect(long.items[2].text!.lines.length).toBeGreaterThan(5)
    expect(long.height).toBeGreaterThan(lay.height)
  })
  it('absolute 布局按 frame 放置，超出手动高度时标记', () => {
    const d = defaultReplay()
    d.scenes = [{ ...makeScene([makeItem('title', { frame: { x: 100, y: 900, w: 400 } })]), layout: 'absolute', height: 600 }]
    const l = layoutScene(d.scenes[0], d)
    expect(l.items[0].box.x).toBe(100)
    expect(l.items[0].box.y).toBe(900)
    expect(l.overflow).toBe(true)
  })
})

describe('断行', () => {
  const f = { size: 28, weight: 400 as const, letterSpacing: 0 }
  it('按宽度断行，标点不在行首，英文单词不拆开', () => {
    const lines = wrapText('一二三四五六七八九十，十一 hello world', f, 28 * 10)
    expect(lines[0]).toBe('一二三四五六七八九十，')
    expect(lines.every((l) => !/^[，。]/.test(l))).toBe(true)
    expect(lines.join('|')).toContain('hello')
    expect(wrapText('第一段\n第二段', f, 1000)).toEqual(['第一段', '第二段'])
  })
})

describe('schema', () => {
  it('任意输入都修复为合法文档', () => {
    const d = normalizeReplay({ playback: { pace: 'warp', trigger: 'x' }, cursors: { count: 99 }, textMode: 'gif', scenes: [{ items: [{ type: 'title', content: 1, enter: 'boom', delay: '0.3' }, { type: 'video' }, null] }] })
    expect(d.playback).toEqual({ trigger: 'auto', pace: 'fast' })
    expect(d.cursors.count).toBe(6)
    expect(d.textMode).toBe('image')
    expect(d.scenes[0].items).toHaveLength(1)
    expect(d.scenes[0].items[0]).toMatchObject({ type: 'title', content: '1', delay: 0.3 })
    expect(d.scenes[0].items[0].enter).toBeUndefined()
    expect(normalizeReplay(null).scenes.length).toBe(1)
    // 合法文档原样保留
    const sample = sampleReplay()
    expect(normalizeReplay(sample)).toEqual(sample)
  })
  it('validateReplay 列出会被修复的问题', () => {
    const issues = validateReplay({ scenes: [{ items: [{ type: 'video' }, { type: 'tag', enter: 'boom' }] }] })
    expect(issues.some((x) => x.includes('类型无效'))).toBe(true)
    expect(issues.some((x) => x.includes('预设无效'))).toBe(true)
    expect(validateReplay(sampleReplay())).toEqual([])
  })
  it('作为文档模块加载时经过 schema 校验', () => {
    const [b] = normalizeBlocks([{ id: 'r1', type: 'replay', props: { scenes: [{ items: [{ type: 'stat', content: 42 }] }] } }])
    expect(b.type).toBe('replay')
    expect((b.props as ReplayDoc).scenes[0].items[0].content).toBe('42')
  })
})

describe('SMIL 输出', () => {
  it('单次播放：从 0 开始，keyTimes 0→1 单调，fill=freeze', () => {
    const s = smil({ attr: 'opacity', keys: [{ t: 1, v: 0 }, { t: 1.5, v: 1, ease: 'out' }] }, { kind: 'once' })
    expect(s).toContain('begin="0s"')
    expect(s).toContain('dur="1.5s"')
    expect(s).toContain('values="0;0;1"')
    expect(s).toContain('keyTimes="0;0.66667;1"')
    expect(s).toContain('keySplines="0 0 1 1;0.2 0.9 0.1 1"')
    expect(s).toContain('fill="freeze"')
  })
  it('循环：统一 dur 与 repeatCount=indefinite；点击：begin=id.click', () => {
    const loop = smil({ attr: 'x', keys: [{ t: 1, v: 0 }, { t: 2, v: 10 }] }, { kind: 'loop', cycle: 5 })
    expect(loop).toContain('dur="5s"')
    expect(loop).toContain('repeatCount="indefinite"')
    expect(loop).not.toContain('fill=')
    expect(smil({ attr: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, { kind: 'tap', trigger: 'rp0' })).toContain('begin="rp0.click"')
  })
  it('变换动画不会覆盖所在元素的静态 transform（除非静态值就是动画终值）', () => {
    const doc = sampleReplay()
    doc.textMode = 'svg-text'
    for (const si of [0, 1]) {
      const d = parse(scene0(doc, si).svg)
      for (const a of d.querySelectorAll('animateTransform')) {
        const fixed = a.parentElement!.getAttribute('transform')
        if (!fixed) continue
        const last = a.getAttribute('values')!.split(';').pop()
        expect(fixed, `场景 ${si + 1}`).toBe(`${a.getAttribute('type')}(${last})`)
      }
    }
  })
  it('循环模式下一个场景的所有动画共用同一个周期', () => {
    const d = sampleReplay()
    d.playback.loop = { hold: 2 }
    const out = scene0(d)
    const durs = new Set([...out.svg.matchAll(/<(?:animate|animateTransform)\b[^>]*dur="([^"]+)"/g)].map((m) => m[1]))
    expect([...durs]).toEqual([`${out.cycle}s`])
  })
})

describe('wechat-svg-lint', () => {
  it('示例模板三种播放方式都零错误，只使用允许的标签', () => {
    const allowed = new Set(['svg', 'g', 'rect', 'path', 'circle', 'text', 'tspan', 'image', 'animate', 'animatetransform', 'set', 'defs', 'lineargradient', 'stop'])
    for (const patch of [{}, { loop: { hold: 2 } }, { trigger: 'tap' as const }]) {
      const d = sampleReplay()
      d.playback = { ...d.playback, ...patch }
      const r = renderReplay(d)
      expect(r.errors).toEqual([])
      const tags = new Set([...r.html.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1].toLowerCase()))
      tags.delete('section')
      for (const t of tags) expect(allowed.has(t)).toBe(true)
      if (!patch.trigger) {
        expect(r.html).not.toMatch(/\sid=|url\(#|\.click/)
      }
    }
  })
  it('拦截禁用写法', () => {
    const bad = '<svg><style>.a{}</style><script>x()</script><foreignObject/><animateMotion/><filter/><mask/><g class="a" onclick="x()"><rect style="animation: a 1s"/></g></svg>'
    const r = lintReplaySvg(bad, { idsAllowed: false })
    for (const k of ['<style>', '<script>', '<foreignObject>', '<animateMotion>', '<filter>', '<mask>', 'class', 'on*', 'CSS 动画']) expect(r.errors.join('|')).toContain(k)
  })
  it('id 与 url(#) 在自动播放方案下报错，点击方案下警告', () => {
    const svg = '<svg><rect id="a" fill="url(#g)"/><animate begin="a.click"/></svg>'
    expect(lintReplaySvg(svg, { idsAllowed: false }).errors).toHaveLength(3)
    const tap = lintReplaySvg(svg, { idsAllowed: true })
    expect(tap.errors).toEqual([])
    expect(tap.warnings[0]).toContain('待真机验证')
  })
  it('图片地址：本机与外链报错，内嵌警告，微信图片通过', () => {
    const r = lintReplaySvg('<svg><image href="/media/a.jpg"/><image href="https://example.com/a.png"/><image href="data:image/png;base64,AA"/><image href="https://mmbiz.qpic.cn/a/0"/></svg>', { idsAllowed: false })
    expect(r.errors).toHaveLength(2)
    expect(r.warnings).toHaveLength(1)
  })
  it('超出体积预算时警告', () => {
    const d = sampleReplay()
    d.budget = { sceneKB: 5, totalKB: 10 }
    const r = renderReplay(d)
    expect(r.warnings.some((w) => w.includes('单场景预算'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('整体'))).toBe(true)
  })
  it('接入编译器：本机图片导出时报错，映射成微信地址后通过', () => {
    const d = sampleReplay()
    d.scenes[1].items[2].image = { src: '/media/abc.jpg', width: 1200, height: 800 }
    const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: normalizeBlocks([{ id: 'r', type: 'replay', props: d }]), createdAt: 0, updatedAt: 0 }
    expect(compileDoc(doc).warnings.some((w) => w.startsWith('编辑回放 ✕'))).toBe(true)
    const ok = compileDoc(doc, { mapImage: (u) => (u.startsWith('/media/') ? 'https://mmbiz.qpic.cn/mmbiz_jpg/x/0' : u) })
    expect(ok.warnings.some((w) => w.startsWith('编辑回放 ✕'))).toBe(false)
    expect(ok.html).toContain('href="https://mmbiz.qpic.cn/mmbiz_jpg/x/0"')
  })
})

describe('动画被过滤时退化为静态成稿', () => {
  /** 去掉全部动画后，没有被 opacity=0 隐藏的文字 */
  const visibleTexts = (svg: string) => {
    const d = parse(svg)
    d.querySelectorAll('animate, animateTransform, set').forEach((n) => n.remove())
    return [...d.querySelectorAll('text')].filter((t) => !t.closest('[opacity="0"]')).map((t) => t.textContent)
  }
  it('所有文案仍然可见，辅助图形（线框、尺寸标签、光标、过程数字）都隐藏', () => {
    const doc = sampleReplay()
    doc.textMode = 'svg-text'
    const out = scene0(doc)
    const texts = visibleTexts(out.svg).join('|')
    for (const it of doc.scenes[0].items) for (const line of [it.content, it.label ?? '']) for (const ch of line.replace(/\s/g, '').slice(0, 4)) expect(texts).toContain(ch)
    expect(texts).not.toMatch(/\d+ × \d+/)
    expect(texts).not.toContain('Ada')
    // 数字跳动只剩最终值
    expect(visibleTexts(out.svg).filter((t) => t === '12' || t === '48' || t === '3.6s')).toHaveLength(3)
  })
})

describe('画布定格时间', () => {
  it('等光标离场或 swarm 散开之后再定格，画面里不留光标', () => {
    const doc = sampleReplay()
    const finals = replayFinalTimes(doc)
    doc.scenes.forEach((_, i) => {
      const out = scene0(doc, i)
      expect(finals[i]).toBeGreaterThanOrEqual(out.plan.end)
      expect(finals[i]).toBeGreaterThanOrEqual(out.end)
    })
  })
})

describe('逐字打字的正文与关键词', () => {
  const body = () => {
    const d = defaultReplay()
    d.cursors.show = false
    d.textMode = 'svg-text'
    d.canvas.background = { type: 'color', value: '#ffffff' }
    d.scenes = [
      {
        ...makeScene([
          makeItem('text', { content: '第一段，讲**手感**为什么会消失，以及它和归属感的关系。', enter: 'type-on' }),
          makeItem('text', { content: '第二段，讲**难度**被一句话抹平之后，成就感去了哪里。', enter: 'type-on' }),
        ]),
        overlap: 1,
        padding: 24,
      },
    ]
    return d
  }
  it('正文按字数逐字计时（不封顶），依次出现：后一段在前一段打完后开始', () => {
    const d = body()
    const tl = scheduleScene(d.scenes[0], d)
    const [a, b] = tl.items
    const chars = [...'第一段，讲手感为什么会消失，以及它和归属感的关系。'].length
    expect(a.tEnd - a.tStart).toBeCloseTo(chars * paceTable('fast').bodyPerChar + 0.12, 2)
    expect(b.tStart).toBeCloseTo(a.tEnd, 3)
    d.scenes[0].items[0].content = '很长'.repeat(200)
    const long = scheduleScene(d.scenes[0], d).items[0]
    expect(long.tEnd - long.tStart).toBeGreaterThan(10)
  })
  it('开始时间让整段时间轴整体后移（多个回放接力）', () => {
    const d = body()
    const base = scheduleScene(d.scenes[0], d)
    d.playback.start = 12
    const later = scheduleScene(d.scenes[0], d)
    later.items.forEach((x, i) => expect(x.tStart).toBeCloseTo(base.items[i].tStart + 12, 3))
    const s = sampleReplay()
    s.playback.start = 5
    const plan = planCursors(scheduleScene(s.scenes[0], s), s, s.scenes[0])
    for (const tr of plan.tracks) if (tr.spawn) expect(tr.spawn.t).toBeGreaterThanOrEqual(5 - 0.5)
  })
  it('留白收紧时场景按内容定高', () => {
    const d = body()
    const l = layoutScene(d.scenes[0], d)
    expect(l.items[0].box.y).toBe(24)
    expect(l.height).toBe(Math.ceil(l.items[1].box.y + l.items[1].box.h + 24))
  })
  it('**关键词** 去掉标记，加粗变色，打字经过时划出荧光笔底纹并保留', () => {
    const d = body()
    const out = scene0(d)
    expect(out.svg).not.toContain('**')
    expect(out.svg).toContain(`<tspan font-weight="bold" fill="${d.theme.accent}">手感</tspan>`)
    const doc = parse(out.svg)
    const markers = [...doc.querySelectorAll('rect[fill-opacity="0.22"]')]
    expect(markers).toHaveLength(2)
    // 终态保留底纹，动画从 0 宽开始
    for (const m of markers) {
      expect(Number(m.getAttribute('width'))).toBeGreaterThan(20)
      expect(m.querySelector('animate')!.getAttribute('values')!.startsWith('0;0;')).toBe(true)
    }
    expect(renderReplay(d).errors).toEqual([])
  })
  it('不成对的 ** 原样保留', async () => {
    const { parseMarks } = await import('../../src/core/replay/layout')
    expect(parseMarks('a **b** c')).toEqual({ plain: 'a b c', marks: [[2, 3]] })
    expect(parseMarks('a ** b')).toEqual({ plain: 'a ** b', marks: [] })
  })
})

describe('导出给秀米', () => {
  it('编辑回放的文字改用 SVG 文字，不含内嵌图片（秀米会把内嵌图片丢掉，文字变空白）', async () => {
    const { setReplayEnv } = await import('../../src/core/replay')
    setReplayEnv({ rasterize: () => 'data:image/png;base64,AAAA' })
    try {
      const d = sampleReplay()
      const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: normalizeBlocks([{ id: 'r', type: 'replay', props: d }]), createdAt: 0, updatedAt: 0 }
      expect(compileDoc(doc).html).toContain('data:image/png')
      const xiumi = compileDoc(doc, { replaySvgText: true }).html
      expect(xiumi).not.toContain('data:image')
      expect(xiumi).toContain('>一篇推文，是这样被写')
    } finally {
      setReplayEnv({ rasterize: null })
    }
  })
})

describe('渐变背景上打字', () => {
  it('遮挡块按背景色带切段，每段颜色都和所在色带一致（不露暗边）', () => {
    const d = sampleReplay()
    d.textMode = 'svg-text'
    const svg = scene0(d).svg
    const doc = parse(svg)
    const bandColors = new Set([...doc.querySelectorAll('svg > rect')].map((r) => r.getAttribute('fill')))
    // 打字遮挡：有 x、width 两个动画的矩形
    const covers = [...doc.querySelectorAll('rect')].filter((r) => r.querySelector('animate[attributeName="x"]') && r.querySelector('animate[attributeName="width"]'))
    expect(covers.length).toBeGreaterThan(2)
    for (const c of covers) expect(bandColors.has(c.getAttribute('fill'))).toBe(true)
  })
})

describe('开始阅读统一触发、重播与特殊字体', () => {
  it('外部触发：动画挂在开始按钮上，不画自己的点击层，↻ 用负偏移从本模块开始时间重播', () => {
    const d = sampleReplay()
    d.textMode = 'svg-text'
    d.playback = { ...d.playback, trigger: 'tap', triggerId: 'tlgo', replay: true, start: 12 }
    const svg = renderScene(d.scenes[0], d, { idsAllowed: true, sid: 'rp0', warn: () => {} }).svg
    expect(svg).toContain('begin="tlgo.click;rp0r.click-12s"')
    expect(svg).toContain('<g id="rp0r">')
    expect(svg).not.toContain('end="rp0.click"')
    expect(svg).not.toContain('点击开始回放')
  })
  it('正文打字速度可按“字/秒”设置', () => {
    const d = defaultReplay()
    d.playback.typeSpeed = 10
    d.scenes = [makeScene([makeItem('text', { content: '一二三四五六七八九十'.repeat(3), enter: 'type-on' })])]
    const it0 = scheduleScene(d.scenes[0], d).items[0]
    expect(it0.tEnd - it0.tStart).toBeCloseTo(3 + 0.12, 2)
  })
  it('字形齐全时标题画成路径，缺字时回退为文字', () => {
    const d = defaultReplay()
    d.textMode = 'svg-text'
    d.glyphs = { zc: { 空: { d: 'M0 0L500 -700L1000 0Z', adv: 1000 }, 虚: { d: 'M0 0L1000 -700Z', adv: 1000 } } }
    d.scenes = [makeScene([makeItem('title', { content: '空虚', style: { face: 'zc' } }), makeItem('title', { content: '空白', style: { face: 'zc' } })])]
    const svg = scene0(d).svg
    expect(svg).toContain('d="M0 0L500 -700L1000 0Z"')
    expect(svg).toContain('>空白</text>')
    expect(normalizeReplay(d).glyphs?.zc['空'].adv).toBe(1000)
    expect(normalizeReplay({ ...d, glyphs: { zc: { 坏: { d: '<script>', adv: 1 } } } }).glyphs).toBeUndefined()
  })
})
