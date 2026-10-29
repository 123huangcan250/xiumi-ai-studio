// 版式配方：Outline + 图片 → 三种结构不同的文档。
// AI 负责理解（输出 Outline），代码负责排版，保证结果始终是合法的文档 JSON。
import { createBlock, newId } from './blocks'
import type { Outline, OutlineSection } from './outline'
import { textToRich } from './richtext'
import type { Block, Doc, ImageRef } from './types'

export interface LayoutRecipe {
  id: string
  name: string
  description: string
  defaultTheme: string
  build: (o: Outline, pool: ImagePool) => Block[]
}

/** 图片分配器：优先使用章节内引用的图片，其余按顺序发放 */
export class ImagePool {
  private left: ImageRef[]
  constructor(images: ImageRef[]) {
    this.left = [...images]
  }
  get size() {
    return this.left.length
  }
  take(n = 1, prefer: string[] = []): ImageRef[] {
    const out: ImageRef[] = []
    for (const name of prefer) {
      if (out.length >= n) break
      const base = name.split('/').pop()
      const i = this.left.findIndex((im) => im.alt === base || im.src.endsWith('/' + base))
      if (i >= 0) out.push(...this.left.splice(i, 1))
    }
    while (out.length < n && this.left.length) out.push(this.left.shift()!)
    return out
  }
  one(prefer: string[] = []): ImageRef | undefined {
    return this.take(1, prefer)[0]
  }
  rest() {
    return this.left.splice(0)
  }
}

const idx = (i: number) => String(i + 1).padStart(2, '0')
const para = (s: string) => createBlock('paragraph', { content: textToRich(s) })

function cover(o: Outline, image: ImageRef | undefined, variant: Block<'cover'>['props']['variant']) {
  return createBlock('cover', { kicker: o.kicker, title: o.title, subtitle: o.subtitle, meta: o.meta, image, variant })
}
function ending(o: Outline) {
  return createBlock('ending', { text: o.ending.text, author: o.ending.author || '文字 / 图片 / 编辑：', note: o.ending.note })
}
function extras(s: OutlineSection, quoteVariant: Block<'quote'>['props']['variant']): Block[] {
  const out: Block[] = []
  if (s.timeline.length) out.push(createBlock('timeline', { items: s.timeline }))
  if (s.table) out.push(createBlock('table', { ...s.table, caption: '' }))
  for (const p of s.people) out.push(createBlock('profile', { ...p }))
  for (const q of s.quotes.slice(0, 2)) out.push(createBlock('quote', { ...q, variant: quoteVariant }))
  return out
}

/** A · 叙事长文：大留白，图文交替，单图穿插 */
const narrative: LayoutRecipe = {
  id: 'narrative',
  name: '叙事长文',
  description: '杂志式长文：极简封面、序号章节、单图穿插、引语点睛',
  defaultTheme: 'minimal-magazine',
  build(o, pool) {
    const blocks: Block[] = [cover(o, pool.one(), 'auto')]
    o.intro.forEach((p) => blocks.push(para(p)))
    const perSection = Math.max(1, Math.floor(pool.size / Math.max(1, o.sections.length)))
    o.sections.forEach((s, i) => {
      blocks.push(createBlock('heading', { index: idx(i), title: s.heading, subtitle: '', variant: 'auto' }))
      const imgs = pool.take(Math.min(perSection, 2), s.imageRefs)
      s.paragraphs.forEach((p, j) => {
        blocks.push(para(p))
        // 每两段正文后穿插一张图
        if (j % 2 === 0 && imgs.length) blocks.push(createBlock('image', { image: imgs.shift(), caption: '', variant: 'full' }))
      })
      imgs.forEach((im) => blocks.push(createBlock('image', { image: im, caption: '', variant: 'full' })))
      blocks.push(...extras(s, 'auto'))
      if (i < o.sections.length - 1) blocks.push(createBlock('divider', { variant: 'auto' }))
    })
    const rest = pool.rest()
    if (rest.length) blocks.push(createBlock('gallery', { images: rest, columns: rest.length === 1 ? 1 : 2, caption: '' }))
    blocks.push(ending(o))
    return blocks
  },
}

/** B · 信息卡片：数据先行，卡片化信息，图文分栏左右交替 */
const cards: LayoutRecipe = {
  id: 'cards',
  name: '信息卡片',
  description: '资讯快读：数据看板、导读卡片、左右交替图文分栏、双列相册',
  defaultTheme: 'tech-blue',
  build(o, pool) {
    const blocks: Block[] = [cover(o, pool.one(), 'hero')]
    if (o.intro.length) blocks.push(createBlock('card', { title: '导读', content: textToRich(o.intro.join('\n')), variant: 'auto' }))
    if (o.highlights.length >= 2) {
      blocks.push(createBlock('card', { title: '活动亮点', content: textToRich(o.highlights.map((h) => `**·** ${h}`).join('\n')), variant: 'accent' }))
    }
    let flip = false
    o.sections.forEach((s, i) => {
      blocks.push(createBlock('heading', { index: idx(i), title: s.heading, subtitle: '', variant: 'auto' }))
      const [first, ...others] = s.paragraphs
      const img = pool.one(s.imageRefs)
      if (first && img) {
        // 长段落拆开：分栏里放前一部分，剩余作为正文
        const cut = first.length > 120 ? first.slice(0, first.indexOf('。', 60) + 1 || 120) : first
        blocks.push(createBlock('imageText', { image: img, title: '', content: textToRich(cut), imagePosition: flip ? 'right' : 'left' }))
        if (cut.length < first.length) blocks.push(para(first.slice(cut.length)))
        flip = !flip
      } else if (first) blocks.push(para(first))
      others.forEach((p, j) => blocks.push(j === others.length - 1 && others.length > 1 ? createBlock('card', { title: '', content: textToRich(p), variant: 'fill' }) : para(p)))
      blocks.push(...extras(s, 'auto'))
      const pair = pool.size >= 4 ? pool.take(2, s.imageRefs) : []
      if (pair.length === 2) blocks.push(createBlock('gallery', { images: pair, columns: 2, caption: '' }))
    })
    const rest = pool.rest()
    if (rest.length) {
      blocks.push(createBlock('heading', { index: '', title: '现场掠影', subtitle: '', variant: 'auto' }))
      blocks.push(createBlock('gallery', { images: rest, columns: rest.length >= 3 ? 2 : 1, caption: '' }))
    }
    blocks.push(ending(o))
    return blocks
  },
}

/** C · 图集故事：图片主导，每章先图后文，结尾九宫格 */
const photo: LayoutRecipe = {
  id: 'photo',
  name: '图集故事',
  description: '照片先行：通栏封面、章节大图 + 三列图集、居中引语、精彩瞬间九宫格',
  defaultTheme: 'warm-humanities',
  build(o, pool) {
    const blocks: Block[] = [cover(o, pool.one(), 'band')]
    // 短导语做成居中引言，长导语仍作正文，避免大段居中文字
    const intro = o.intro.join('')
    if (intro && intro.length <= 90) blocks.push(createBlock('quote', { text: intro, source: '', variant: 'center' }))
    else o.intro.forEach((p) => blocks.push(para(p)))
    const reserve = Math.min(3, Math.max(0, pool.size - o.sections.length * 2))
    o.sections.forEach((s, i) => {
      blocks.push(createBlock('heading', { index: idx(i), title: s.heading, subtitle: '', variant: 'auto' }))
      const budget = pool.size - reserve
      const big = budget > 0 ? pool.one(s.imageRefs) : undefined
      if (big) blocks.push(createBlock('image', { image: big, caption: '', variant: 'rounded' }))
      s.paragraphs.forEach((p) => blocks.push(para(p)))
      blocks.push(...extras(s, 'auto'))
      const n = pool.size - reserve >= 3 && i % 2 === 1 ? 3 : 0
      if (n) blocks.push(createBlock('gallery', { images: pool.take(n), columns: 3, caption: '' }))
      blocks.push(createBlock('divider', { variant: 'space' }))
    })
    const rest = pool.rest()
    if (rest.length) {
      blocks.push(createBlock('heading', { index: '', title: '精彩瞬间', subtitle: 'MOMENTS', variant: 'auto' }))
      blocks.push(createBlock('gallery', { images: rest, columns: rest.length >= 3 ? 3 : rest.length as 1 | 2, caption: '' }))
    }
    blocks.push(ending(o))
    return blocks
  },
}

export const RECIPES: LayoutRecipe[] = [narrative, cards, photo]

export function buildDoc(o: Outline, images: ImageRef[], recipe: LayoutRecipe, themeId?: string): Doc {
  const now = Date.now()
  const blocks = recipe.build(o, new ImagePool(images))
  return {
    id: newId(),
    title: o.title,
    author: '',
    digest: o.subtitle.slice(0, 54),
    themeId: themeId ?? recipe.defaultTheme,
    cover: images[0],
    blocks,
    createdAt: now,
    updatedAt: now,
  }
}

/** 生成三套版式 */
export function buildVariants(o: Outline, images: ImageRef[]): { recipe: LayoutRecipe; doc: Doc }[] {
  return RECIPES.map((recipe) => ({ recipe, doc: buildDoc(o, images, recipe) }))
}
