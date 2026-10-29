// AI 设计方案：模型给出配色、字体层级、模块风格与逐章节版式，代码负责校验并生成文档。
// 模型只做“设计决策”，不写 HTML、不改写正文，所以输出始终是合法、可编辑、可粘贴的结构化文档。
import { createBlock, newId } from './blocks'
import { lum, shade, tint, toHex } from './color'
import { ImagePool } from './layouts'
import type { Outline, OutlineSection } from './outline'
import { textToRich } from './richtext'
import { SANS, SERIF } from './themes'
import type { Block, BlockPropsMap, Doc, ImageRef, ThemeTokens } from './types'

export const SECTION_LAYOUTS = ['text', 'imageTop', 'imageText', 'cards', 'galleryLead', 'quoteLead', 'timeline'] as const
export type SectionLayout = (typeof SECTION_LAYOUTS)[number]

type V<K extends keyof BlockPropsMap> = Exclude<BlockPropsMap[K] extends { variant: infer X } ? X : never, 'auto'>
const VARIANTS = {
  cover: ['hero', 'band', 'minimal'] as V<'cover'>[],
  heading: ['number', 'bar', 'pill', 'underline'] as V<'heading'>[],
  quote: ['mark', 'line', 'center'] as V<'quote'>[],
  card: ['border', 'fill', 'accent'] as V<'card'>[],
  divider: ['line', 'dots', 'ornament', 'space'] as V<'divider'>[],
}

export interface DesignSpec {
  name: string
  concept: string
  palette: { primary: string; accent: string; primarySoft: string; text: string; muted: string; surface: string; border: string }
  type: { headingFont: 'serif' | 'sans'; fontSize: number; h1Size: number; h2Size: number; lineHeight: number; letterSpacing: number; paragraphSpacing: number; blockSpacing: number; radius: number; imageRadius: number }
  styles: { cover: V<'cover'>; heading: V<'heading'>; quote: V<'quote'>; card: V<'card'>; divider: V<'divider'> }
  kicker: string
  opening: 'quote' | 'card' | 'paragraph'
  highlights: 'card' | 'none'
  dividers: boolean
  sections: { layout: SectionLayout; images: number; subtitle: string }[]
  closingColumns: 1 | 2 | 3
}

const clamp = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** 校验并修复模型返回的设计方案；任何字段缺失都有合理默认值 */
export function normalizeDesign(raw: any, sectionCount: number, i = 0): DesignSpec {
  const pal = raw?.palette ?? {}
  let primary = toHex(String(pal.primary ?? '')) ?? ['#3B5BDB', '#A0522D', '#0F766E'][i % 3]
  // 主色太浅时白字不可读：压暗
  while (lum(primary) > 0.5) primary = shade(primary, 0.15)
  let accent = toHex(String(pal.accent ?? '')) ?? tint(primary, 0.35)
  if (accent === primary) accent = shade(primary, 0.3)
  let text = toHex(String(pal.text ?? '')) ?? '#2B2B2B'
  if (lum(text) > 0.35) text = '#2B2B2B'
  const soft = toHex(String(pal.primarySoft ?? ''))
  const surface = toHex(String(pal.surface ?? ''))
  const border = toHex(String(pal.border ?? ''))
  const ty = raw?.type ?? {}
  const st = raw?.styles ?? {}
  const fontSize = clamp(ty.fontSize, 14, 17, 15)
  const sections = Array.from({ length: sectionCount }, (_, k) => {
    const s = Array.isArray(raw?.sections) ? raw.sections[k] : undefined
    return {
      layout: pick(s?.layout, SECTION_LAYOUTS, SECTION_LAYOUTS[(k + i) % 4]),
      images: clamp(s?.images, 0, 4, 1),
      subtitle: str(s?.subtitle, 24),
    }
  })
  return {
    name: str(raw?.name, 16) || `方案 ${String.fromCharCode(65 + i)}`,
    concept: str(raw?.concept, 80),
    palette: {
      primary,
      accent,
      text,
      primarySoft: soft && lum(soft) > 0.85 ? soft : tint(primary, 0.9),
      muted: tint(text, 0.45),
      surface: surface && lum(surface) > 0.9 ? surface : tint(primary, 0.95),
      border: border && lum(border) > 0.6 ? border : tint(primary, 0.78),
    },
    type: {
      headingFont: ty.headingFont === 'serif' ? 'serif' : 'sans',
      fontSize,
      h1Size: clamp(ty.h1Size, 20, 30, 24),
      h2Size: clamp(ty.h2Size, fontSize + 1, 22, 18),
      lineHeight: clamp(ty.lineHeight, 1.6, 2.1, 1.8),
      letterSpacing: clamp(ty.letterSpacing, 0, 1.5, 0.5),
      paragraphSpacing: clamp(ty.paragraphSpacing, 10, 28, 18),
      blockSpacing: clamp(ty.blockSpacing, 18, 40, 28),
      radius: clamp(ty.radius, 0, 16, 4),
      imageRadius: clamp(ty.imageRadius ?? ty.radius, 0, 16, 4),
    },
    styles: {
      cover: pick(st.cover, VARIANTS.cover, 'hero'),
      heading: pick(st.heading, VARIANTS.heading, 'number'),
      quote: pick(st.quote, VARIANTS.quote, 'mark'),
      card: pick(st.card, VARIANTS.card, 'fill'),
      divider: pick(st.divider, VARIANTS.divider, 'ornament'),
    },
    kicker: str(raw?.kicker, 20),
    opening: pick(raw?.opening, ['quote', 'card', 'paragraph'] as const, 'paragraph'),
    highlights: pick(raw?.highlights, ['card', 'none'] as const, 'card'),
    dividers: raw?.dividers !== false,
    sections,
    closingColumns: ([1, 2, 3] as const).find((n) => n === Number(raw?.closingColumns)) ?? 3,
  }
}

export function designTheme(d: DesignSpec): Partial<ThemeTokens> {
  return {
    colors: { ...d.palette, bg: '#FFFFFF' },
    fontBody: SANS,
    fontHeading: d.type.headingFont === 'serif' ? SERIF : SANS,
    ...d.type,
    smallSize: 12,
    headingVariant: d.styles.heading,
    quoteVariant: d.styles.quote,
    cardVariant: d.styles.card,
    dividerVariant: d.styles.divider,
    coverVariant: d.styles.cover,
  } as Partial<ThemeTokens>
}

const para = (s: string) => createBlock('paragraph', { content: textToRich(s) })

function imagesBlock(imgs: ImageRef[]): Block[] {
  if (!imgs.length) return []
  if (imgs.length === 1) return [createBlock('image', { image: imgs[0], caption: '', variant: 'full' })]
  return [createBlock('gallery', { images: imgs, columns: imgs.length === 2 || imgs.length === 4 ? 2 : 3, caption: '' })]
}

function sectionBlocks(s: OutlineSection, plan: DesignSpec['sections'][number], pool: ImagePool, flip: boolean): Block[] {
  const out: Block[] = []
  const imgs = pool.take(plan.images, s.imageRefs)
  const paras = [...s.paragraphs]
  let usedTimeline = false
  let usedQuote = false
  switch (plan.layout) {
    case 'imageTop':
      out.push(...imagesBlock(imgs.splice(0)))
      paras.splice(0).forEach((p) => out.push(para(p)))
      break
    case 'imageText': {
      const first = paras.shift()
      const img = imgs.shift()
      if (first && img) {
        const cut = first.length > 110 ? first.slice(0, first.indexOf('。', 50) + 1 || 110) : first
        out.push(createBlock('imageText', { image: img, title: '', content: textToRich(cut), imagePosition: flip ? 'right' : 'left' }))
        if (cut.length < first.length) out.push(para(first.slice(cut.length)))
      } else if (first) out.push(para(first))
      else if (img) imgs.unshift(img)
      paras.splice(0).forEach((p) => out.push(para(p)))
      break
    }
    case 'cards':
      paras.splice(0).forEach((p, j) => out.push(j < 3 && p.length < 260 ? createBlock('card', { title: '', content: textToRich(p), variant: 'auto' }) : para(p)))
      break
    case 'galleryLead':
      if (imgs.length === 1) out.push(...imagesBlock(imgs.splice(0)))
      else out.push(...imagesBlock(imgs.splice(0)))
      paras.splice(0).forEach((p) => out.push(para(p)))
      break
    case 'quoteLead':
      if (s.quotes[0]) {
        out.push(createBlock('quote', { ...s.quotes[0], variant: 'auto' }))
        usedQuote = true
      }
      paras.splice(0).forEach((p) => out.push(para(p)))
      break
    case 'timeline':
      if (s.timeline.length) {
        out.push(createBlock('timeline', { items: s.timeline }))
        usedTimeline = true
      }
      paras.splice(0).forEach((p) => out.push(para(p)))
      break
    default: {
      const [first, ...rest] = paras.splice(0)
      if (first) out.push(para(first))
      // 第一段之后放图，避免连续大段文字
      out.push(...imagesBlock(imgs.splice(0)))
      rest.forEach((p) => out.push(para(p)))
    }
  }
  out.push(...imagesBlock(imgs))
  if (!usedTimeline && s.timeline.length) out.push(createBlock('timeline', { items: s.timeline }))
  if (s.table) out.push(createBlock('table', { ...s.table, caption: '' }))
  for (const p of s.people) out.push(createBlock('profile', { ...p }))
  s.quotes.slice(usedQuote ? 1 : 0, 2).forEach((q) => out.push(createBlock('quote', { ...q, variant: 'auto' })))
  return out
}

export function buildFromDesign(o: Outline, images: ImageRef[], d: DesignSpec): Doc {
  const pool = new ImagePool(images)
  const blocks: Block[] = [
    createBlock('cover', { kicker: d.kicker || o.kicker, title: o.title, subtitle: o.subtitle, meta: o.meta, image: pool.one(), variant: 'auto' }),
  ]
  const intro = o.intro.join('\n')
  if (intro) {
    if (d.opening === 'quote' && intro.length <= 120) blocks.push(createBlock('quote', { text: intro.replace(/\n/g, ''), source: '', variant: 'center' }))
    else if (d.opening === 'card') blocks.push(createBlock('card', { title: '导读', content: textToRich(intro), variant: 'auto' }))
    else o.intro.forEach((p) => blocks.push(para(p)))
  }
  if (d.highlights === 'card' && o.highlights.length >= 2) {
    blocks.push(createBlock('card', { title: '数说亮点', content: textToRich(o.highlights.map((h) => `**·** ${h}`).join('\n')), variant: 'accent' }))
  }
  o.sections.forEach((s, i) => {
    const plan = d.sections[i] ?? { layout: 'text' as const, images: 1, subtitle: '' }
    if (i > 0 && d.dividers) blocks.push(createBlock('divider', { variant: 'auto' }))
    blocks.push(createBlock('heading', { index: String(i + 1).padStart(2, '0'), title: s.heading, subtitle: plan.subtitle, variant: 'auto' }))
    blocks.push(...sectionBlocks(s, plan, pool, i % 2 === 1))
  })
  const rest = pool.rest()
  if (rest.length) {
    blocks.push(createBlock('heading', { index: '', title: '精彩瞬间', subtitle: '', variant: 'auto' }))
    blocks.push(createBlock('gallery', { images: rest, columns: rest.length < d.closingColumns ? (rest.length as 1 | 2) : d.closingColumns, caption: '' }))
  }
  blocks.push(createBlock('ending', { text: o.ending.text, author: o.ending.author || '文字 / 图片 / 编辑：', note: o.ending.note }))
  const now = Date.now()
  return {
    id: newId(),
    title: o.title,
    author: '',
    digest: o.subtitle.slice(0, 54),
    themeId: d.type.headingFont === 'serif' ? 'minimal-magazine' : 'tech-blue',
    themeOverrides: designTheme(d),
    cover: images[0],
    blocks,
    createdAt: now,
    updatedAt: now,
  }
}

/** 发给模型的大纲摘要：只给结构和少量原文，控制 token */
export function outlineBrief(o: Outline, imageCount: number) {
  return {
    title: o.title,
    subtitle: o.subtitle,
    introChars: o.intro.join('').length,
    highlights: o.highlights,
    imageCount,
    sections: o.sections.map((s) => ({
      heading: s.heading,
      paragraphs: s.paragraphs.length,
      chars: s.paragraphs.join('').length,
      firstSentence: (s.paragraphs[0] ?? '').split(/[。！？]/)[0].slice(0, 40),
      timeline: s.timeline.length,
      quotes: s.quotes.length,
      table: Boolean(s.table),
      people: s.people.length,
    })),
  }
}
