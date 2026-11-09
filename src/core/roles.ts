// 模块的标准名称：模板里的每个模块、收藏的每个组件都归到一个标准名称下（一级标题、双图左右、图片轮播……）。
// 套用模板时按名称取模块，同一个名称只用一个模块，所以整篇推文的标题、图片版式前后一致，也不会混进临时拼出来的版块。
import { isCarousel } from './fragments'
import { extractSlots, isPhotoSlot, type ImageSlot, type Parse, type TextSlot } from './slots'
import type { Block } from './types'

export type RoleId =
  | 'topDecor' | 'cover' | 'h1' | 'h2' | 'h3'
  | 'body' | 'container' | 'quote' | 'imageText'
  | 'img1' | 'img2lr' | 'img2tb' | 'img2big' | 'img3big' | 'img3row' | 'img4' | 'carousel' | 'multi'
  | 'timeline' | 'table' | 'divider' | 'ending' | 'other'

export type RoleGroup = '标题' | '文字' | '图片' | '装饰' | '结尾' | '其他'
/** 粗分类：沿用组件库原有的类别筛选 */
export type RoleKind = 'cover' | 'heading' | 'body' | 'image' | 'mixed' | 'ending' | 'decor'

export interface RoleDef {
  id: RoleId
  name: string
  group: RoleGroup
  kind: RoleKind
  /** 放几张照片；-1 表示两张及以上都可以（轮播） */
  photos: number
  hint: string
}

export const ROLES: RoleDef[] = [
  { id: 'topDecor', name: '顶部装饰', group: '装饰', kind: 'decor', photos: 0, hint: '放在推文最上方的横幅、刊头' },
  { id: 'cover', name: '封面标题', group: '标题', kind: 'cover', photos: 0, hint: '推文开头的大标题区，可带副标题' },
  { id: 'h1', name: '一级标题', group: '标题', kind: 'heading', photos: 0, hint: '章节标题，通常带序号' },
  { id: 'h2', name: '二级标题', group: '标题', kind: 'heading', photos: 0, hint: '章节内的小标题' },
  { id: 'h3', name: '三级标题', group: '标题', kind: 'heading', photos: 0, hint: '更小一级的标题' },
  { id: 'body', name: '正文段落', group: '文字', kind: 'body', photos: 0, hint: '普通正文' },
  { id: 'container', name: '大型容器', group: '文字', kind: 'body', photos: 0, hint: '带底色或边框的文本框，装一整段正文' },
  { id: 'quote', name: '引言', group: '文字', kind: 'body', photos: 0, hint: '引用的话、金句' },
  { id: 'imageText', name: '图文分栏', group: '图片', kind: 'mixed', photos: 1, hint: '一张图配一段文字' },
  { id: 'img1', name: '单图', group: '图片', kind: 'image', photos: 1, hint: '一张图，可带图注' },
  { id: 'img2lr', name: '双图左右', group: '图片', kind: 'image', photos: 2, hint: '两张图并排' },
  { id: 'img2tb', name: '双图上下', group: '图片', kind: 'image', photos: 2, hint: '两张图上下排列' },
  { id: 'img2big', name: '双图不对称一大一小', group: '图片', kind: 'image', photos: 2, hint: '一张大图搭一张小图' },
  { id: 'img3big', name: '三图一大二小', group: '图片', kind: 'image', photos: 3, hint: '一张大图搭两张小图' },
  { id: 'img3row', name: '三图并排', group: '图片', kind: 'image', photos: 3, hint: '三张图一行' },
  { id: 'img4', name: '四图对称布局', group: '图片', kind: 'image', photos: 4, hint: '2×2 四宫格' },
  { id: 'carousel', name: '图片轮播', group: '图片', kind: 'image', photos: -1, hint: '左右滑动的多张图' },
  { id: 'multi', name: '多图拼贴', group: '图片', kind: 'image', photos: 5, hint: '五张及以上的拼图' },
  { id: 'timeline', name: '时间轴', group: '文字', kind: 'body', photos: 0, hint: '日程、流程' },
  { id: 'table', name: '数据表', group: '文字', kind: 'body', photos: 0, hint: '表格数据' },
  { id: 'divider', name: '分割装饰', group: '装饰', kind: 'decor', photos: 0, hint: '章节之间的分隔' },
  { id: 'ending', name: '结尾署名', group: '结尾', kind: 'ending', photos: 0, hint: '结束语、署名、关注引导' },
  { id: 'other', name: '其他', group: '其他', kind: 'decor', photos: 0, hint: '套用时不使用' },
]

const BY_ID = new Map(ROLES.map((r) => [r.id, r]))
export const isRoleId = (v: unknown): v is RoleId => typeof v === 'string' && BY_ID.has(v as RoleId)
export const roleDef = (id: RoleId): RoleDef => BY_ID.get(id) ?? BY_ID.get('other')!
export const roleName = (id: RoleId | '' | undefined) => (id ? roleDef(id).name : '未分类')
export const HEADING_ROLES: RoleId[] = ['h1', 'h2', 'h3']

/** 能放 n 张照片的图片版式，按常用程度排序 */
export function rolesForPhotos(n: number): RoleId[] {
  if (n <= 1) return ['img1', 'imageText']
  const exact = ROLES.filter((r) => r.group === '图片' && r.photos === n).map((r) => r.id)
  return [...exact, ...(n >= 5 ? ['multi' as RoleId] : []), 'carousel']
}

const CJK = /[一-鿿]/
const CREDIT = /^[一-鿿]{1,6}\s*[丨|｜:：]\s*\S/
const CREDIT_LABEL = /^(文字|文案|图片|摄影|供图|编辑|排版|审核|责编|供稿|来源|美编|校对|活动组织|策划)\s*[丨|｜:：]/
const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

/** 名称或标签里直接写了标准名称（例如“二级标题 · 实验室见闻”） */
const LABEL_HINTS: [RegExp, RoleId][] = [
  [/一级标题/, 'h1'], [/二级标题/, 'h2'], [/三级标题/, 'h3'], [/轮播|滑动/, 'carousel'], [/四图|四宫格|2\s*[×x]\s*2/i, 'img4'],
  [/三图并排/, 'img3row'], [/三图|一大二小/, 'img3big'], [/双图上下/, 'img2tb'], [/一大一小|不对称/, 'img2big'], [/双图/, 'img2lr'],
  [/大型容器|文本框/, 'container'], [/分割|分隔/, 'divider'], [/署名|结尾/, 'ending'], [/封面/, 'cover'],
]

export function roleFromLabel(label: string): RoleId | undefined {
  const exact = ROLES.find((r) => label.startsWith(r.name))
  if (exact) return exact.id
  return LABEL_HINTS.find(([re]) => re.test(label))?.[1]
}

function rootOf(html: string, parse: Parse) {
  return parse(`<!doctype html><html><body><section id="__r">${html}</section></body></html>`).getElementById('__r')!
}

/** 照片相对整行的宽度：沿祖先累乘百分比宽度；弹性布局里没写宽度的子元素按平均分 */
function widthShare(img: Element, root: Element): number {
  let share = 1
  for (let el: Element | null = img; el && el !== root; el = el.parentElement) {
    const st = el.getAttribute('style') ?? ''
    const pct = st.match(/(?:^|;)\s*width:\s*([\d.]+)%/i)?.[1]
    const px = st.match(/(?:^|;)\s*width:\s*([\d.]+)px/i)?.[1]
    const parent = el.parentElement
    const flexParent = parent && /display:\s*(inline-)?flex/i.test(parent.getAttribute('style') ?? '') && !/flex-direction:\s*column/i.test(parent.getAttribute('style') ?? '')
    if (pct) share *= Math.min(1, Number(pct) / 100)
    else if (px && Number(px) < 640) share *= Number(px) / 640
    else if (flexParent && parent.children.length > 1) share *= 1 / parent.children.length
    else if (/display:\s*inline-block/i.test(st) && parent && parent.children.length > 1) share *= 1 / parent.children.length
  }
  return share
}

/** 横向滚动的图集（非 SVG 的轮播） */
function scrollsSideways(root: Element) {
  return Array.from(root.querySelectorAll('[style*="overflow"]')).some((el) => /overflow(-x)?:\s*(auto|scroll)/i.test(el.getAttribute('style') ?? '') && el.querySelectorAll('img').length >= 2)
}

function photoLayout(widths: number[]): RoleId {
  const n = widths.length
  const sorted = [...widths].sort((a, b) => b - a)
  if (n === 2) {
    if (sorted[0] >= 0.75 && sorted[1] >= 0.75) return 'img2tb'
    return sorted[0] - sorted[1] > 0.12 ? 'img2big' : 'img2lr'
  }
  if (n === 3) return sorted[0] <= 0.4 ? 'img3row' : 'img3big'
  if (n === 4) return 'img4'
  return 'multi'
}

interface Probe {
  texts: TextSlot[]
  photos: number
  widths: number[]
  carousel: boolean
  boxy: boolean
}

function probe(html: string, parse: Parse, ratios?: Record<string, number>): Probe {
  const slots = extractSlots(html, parse)
  const root = rootOf(html, parse)
  const photoSlots = slots.filter((s): s is ImageSlot => s.kind === 'image' && isPhotoSlot(s, ratios))
  const photoSrcs = new Set(photoSlots.map((s) => s.src))
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => photoSrcs.has(i.getAttribute('src') ?? ''))
  return {
    texts: slots.filter((s): s is TextSlot => s.kind === 'text'),
    photos: photoSlots.length,
    widths: imgs.slice(0, photoSlots.length).map((i) => widthShare(i, root)),
    carousel: isCarousel(html, parse) || scrollsSideways(root),
    boxy: /background(-color)?:|border(-\w+)?:\s*\d|box-shadow/i.test(root.firstElementChild?.getAttribute('style') ?? ''),
  }
}

const BUILTIN_ROLE: Partial<Record<Block['type'], RoleId>> = {
  cover: 'cover', heading: 'h1', paragraph: 'body', card: 'container', quote: 'quote', imageText: 'imageText', image: 'img1', frame: 'img1',
  gallery: 'multi', carousel: 'carousel', box: 'container', timeline: 'timeline', table: 'table', divider: 'divider', ending: 'ending', profile: 'other',
}

/** 单个模块的标准名称（猜测，用户可以改）。label 是模块或组件的名称 */
export function guessRole(block: Block, opts: { parse?: Parse; ratios?: Record<string, number>; label?: string } = {}): RoleId {
  const parse = opts.parse ?? defaultParse
  const label = opts.label ?? (block.type === 'html' ? block.props.label : '')
  const named = label ? roleFromLabel(label) : undefined
  if (named) return named
  if (block.type === 'photos') {
    const { count, layout } = block.props
    return count === 4 ? 'img4' : count === 3 ? (layout === 'feature' ? 'img3big' : 'img3row') : layout === 'feature' ? 'img2big' : 'img2lr'
  }
  if (block.type !== 'html') return BUILTIN_ROLE[block.type] ?? 'other'
  const p = probe(block.props.html, parse, opts.ratios)
  const cjk = p.texts.filter((t) => CJK.test(t.text))
  const body = cjk.filter((t) => t.role === 'body')
  if (p.carousel && p.photos + (/background-image/i.test(block.props.html) ? 2 : 0) >= 2) return 'carousel'
  const longBody = body.some((t) => t.text.length >= 40)
  if (p.photos >= 2) return longBody ? 'container' : photoLayout(p.widths)
  if (p.photos === 1) return longBody ? (p.boxy ? 'container' : 'imageText') : 'img1'
  const credits = cjk.filter((t) => CREDIT.test(t.text))
  if (cjk.length && cjk.length <= 8 && (credits.length >= 2 || credits.some((t) => CREDIT_LABEL.test(t.text)))) return 'ending'
  if (body.length) {
    const all = body.map((t) => t.text).join('')
    if (/^[“"「]/.test(all) && /——|—\s*\S/.test(all) && all.length < 160) return 'quote'
    return p.boxy ? 'container' : 'body'
  }
  if (cjk.some((t) => t.role === 'title' || t.role === 'caption') || p.texts.some((t) => t.role === 'number')) return p.texts.some((t) => t.role === 'number') ? 'h1' : 'h2'
  return 'divider'
}

/**
 * 整个模板的标准名称：先逐个猜，再按位置修正——
 * 开头带中文大标题的模块是封面标题，它前面的装饰是顶部装饰；最后的署名是结尾；没有一级标题时把第一种二级标题升为一级。
 */
export function guessTemplateRoles(blocks: Block[], opts: { parse?: Parse; ratios?: Record<string, number> } = {}): RoleId[] {
  const parse = opts.parse ?? defaultParse
  const roles = blocks.map((b) => guessRole(b, { ...opts, parse }))
  const named = blocks.map((b) => (b.type === 'html' ? roleFromLabel(b.props.label) : undefined))
  if (!roles.includes('cover')) {
    // 前四个模块里中文标题字数最多的一个（刊头装饰里零星的中文不算）
    const cjkTitle = (b: Block) =>
      b.type === 'html'
        ? extractSlots(b.props.html, parse)
            .filter((s): s is TextSlot => s.kind === 'text' && s.role !== 'body' && CJK.test(s.text))
            .reduce((n, s) => n + (s.text.match(/[一-鿿]/g)?.length ?? 0), 0)
        : 0
    let best = -1
    let most = 3
    blocks.slice(0, 4).forEach((b, i) => {
      if (named[i] || !['h1', 'h2', 'divider', 'body'].includes(roles[i])) return
      const n = cjkTitle(b)
      if (n > most) [best, most] = [i, n]
    })
    if (best >= 0) roles[best] = 'cover'
  }
  // 最后一个不是图片的模块多为署名、团队信息
  const last = blocks.length - 1
  if (last > 2 && !named[last] && !roles.includes('ending') && roleDef(roles[last]).group !== '图片') roles[last] = 'ending'
  const c = roles.indexOf('cover')
  for (let i = 0; i < c; i++) if (['divider', 'other', 'body', 'h1', 'h2'].includes(roles[i]) && !named[i]) roles[i] = 'topDecor'
  if (!roles.includes('h1')) {
    const first = roles.indexOf('h2')
    if (first >= 0) {
      const sig = (b: Block) => (b.type === 'html' ? b.props.html.length : 0)
      // 同一种样式的二级标题一起升级
      roles.forEach((r, i) => {
        if (r === 'h2' && !named[i] && Math.abs(sig(blocks[i]) - sig(blocks[first])) < 40) roles[i] = 'h1'
      })
    }
  }
  return roles
}

/** 一组候选模块（来自模板或组件库）里出现了哪些标准名称 */
export function rolesPresent(list: { role: RoleId }[]): Set<RoleId> {
  return new Set(list.map((c) => c.role).filter((r) => r !== 'other'))
}
