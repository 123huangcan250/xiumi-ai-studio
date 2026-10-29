// 套用模板：把收藏的模板拆成“部件”（每个模块一个），由 AI 或规则为新推文选部件、写文案、分配照片，
// 再按槽位填充生成文档。部件保留模板原有的结构与样式，所以新推文延续模板的版式。
import { blockMeta, coerceProps, createBlock, newId } from './blocks'
import type { Outline } from './outline'
import { richToPlain } from './richtext'
import { extractSlots, fillSlots, isPhotoSlot, skeleton, type ImageSlot, type Parse, type SlotRole, type SlotValues, type TextSlot } from './slots'
import { analyzeStyle, themeFromReport } from './styleExtract'
import { THEMES } from './themes'
import type { Block, BlockType, Doc, ImageRef, ThemeTokens } from './types'

export interface TemplateLike {
  id: string
  name: string
  blocks: Block[]
  themeId?: string
  themeOverrides?: Partial<ThemeTokens>
}

export type PartKind = 'cover' | 'heading' | 'body' | 'image' | 'mixed' | 'ending' | 'decor'

export interface Part {
  /** 模板部件 p0、p1…；内置模块 b:类型 */
  id: string
  from: string
  block: Block
  kind: PartKind
  texts: TextSlot[]
  /** 可放照片的位置数（不含装饰图） */
  photos: number
  /** 相册：照片数量可变 */
  flexible?: boolean
}

export interface PlanItem {
  part: string
  /** 槽位 id → 新文字；null 表示保留模板原文，"" 表示删除这一行 */
  text: Record<string, string | null>
  /** 照片编号 */
  images: number[]
}
export interface FillPlan {
  title: string
  digest: string
  items: PlanItem[]
}

/** 内置模块的文字字段与角色 */
const BUILTIN_TEXT: Partial<Record<BlockType, [string, SlotRole][]>> = {
  cover: [['kicker', 'label'], ['title', 'title'], ['subtitle', 'caption'], ['meta', 'caption']],
  heading: [['index', 'number'], ['title', 'title'], ['subtitle', 'label']],
  paragraph: [['content', 'body']],
  card: [['title', 'title'], ['content', 'body']],
  quote: [['text', 'body'], ['source', 'caption']],
  imageText: [['title', 'title'], ['content', 'body']],
  image: [['caption', 'caption']],
  gallery: [['caption', 'caption']],
  timeline: [['items', 'body']],
  table: [['rows', 'body']],
  profile: [['name', 'title'], ['role', 'caption'], ['bio', 'body']],
  ending: [['text', 'body'], ['note', 'caption'], ['author', 'caption']],
}
const BUILTIN_KIND: Record<Exclude<BlockType, 'html'>, PartKind> = {
  cover: 'cover', heading: 'heading', paragraph: 'body', card: 'body', quote: 'body', imageText: 'mixed', image: 'image',
  gallery: 'image', timeline: 'body', table: 'body', profile: 'mixed', divider: 'decor', ending: 'ending',
}
const BUILTIN_PHOTOS: Partial<Record<BlockType, number>> = { cover: 1, imageText: 1, image: 1, profile: 1 }
/** 模板里缺少某类部件时可用的内置模块（跟随文档主题） */
const BUILTIN_PARTS: Exclude<BlockType, 'html'>[] = ['cover', 'heading', 'paragraph', 'card', 'quote', 'imageText', 'image', 'gallery', 'timeline', 'table', 'divider', 'ending']

const ENDING_RE = /关注|扫码|二维码|长按|识别|END|编辑|审核|排版|来源|供稿|阅读|在看|点赞|分享|转发/i
const CREDIT_LABEL = '文字|文\\s*字|图片|摄影|编辑|排版|审核|责编|供稿|来源|美编|校对|初审|复审|终审|文|图'
const CREDIT_RE = new RegExp(`^(${CREDIT_LABEL})\\s*[：:|丨/｜]`)

function builtinTexts(b: Block): TextSlot[] {
  const p: any = b.props
  return (BUILTIN_TEXT[b.type] ?? []).map(([key, role]) => {
    const text =
      key === 'content'
        ? richToPlain(p.content)
        : key === 'items'
          ? p.items.map((i: any) => [i.time, i.title, i.desc].join(' | ')).join('\n')
          : key === 'rows'
            ? [p.headers, ...p.rows].map((r: string[]) => r.join(' | ')).join('\n')
            : String(p[key] ?? '')
    return { id: key, kind: 'text', role, text, max: role === 'body' ? 0 : role === 'title' ? 30 : 20, tight: false }
  })
}

function htmlKind(texts: TextSlot[], photos: number, k: number, n: number): PartKind {
  const has = (r: SlotRole) => texts.some((t) => t.role === r)
  // 整篇模板的首尾模块通常是封面和结尾（关注引导、署名、二维码）
  if (n > 2 && k === 0 && (has('title') || photos)) return 'cover'
  if (n > 2 && k === n - 1 && ENDING_RE.test(texts.map((t) => t.text).join(' '))) return 'ending'
  if (!has('title') && !has('body') && !has('caption') && !photos) return 'decor'
  if (photos && has('body')) return 'mixed'
  if (photos) return 'image'
  if (has('body')) return 'body'
  return 'heading'
}

/** 把模板拆成部件；样式相同、只是文字图片不同的模块合并为一个 */
export function buildCatalog(templates: TemplateLike[], opts: { parse?: Parse; ratios?: Record<string, number> } = {}): Part[] {
  const parts: Part[] = []
  const seen = new Set<string>()
  for (const t of templates) {
    const n = t.blocks.length
    t.blocks.forEach((b, k) => {
      let texts: TextSlot[]
      let photos: number
      let kind: PartKind
      let sig: string
      if (b.type === 'html') {
        const slots = extractSlots(b.props.html, opts.parse)
        texts = slots.filter((s): s is TextSlot => s.kind === 'text')
        photos = slots.filter((s): s is ImageSlot => s.kind === 'image' && isPhotoSlot(s, opts.ratios)).length
        kind = htmlKind(texts, photos, k, n)
        sig = `${kind}|${skeleton(b.props.html, opts.parse)}`
      } else {
        texts = builtinTexts(b)
        photos = b.type === 'gallery' ? b.props.images.length || 3 : (BUILTIN_PHOTOS[b.type] ?? 0)
        kind = BUILTIN_KIND[b.type]
        sig = `${b.type}|${(b.props as any).variant ?? ''}|${t.themeId ?? ''}`
      }
      if (seen.has(sig)) return
      seen.add(sig)
      parts.push({ id: `p${parts.length}`, from: t.name, block: b, kind, texts, photos, flexible: b.type === 'gallery' })
    })
  }
  for (const type of BUILTIN_PARTS) {
    const b = createBlock(type)
    parts.push({ id: `b:${type}`, from: '内置模块', block: b, kind: BUILTIN_KIND[type], texts: builtinTexts(b), photos: BUILTIN_PHOTOS[type] ?? (type === 'gallery' ? 3 : 0), flexible: type === 'gallery' })
  }
  return parts
}

/** 发给模型的部件清单：只给槽位与示例文字 */
export function catalogBrief(parts: Part[]) {
  return parts.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.block.type === 'html' ? p.block.props.label : blockMeta(p.block.type).label,
    from: p.from,
    texts: p.texts.map((t) => ({ id: t.id, role: t.role, ...(t.max ? { max: t.max } : {}), ...(t.tight ? { tight: true } : {}), sample: t.text.slice(0, 24) })),
    images: p.flexible ? '1-9' : p.photos,
  }))
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** 校验模型返回的方案：未知部件和槽位丢弃，SVG 内文字按字数截断，每张照片只用一次 */
export function normalizePlan(raw: any, parts: Part[], photoCount: number): FillPlan {
  const byId = new Map(parts.map((p) => [p.id, p]))
  const used = new Set<number>()
  const items: PlanItem[] = []
  for (const it of Array.isArray(raw?.parts) ? raw.parts : []) {
    const p = byId.get(String(it?.part ?? ''))
    if (!p) continue
    const src = it?.text && typeof it.text === 'object' ? it.text : {}
    const text: Record<string, string | null> = {}
    for (const t of p.texts) {
      if (!(t.id in src)) continue
      const v = src[t.id]
      if (v === null) text[t.id] = null
      else if (typeof v === 'string' || typeof v === 'number') {
        const s = String(v).trim()
        text[t.id] = t.tight ? [...s.replace(/\s*\n+\s*/g, ' ')].slice(0, t.max).join('') : s
      }
    }
    const images: number[] = []
    for (const x of Array.isArray(it?.images) ? it.images : []) {
      const i = Number(x)
      if (Number.isInteger(i) && i >= 0 && i < photoCount && !used.has(i)) {
        used.add(i)
        images.push(i)
      }
    }
    items.push({ part: p.id, text, images })
  }
  return { title: str(raw?.title, 64), digest: str(raw?.digest, 120), items }
}

function parseRows(s: string) {
  return s
    .split('\n')
    .map((l) => l.split(/\s*[|｜]\s*/).map((c) => c.trim()))
    .filter((r) => r.some(Boolean))
}

/** 内置模块：按字段名写入文字与照片 */
function fillBuiltin(p: Part, text: Record<string, string | null>, refs: ImageRef[]): Block | null {
  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(text)) {
    if (v === null) continue
    if (k === 'items') raw.items = parseRows(v).map(([time = '', title = '', desc = '']) => ({ time, title, desc }))
    else if (k === 'rows') {
      const rows = parseRows(v)
      raw.headers = rows[0] ?? []
      raw.rows = rows.slice(1)
    } else raw[k] = v
  }
  if (p.block.type === 'gallery') {
    if (!refs.length) return null
    raw.images = refs
    raw.columns = refs.length === 1 ? 1 : refs.length === 2 || refs.length === 4 ? 2 : 3
  } else if (refs[0] && BUILTIN_PHOTOS[p.block.type]) raw.image = refs[0]
  const props = { ...p.block.props, ...coerceProps(p.block.type, raw, true) }
  return { id: newId(), type: p.block.type, props } as Block
}

export interface BuildOptions {
  parse?: Parse
  ratios?: Record<string, number>
  title?: string
  theme?: { themeId?: string; themeOverrides?: Partial<ThemeTokens> }
}

/** 按方案生成文档；照片不够时用未分配的照片补位，仍不够则保留模板原图并提示 */
export function buildFromPlan(plan: FillPlan, parts: Part[], photos: ImageRef[], opts: BuildOptions = {}): { doc: Doc; warnings: string[] } {
  const byId = new Map(parts.map((p) => [p.id, p]))
  const planned = new Set(plan.items.flatMap((i) => i.images))
  const spare = photos.map((_, i) => i).filter((i) => !planned.has(i))
  const used = new Set<number>()
  let kept = 0
  const blocks: Block[] = []
  let endingAt = -1
  for (const it of plan.items) {
    const p = byId.get(it.part)
    if (!p) continue
    const ids = [...it.images]
    if (p.block.type === 'html') {
      const slots = extractSlots(p.block.props.html, opts.parse)
      const photoSlots = slots.filter((s): s is ImageSlot => s.kind === 'image' && isPhotoSlot(s, opts.ratios))
      const values: SlotValues = { ...it.text }
      photoSlots.forEach((s, k) => {
        const i = ids[k] ?? (p.kind === 'ending' ? undefined : spare.shift())
        if (i === undefined) {
          if (p.kind !== 'ending') kept++
          return
        }
        values[s.id] = photos[i]
        used.add(i)
      })
      const label = p.block.props.label
      blocks.push({ id: newId(), type: 'html', props: { html: fillSlots(p.block.props.html, values, { parse: opts.parse, ratios: opts.ratios }), label } })
    } else {
      const need = p.flexible ? ids.length : p.photos
      while (ids.length < need && spare.length && p.kind !== 'ending') ids.push(spare.shift()!)
      const b = fillBuiltin(p, it.text, ids.slice(0, p.flexible ? 9 : Math.max(need, 0)).map((i) => photos[i]))
      if (!b) continue
      ids.slice(0, p.flexible ? 9 : need).forEach((i) => used.add(i))
      blocks.push(b)
    }
    if (p.kind === 'ending') endingAt = blocks.length - 1
  }
  // 没用上的照片：在结尾之前补一个相册
  const rest = photos.filter((_, i) => !used.has(i))
  if (rest.length) {
    const g = createBlock('gallery', { images: rest, columns: rest.length === 1 ? 1 : rest.length === 2 || rest.length === 4 ? 2 : 3, caption: '' })
    blocks.splice(endingAt >= 0 ? endingAt : blocks.length, 0, g)
  }
  const warnings = kept ? [`${kept} 处图片位置的照片不够，沿用了模板原图，请选中后替换`] : []
  const firstPhoto = plan.items.flatMap((i) => i.images)[0]
  const now = Date.now()
  return {
    doc: {
      id: newId(),
      title: plan.title || opts.title || '未命名推文',
      author: '',
      digest: plan.digest,
      themeId: opts.theme?.themeId ?? 'minimal-magazine',
      ...(opts.theme?.themeOverrides && { themeOverrides: opts.theme.themeOverrides }),
      cover: photos[firstPhoto ?? 0],
      blocks,
      createdAt: now,
      updatedAt: now,
    },
    warnings,
  }
}

/**
 * 新推文的主题：以原文片段为主的模板，从片段样式中提取配色与字号，让内置模块（时间轴、表格、相册等）与模板协调；
 * 以内置模块为主的模板沿用收藏时的主题。
 */
export function templateTheme(templates: TemplateLike[], parse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')): BuildOptions['theme'] {
  const blocks = templates.flatMap((t) => t.blocks)
  const html = blocks.flatMap((b) => (b.type === 'html' ? [b.props.html] : []))
  if (!html.length || html.length * 2 < blocks.length) {
    const t = templates.find((x) => x.themeId)
    return t ? { themeId: t.themeId, themeOverrides: t.themeOverrides } : undefined
  }
  const root = parse(`<!doctype html><html><body><section id="__t">${html.join('')}</section></body></html>`).getElementById('__t')!
  const theme = themeFromReport(analyzeStyle(root), '模板风格')
  const tokens = Object.fromEntries(Object.entries(theme).filter(([k]) => !['id', 'name', 'description'].includes(k))) as Partial<ThemeTokens>
  return { themeId: THEMES[0].id, themeOverrides: tokens }
}

const CN = '一二三四五六七八九十'
const ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'
/** 沿用原序号的写法：01 → 02，第一章 → 第二章，PART 1 → PART 2 */
export function renumber(orig: string, n: number): string {
  if (/\d+/.test(orig)) return orig.replace(/\d+/, (d) => String(n).padStart(d.length, '0'))
  if (/[一二三四五六七八九十]+/.test(orig)) return orig.replace(/[一二三四五六七八九十]+/, n <= 10 ? CN[n - 1] : String(n))
  if (/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+/.test(orig)) return orig.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+/, ROMAN[n - 1] ?? String(n))
  return String(n).padStart(2, '0')
}

/** 署名行：换成新文稿的署名；没有时只保留“文字：”这类标签，去掉旧名字 */
function creditText(orig: string, author: string): string {
  if (author.trim()) return author.trim()
  return orig
    .split(/\s+/)
    .filter((tok) => CREDIT_RE.test(tok))
    .map((tok) => tok.match(CREDIT_RE)![0])
    .join(' ')
}

/** 把段落按顺序分成 n 组（每组用换行连接，填入时复制段落样式） */
function chunk(list: string[], n: number): string[] {
  const out: string[] = []
  let start = 0
  for (let k = 0; k < n && start < list.length; k++) {
    const size = Math.ceil((list.length - start) / (n - k))
    out.push(list.slice(start, start + size).join('\n'))
    start += size
  }
  return out
}

/** 不用 AI 时的规则方案：封面 → 导语 → 各章节（标题、正文、照片）→ 剩余照片 → 结尾 */
export function rulePlan(o: Outline, parts: Part[], photoCount: number): FillPlan {
  const tpl = parts.filter((p) => !p.id.startsWith('b:'))
  const of = (k: PartKind) => tpl.filter((p) => p.kind === k)
  const builtin = (t: BlockType) => parts.find((p) => p.id === `b:${t}`)!
  const cycle = <T,>(list: T[], i: number) => list[i % list.length]
  const items: PlanItem[] = []
  let next = 0
  const take = (n: number) => {
    const out: number[] = []
    while (out.length < n && next < photoCount) out.push(next++)
    return out
  }
  const bodyCount = (p: Part) => p.texts.filter((t) => t.role === 'body').length
  const fill = (p: Part, c: { titles?: string[]; bodies?: string[]; captions?: string[]; labels?: string[]; number?: number }, images: number[] = []) => {
    const q = { title: [...(c.titles ?? [])], body: [...(c.bodies ?? [])], caption: [...(c.captions ?? [])], label: [...(c.labels ?? [])] }
    const text: Record<string, string | null> = {}
    for (const t of p.texts) {
      if (t.role === 'number') text[t.id] = c.number === undefined ? null : renumber(t.text, c.number)
      else if (t.role === 'label') text[t.id] = q.label.shift() ?? null // 英文装饰标签保留
      else text[t.id] = q[t.role].shift() ?? ''
    }
    items.push({ part: p.id, text, images })
  }

  const bodyParts = of('body')
  const plain = bodyParts.filter((p) => p.texts.every((t) => t.role === 'body' || t.role === 'label'))
  const textParts = plain.length ? plain : bodyParts
  let bi = 0
  const bodies = (list: string[]) => {
    const rest = list.filter(Boolean)
    while (rest.length) {
      const p = textParts.length ? cycle(textParts, bi++) : builtin('paragraph')
      fill(p, { bodies: rest.splice(0, Math.max(1, bodyCount(p))) })
    }
  }
  const imgParts = of('image').filter((p) => p.photos > 0)
  let ii = 0
  const pics = (n: number) => {
    while (n > 0 && next < photoCount) {
      const fits = imgParts.filter((p) => p.photos <= n)
      if (fits.length) {
        const best = Math.max(...fits.map((p) => p.photos))
        const p = cycle(
          fits.filter((x) => x.photos === best),
          ii++,
        )
        fill(p, {}, take(p.photos))
        n -= p.photos
      } else {
        const ids = take(n)
        fill(builtin(ids.length === 1 ? 'image' : 'gallery'), {}, ids)
        n = 0
      }
    }
  }

  const cover = of('cover')[0]
  if (cover) {
    // 副标题放进第二个标题位；没有时放进小字说明或正文位
    const two = cover.texts.filter((t) => t.role === 'title').length >= 2
    fill(cover, { titles: two ? [o.title, o.subtitle] : [o.title], captions: two ? [o.meta] : [o.subtitle, o.meta], bodies: two ? [] : [o.subtitle] }, take(cover.photos))
  }
  else fill(builtin('cover'), { titles: [o.title], captions: [o.subtitle, o.meta], labels: o.kicker ? [o.kicker] : [] }, take(1))
  bodies(o.intro)

  const heads = of('heading')
  const mixed = of('mixed').filter((p) => p.photos > 0 && bodyCount(p) > 0)
  const decor = of('decor')
  const sections = o.sections.length || 1
  const restPhotos = photoCount - next
  const quota = o.sections.map((_, i) => Math.min(4, Math.floor(restPhotos / sections) + (i < restPhotos % sections ? 1 : 0)))
  o.sections.forEach((s, i) => {
    if (i > 0 && decor.length) fill(cycle(decor, i), {})
    fill(heads.length ? cycle(heads, i) : builtin('heading'), { titles: [s.heading], number: i + 1 })
    const paras = [...s.paragraphs]
    let q = quota[i]
    if (!textParts.length && mixed.length) {
      // 模板没有单独的正文版块（秀米常见：一整节图文混排）：每节选一个照片数合适的图文版块承载全部正文
      const fits = mixed.filter((p) => p.photos <= q)
      const best = fits.length ? Math.max(...fits.map((p) => p.photos)) : -1
      const m = fits.length ? cycle(fits.filter((p) => p.photos === best), i) : undefined
      if (m && paras.length) {
        q -= m.photos
        fill(m, { bodies: chunk(paras.splice(0), bodyCount(m)) }, take(m.photos))
      }
      pics(q)
      bodies(paras)
    } else {
      const m = mixed.length ? cycle(mixed, i) : undefined
      // 隔一节用一次图文混排部件，节奏有变化
      if (m && i % 2 === 1 && paras.length && m.photos <= q) {
        q -= m.photos
        fill(m, { bodies: paras.splice(0, bodyCount(m)) }, take(m.photos))
      } else bodies(paras.splice(0, 1))
      pics(q)
      bodies(paras)
    }
    if (s.timeline.length) fill(builtin('timeline'), { bodies: [s.timeline.map((t) => [t.time, t.title, t.desc].join(' | ')).join('\n')] })
    if (s.table) fill(builtin('table'), { bodies: [[s.table.headers, ...s.table.rows].map((r) => r.join(' | ')).join('\n')] })
    s.quotes.slice(0, 2).forEach((x) => fill(builtin('quote'), { bodies: [x.text], captions: [x.source] }))
  })
  pics(photoCount - next)

  const end = of('ending')[0]
  if (end) {
    const text: Record<string, string | null> = {}
    let wrote = false
    for (const t of end.texts) {
      if (CREDIT_RE.test(t.text)) {
        text[t.id] = wrote ? (o.ending.author.trim() ? '' : creditText(t.text, '')) : creditText(t.text, o.ending.author)
        wrote = true
      } else if (t.role !== 'label' && !ENDING_RE.test(t.text)) text[t.id] = '' // 结尾里混进的旧正文
    }
    items.push({ part: end.id, text, images: [] })
  } else fill(builtin('ending'), { bodies: [o.ending.text || '感谢阅读'], captions: [o.ending.note || '欢迎关注我们，获取更多活动资讯', o.ending.author || '文字 / 图片 / 编辑：'] })
  return { title: o.title, digest: o.subtitle.slice(0, 54), items }
}
