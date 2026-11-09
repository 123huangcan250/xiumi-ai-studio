// 模板部件：把收藏的模板拆成“部件”（每个模块一个），供组件库挑选、收藏。
// 套用模板生成新推文见 assemble.ts（按模块的标准名称取用）。
import { createBlock } from './blocks'
import { richToPlain } from './richtext'
import { backgroundPhotos, extractFrames, extractSlots, isPhotoSlot, skeleton, type ImageSlot, type Parse, type SlotRole, type TextSlot } from './slots'
import { analyzeStyle, themeFromReport } from './styleExtract'
import { THEMES } from './themes'
import type { Block, BlockType, ThemeTokens } from './types'

export interface TemplateLike {
  id: string
  name: string
  blocks: Block[]
  themeId?: string
  themeOverrides?: Partial<ThemeTokens>
}

export type PartKind = 'cover' | 'heading' | 'body' | 'image' | 'mixed' | 'ending' | 'decor'

export interface Part {
  /** 模板部件 p0、p1…；从模板照片位提取的图片框 f0、f1…；内置模块 b:类型 */
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
  box: 'body', carousel: 'image', frame: 'image', photos: 'image',
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

/** 单独一个模块属于哪类部件（组件库分类用） */
export function guessKind(block: Block, parse?: Parse): PartKind {
  if (block.type !== 'html') return BUILTIN_KIND[block.type]
  const slots = extractSlots(block.props.html, parse)
  const texts = slots.filter((s): s is TextSlot => s.kind === 'text')
  const photos = slots.filter((s): s is ImageSlot => s.kind === 'image' && isPhotoSlot(s)).length + backgroundPhotos(block.props.html, parse).length
  if (texts.length && texts.length <= 6 && texts.some((t) => CREDIT_RE.test(t.text) || /关注|扫码|二维码/.test(t.text))) return 'ending'
  return htmlKind(texts, photos, 0, 1)
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
  // 图片框：模板里每种相框样式一份，可重复使用来放多出的照片
  let frames = 0
  for (const t of templates) {
    for (const b of t.blocks) {
      if (b.type !== 'html') continue
      for (const f of extractFrames(b.props.html, opts)) {
        const sig = `image|${skeleton(f, opts.parse)}`
        if (seen.has(sig)) continue
        seen.add(sig)
        parts.push({ id: `f${frames++}`, from: t.name, block: createBlock('html', { html: f, label: '图片框' }), kind: 'image', texts: [], photos: 1 })
      }
    }
  }
  for (const type of BUILTIN_PARTS) {
    const b = createBlock(type)
    parts.push({ id: `b:${type}`, from: '内置模块', block: b, kind: BUILTIN_KIND[type], texts: builtinTexts(b), photos: BUILTIN_PHOTOS[type] ?? (type === 'gallery' ? 3 : 0), flexible: type === 'gallery' })
  }
  return parts
}

/**
 * 新推文的主题：以原文片段为主的模板，从片段样式中提取配色与字号，让内置模块（时间轴、表格、相册等）与模板协调；
 * 以内置模块为主的模板沿用收藏时的主题。
 */
export function templateTheme(templates: TemplateLike[], parse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')): { themeId?: string; themeOverrides?: Partial<ThemeTokens> } | undefined {
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
