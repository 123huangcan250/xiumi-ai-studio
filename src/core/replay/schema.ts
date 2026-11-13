// 编辑回放的 schema：默认值、校验与修复。加载项目、模板和 AI 输出都经过 normalizeReplay。
import { nanoid } from 'nanoid'
import type { ImageRef } from '../types'
import type { CursorAction, EnterPreset, Pace, ReplayDoc, ReplayItem, ReplayItemType, ReplayScene, ReplayStyle, TextMode } from './types'

export const ITEM_TYPES: ReplayItemType[] = ['title', 'subtitle', 'text', 'image', 'tag', 'button', 'stat', 'quote', 'divider', 'shape']
export const PRESETS: EnterPreset[] = ['inspect-draw', 'glitch-settle', 'type-on', 'drag-in', 'pop', 'count-up', 'select-highlight', 'alert-box']
export const PACES: Pace[] = ['fast', 'turbo', 'normal']
const TEXT_MODES: TextMode[] = ['image', 'svg-text']
const ACTIONS: CursorAction[] = ['click', 'drag', 'type', 'none']

export const ITEM_LABEL: Record<ReplayItemType, string> = {
  title: '标题', subtitle: '副标题', text: '正文', image: '图片', tag: '标签', button: '按钮', stat: '数据卡', quote: '引语', divider: '分割线', shape: '图形',
}
export const PRESET_LABEL: Record<EnterPreset, string> = {
  'inspect-draw': '线框描出', 'glitch-settle': '故障定稿', 'type-on': '打字', 'drag-in': '拖入', pop: '弹出', 'count-up': '数字跳动', 'select-highlight': '选中高亮', 'alert-box': '红框警示',
}

/** 每种元素的默认进场预设 */
export const DEFAULT_PRESET: Record<ReplayItemType, EnterPreset> = {
  title: 'type-on', subtitle: 'glitch-settle', text: 'inspect-draw', image: 'drag-in', tag: 'pop', button: 'pop', stat: 'count-up', quote: 'select-highlight', divider: 'inspect-draw', shape: 'pop',
}

/** 预设对应的默认光标动作 */
export function defaultAction(preset: EnterPreset): CursorAction {
  return preset === 'drag-in' ? 'drag' : preset === 'type-on' ? 'type' : 'click'
}

export const DEFAULT_CONTENT: Record<ReplayItemType, string> = {
  title: '在这里输入标题', subtitle: '副标题', text: '在这里输入正文。', image: '', tag: '标签', button: '按钮', stat: '98%', quote: '一句值得被记住的话', divider: '', shape: 'rect',
}

export const newItemId = () => nanoid(8)

export function makeItem(type: ReplayItemType, patch: Partial<ReplayItem> = {}): ReplayItem {
  return { id: newItemId(), type, content: DEFAULT_CONTENT[type], ...(type === 'stat' && { label: '说明文字' }), ...patch }
}

export function makeScene(items: ReplayItem[] = []): ReplayScene {
  return { id: nanoid(6), layout: 'flow', finale: 'exit', items }
}

export function defaultReplay(): ReplayDoc {
  return {
    canvas: { width: 750, background: { type: 'color', value: '#071226', grid: { color: '#123a66', size: 50 } } },
    playback: { trigger: 'auto', pace: 'fast' },
    textMode: 'image',
    theme: { accent: '#36e6ff', inspector: '#2f80ff', alert: '#ff3b6b', text: '#eaf2ff', cursorPalette: ['#ff5c8a', '#36e6ff', '#ffd23f', '#7cff6b', '#b98bff', '#ff9f43'] },
    cursors: { count: 3, show: true },
    budget: { sceneKB: 80, totalKB: 400 },
    scenes: [
      makeScene([
        makeItem('tag', { content: 'EDIT REPLAY' }),
        makeItem('title', { content: '把写作过程做成回放' }),
        makeItem('text', { content: '在右侧填写文案和图片，元素会一个接一个被“编辑出来”。' }),
        makeItem('button', { content: '开始阅读' }),
      ]),
    ],
  }
}

// ---------- 校验与修复 ----------

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d)
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const color = (v: unknown, d: string) => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : d)

function imageRef(v: unknown): ImageRef | undefined {
  if (!isObj(v) || typeof v.src !== 'string' || !v.src) return undefined
  return { src: v.src, ...(typeof v.assetId === 'string' && { assetId: v.assetId }), ...(Number(v.width) > 0 && { width: Number(v.width) }), ...(Number(v.height) > 0 && { height: Number(v.height) }) }
}

function style(v: unknown): Partial<ReplayStyle> | undefined {
  if (!isObj(v)) return undefined
  const out: Partial<ReplayStyle> = {}
  if (v.color !== undefined) out.color = color(v.color, '#ffffff')
  if (v.fill !== undefined) out.fill = v.fill === '' ? '' : color(v.fill, '')
  if (v.stroke !== undefined) out.stroke = v.stroke === '' ? '' : color(v.stroke, '')
  if (v.fontSize !== undefined) out.fontSize = num(v.fontSize, 28, 12, 120)
  if (v.fontWeight !== undefined) out.fontWeight = Number(v.fontWeight) >= 600 ? 700 : 400
  if (v.align !== undefined) out.align = pick(v.align, ['left', 'center', 'right'] as const, 'left')
  if (v.lineHeight !== undefined) out.lineHeight = num(v.lineHeight, 1.6, 1, 3)
  if (v.letterSpacing !== undefined) out.letterSpacing = num(v.letterSpacing, 0, -2, 20)
  if (v.radius !== undefined) out.radius = num(v.radius, 0, 0, 200)
  if (typeof v.face === 'string' && /^[\w-]{1,24}$/.test(v.face)) out.face = v.face
  return Object.keys(out).length ? out : undefined
}

function item(v: unknown): ReplayItem | null {
  if (!isObj(v) || !ITEM_TYPES.includes(v.type)) return null
  const type = v.type as ReplayItemType
  const out: ReplayItem = { id: str(v.id) || newItemId(), type, content: str(v.content, DEFAULT_CONTENT[type]).slice(0, 2000) }
  if (v.label !== undefined) out.label = str(v.label).slice(0, 200)
  const img = imageRef(v.image)
  if (img) out.image = img
  if (isObj(v.frame)) {
    out.frame = { x: num(v.frame.x, 0, -750, 1500), y: num(v.frame.y, 0, -500, 5000), w: num(v.frame.w, 300, 1, 1500) }
    if (v.frame.h !== undefined) out.frame.h = num(v.frame.h, 100, 1, 5000)
  }
  const st = style(v.style)
  if (st) out.style = st
  if (PRESETS.includes(v.enter)) out.enter = v.enter
  if (v.delay !== undefined) out.delay = num(v.delay, 0, -5, 10)
  if (isObj(v.cursor)) {
    out.cursor = {}
    if (ACTIONS.includes(v.cursor.action)) out.cursor.action = v.cursor.action
    if (v.cursor.who !== undefined) out.cursor.who = Math.round(num(v.cursor.who, 0, 0, 5))
  }
  return out
}

function scene(v: unknown): ReplayScene {
  const s = isObj(v) ? v : {}
  const out: ReplayScene = {
    id: str(s.id) || nanoid(6),
    layout: pick(s.layout, ['flow', 'absolute'] as const, 'flow'),
    finale: pick(s.finale, ['exit', 'swarm'] as const, 'exit'),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 40).map(item).filter((x): x is ReplayItem => !!x),
  }
  if (s.height !== undefined && s.height !== null && s.height !== '') out.height = Math.round(num(s.height, 1100, 200, 6000))
  if (s.overlap !== undefined) out.overlap = num(s.overlap, 0.6, 0.1, 1)
  if (s.padding !== undefined) out.padding = Math.round(num(s.padding, 88, 0, 300))
  if (s.gap !== undefined) out.gap = Math.round(num(s.gap, 24, 0, 200))
  return out
}

/** 修复任意输入为合法的 ReplayDoc：未知字段丢弃，非法值回退默认值 */
export function normalizeReplay(raw: unknown): ReplayDoc {
  const d = defaultReplay()
  const r = isObj(raw) ? raw : {}
  const bg = isObj(r.canvas) && isObj(r.canvas.background) ? r.canvas.background : {}
  const bgType = pick(bg.type, ['color', 'gradient', 'image'] as const, d.canvas.background.type)
  const background: ReplayDoc['canvas']['background'] = {
    type: bgType,
    value: bgType === 'gradient' ? gradientValue(bg.value, '#071226,#0d2a52') : color(bg.value, d.canvas.background.value),
  }
  const bgImg = imageRef(bg.image)
  if (bgImg) background.image = bgImg
  if (isObj(bg.grid)) background.grid = { color: color(bg.grid.color, '#123a66'), size: Math.round(num(bg.grid.size, 50, 10, 300)) }
  else if (bg.grid === undefined && !isObj(r.canvas)) background.grid = d.canvas.background.grid

  const pb = isObj(r.playback) ? r.playback : {}
  const playback: ReplayDoc['playback'] = { trigger: pick(pb.trigger, ['auto', 'tap'] as const, 'auto'), pace: pick(pb.pace, PACES, 'fast') }
  if (isObj(pb.loop)) playback.loop = { hold: num(pb.loop.hold, 2, 0, 30) }
  if (pb.start !== undefined && Number(pb.start) > 0) playback.start = num(pb.start, 0, 0, 3600)
  if (typeof pb.triggerId === 'string' && /^[A-Za-z][\w-]{0,30}$/.test(pb.triggerId)) playback.triggerId = pb.triggerId
  if (pb.replay === true) playback.replay = true
  if (pb.typeSpeed !== undefined && Number(pb.typeSpeed) > 0) playback.typeSpeed = num(pb.typeSpeed, 10, 2, 60)

  const th = isObj(r.theme) ? r.theme : {}
  const palette = (Array.isArray(th.cursorPalette) ? th.cursorPalette : []).map((c: unknown) => color(c, '')).filter(Boolean).slice(0, 8)
  const cu = isObj(r.cursors) ? r.cursors : {}
  const names = Array.isArray(cu.names) ? cu.names.map((n: unknown) => str(n).slice(0, 12)) : undefined
  const bu = isObj(r.budget) ? r.budget : {}
  const scenes = (Array.isArray(r.scenes) ? r.scenes : []).slice(0, 12).map(scene)

  return {
    canvas: { width: 750, background },
    playback,
    textMode: pick(r.textMode, TEXT_MODES, 'image'),
    theme: {
      accent: color(th.accent, d.theme.accent),
      inspector: color(th.inspector, d.theme.inspector),
      alert: color(th.alert, d.theme.alert),
      text: color(th.text, d.theme.text),
      cursorPalette: palette.length ? palette : d.theme.cursorPalette,
    },
    cursors: { count: Math.round(num(cu.count, 3, 1, 6)), show: cu.show === undefined ? true : !!cu.show, ...(names && names.some(Boolean) && { names }) },
    budget: { sceneKB: num(bu.sceneKB, 80, 5, 2000), totalKB: num(bu.totalKB, 400, 10, 10000) },
    ...(glyphs(r.glyphs) && { glyphs: glyphs(r.glyphs) }),
    scenes: scenes.length ? scenes : d.scenes,
  }
}

const PATH_RE = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]*$/
/** 字形表：{ 字体名: { 字: { d, adv } } }，只保留合法的路径数据 */
function glyphs(v: unknown): ReplayDoc['glyphs'] | undefined {
  if (!isObj(v)) return undefined
  const out: NonNullable<ReplayDoc['glyphs']> = {}
  for (const [face, table] of Object.entries(v).slice(0, 4)) {
    if (!/^[\w-]{1,24}$/.test(face) || !isObj(table)) continue
    const t: Record<string, { d: string; adv: number }> = {}
    for (const [ch, g] of Object.entries(table).slice(0, 2000)) {
      if ([...ch].length !== 1 || !isObj(g) || typeof g.d !== 'string' || g.d.length > 20000 || !PATH_RE.test(g.d)) continue
      t[ch] = { d: g.d, adv: num(g.adv, 1000, 0, 3000) }
    }
    if (Object.keys(t).length) out[face] = t
  }
  return Object.keys(out).length ? out : undefined
}

function gradientValue(v: unknown, d: string): string {
  const colors = str(v)
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter((c) => COLOR_RE.test(c))
  return colors.length >= 2 ? colors.slice(0, 6).join(',') : d
}

/** 列出输入中会被修复的问题（属性面板与测试使用） */
export function validateReplay(raw: unknown): string[] {
  const issues: string[] = []
  if (!isObj(raw)) return ['数据不是对象，已使用默认模板']
  if (!Array.isArray(raw.scenes) || !raw.scenes.length) issues.push('没有场景，已补一个默认场景')
  ;(Array.isArray(raw.scenes) ? raw.scenes : []).forEach((s: unknown, i: number) => {
    if (!isObj(s)) return issues.push(`第 ${i + 1} 个场景格式错误`)
    ;(Array.isArray(s.items) ? s.items : []).forEach((it: unknown, j: number) => {
      if (!isObj(it) || !ITEM_TYPES.includes(it.type)) issues.push(`场景 ${i + 1} 第 ${j + 1} 个元素类型无效，已移除`)
      else if (it.enter !== undefined && !PRESETS.includes(it.enter)) issues.push(`场景 ${i + 1} 第 ${j + 1} 个元素的进场预设无效，已改为默认`)
    })
    if (s.layout === 'absolute') (Array.isArray(s.items) ? s.items : []).forEach((it: any, j: number) => isObj(it) && !isObj(it.frame) && issues.push(`场景 ${i + 1} 第 ${j + 1} 个元素缺少位置，按自动排版放置`))
  })
  const pb = isObj(raw.playback) ? raw.playback : {}
  if (pb.pace !== undefined && !PACES.includes(pb.pace)) issues.push('节奏无效，已改为 fast')
  return issues
}
