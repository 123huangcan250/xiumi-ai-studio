// 按文案结构套用模块：标题用对应级别的标题模块，正文用正文段落（或大型容器），照片按指定位置和张数用对应的图片版式。
// 每个标准名称只用一个模块（由用户在模板和收藏组件中选定），只替换文字和照片，不临时生成新版块。
import { cloneBlock, coerceProps, createBlock, newId } from './blocks'
import type { Copy, CopyItem } from './copy'
import { roleDef, rolesForPhotos, type RoleId } from './roles'
import { compileBlock } from './compiler'
import { extractSlots, fillSlots, isPhotoSlot, nestInto, removeBackgroundPhotos, type ImageSlot, type Parse, type SlotValues, type TextSlot } from './slots'
import { renumber } from './templateFill'
import { resolveTheme } from './themes'
import type { Block, Doc, ImageRef, ThemeTokens } from './types'

export interface KitEntry {
  role: RoleId
  block: Block
  /** 来源：模板名或“组件库” */
  from: string
}
export type Kit = Partial<Record<RoleId, KitEntry>>

/** 一组照片放在哪一项后面；layout 为图片版式，'singles' 表示逐张用单图 */
export interface Placement {
  after: string
  photos: number[]
  layout?: RoleId | 'singles'
}

export interface AssembleOptions {
  parse?: Parse
  ratios?: Record<string, number>
  /** 每张照片的图注（用户写的照片描述） */
  captions?: string[]
  theme?: { themeId?: string; themeOverrides?: Partial<ThemeTokens> }
}

const CJK = /[一-鿿]/
const DECOR_NUMBER = /^(SECTION|PART|CHAPTER|NO\.?|Nº|STEP|CH)\s*\d/i
const DECOR_LABEL = /[A-Za-z]{3,}.*[·|｜/]|[·|｜/].*[A-Za-z]{3,}/
const LABEL_LINE = /^([一-鿿]{1,6})\s*([丨|｜:：/])\s*/
const GENERIC_END = /关注|扫码|二维码|长按|感谢|阅读|END|在看|点赞|分享/i
const CREDIT_GROUPS = [['文字', '文案', '文', '撰稿', '供稿'], ['图片', '摄影', '供图', '图'], ['编辑', '排版', '美编', '责编'], ['审核', '校对', '初审', '复审', '终审']]
const sameCredit = (a: string, b: string) => a === b || CREDIT_GROUPS.some((g) => g.includes(a) && g.includes(b))

interface Fill {
  /** 中文标题位依次写入（封面：标题、副标题） */
  titles?: string[]
  number?: number
  /** 同级标题总数（一级标题的“01 / 04”） */
  total?: number
  /** 正文段落：写进第一个正文位，每段复制一份段落样式 */
  body?: string[]
  /** 不跟照片的小字位（引言出处等） */
  notes?: string[]
  photos?: ImageRef[]
  /** 每张照片的图注 */
  captions?: string[]
  groupCaption?: string
  /** 结尾：按“文字：”“图片：”等标签换成新署名 */
  credits?: string[]
}

/** 沿用原图注的前缀（“图｜”“▲图｜”“组图｜”） */
function withPrefix(orig: string, text: string) {
  const p = orig.match(/^([^\s｜|:：]{0,4}[｜|:：])/)?.[1]
  return p && !text.startsWith(p) ? p + text : text
}

/** 署名行（可以一行写几项：“文字｜张三 图片｜李四”）：按标签换成新署名，没有对应署名时只留标签 */
function creditLine(orig: string, credits: string[]): string | null {
  if (!LABEL_LINE.test(orig)) return null
  return orig
    .split(/(\s+)/)
    .map((seg) => {
      const m = seg.match(LABEL_LINE)
      if (!m) return /^\s*$/.test(seg) ? seg : ''
      const c = credits.find((x) => sameCredit(x.match(LABEL_LINE)?.[1] ?? '', m[1]))
      return `${m[1]}${m[2]}${c ? c.replace(LABEL_LINE, '') : ''}`
    })
    .join('')
    .trim()
}

const CREDIT_WORDS = new Set(CREDIT_GROUPS.flat())

function slotValues(block: Block<'html'>, f: Fill, opts: AssembleOptions): { values: SlotValues; placed: number } {
  const slots = extractSlots(block.props.html, opts.parse)
  const photoSlots = slots.filter((s): s is ImageSlot => s.kind === 'image' && isPhotoSlot(s, opts.ratios))
  const photoIds = new Set(photoSlots.map((s) => s.id))
  const n = photoSlots.length
  // 每个图注位跟在第几张照片后面
  const after = new Map<string, number>()
  let k = -1
  for (const s of slots) {
    if (s.kind === 'image' && photoIds.has(s.id)) k++
    else if (s.kind === 'text' && s.role === 'caption') after.set(s.id, k)
  }
  const tied = [...after.entries()].filter(([, i]) => i >= 0)
  const lastCaps = tied.filter(([, i]) => i === n - 1).map(([id]) => id)
  // 多图模块：最后一张照片后的最后一个图注是组图说明；全模块只有这一个图注时也算
  const groupSlot = n > 1 && (lastCaps.length > 1 || tied.length === 1) ? lastCaps.at(-1) : undefined

  const values: SlotValues = {}
  const titles = [...(f.titles ?? [])]
  const notes = [...(f.notes ?? [])]
  let bodyDone = false
  /** 表格式署名（“摄影”一格、名字另一格）：下一格写名字 */
  let creditValue: string | undefined
  for (const s of slots) {
    if (s.kind === 'image') {
      if (!photoIds.has(s.id)) continue
      const i = photoSlots.indexOf(s)
      values[s.id] = f.photos?.[i] ?? ''
      continue
    }
    const t: TextSlot = s
    if (creditValue !== undefined) {
      values[t.id] = creditValue
      creditValue = undefined
      continue
    }
    if (!CJK.test(t.text)) {
      // 英文装饰字保留，只更新其中的序号
      if (f.number !== undefined && (t.role === 'number' || DECOR_NUMBER.test(t.text))) {
        // “SECTION 01 / 04”：同时更新总章数
        const total = f.total
        values[t.id] = total ? renumber(t.text, f.number).replace(/(\d+)(\s*\/\s*)(\d+)/, (_m, a, sep, b) => `${a}${sep}${String(total).padStart(b.length, '0')}`) : renumber(t.text, f.number)
      }
      continue
    }
    if (t.role === 'number') {
      if (f.number !== undefined) values[t.id] = renumber(t.text, f.number)
      continue
    }
    if (f.credits) {
      const c = creditLine(t.text, f.credits)
      const word = t.text.trim()
      if (CREDIT_WORDS.has(word)) {
        const hit = f.credits.find((x) => sameCredit(x.match(LABEL_LINE)?.[1] ?? '', word))
        if (hit) creditValue = hit.replace(LABEL_LINE, '')
      } else if (c !== null) values[t.id] = c
      else if (!(GENERIC_END.test(t.text) || (t.text.length <= 6 && !/[，。！？]/.test(t.text)))) values[t.id] = ''
      continue
    }
    if (t.role === 'body') {
      values[t.id] = !bodyDone && f.body?.length ? f.body.join('\n') : ''
      bodyDone = true
      continue
    }
    const at = after.get(t.id)
    if (t.role === 'caption' && at !== undefined && at >= 0) {
      // 组图说明：有单独指定时用它；模块只有这一个图注位时合并各张照片的描述
      const text = t.id === groupSlot ? f.groupCaption || (tied.length === 1 ? (f.captions ?? []).filter(Boolean).join('；') : '') : f.captions?.[at]
      values[t.id] = text ? withPrefix(t.text, text) : ''
      continue
    }
    const next = titles.shift() ?? (t.role === 'caption' ? notes.shift() : undefined)
    // 正文之前的中英混排短标签（“FIELD NOTES · 实践手记”）是版块的装饰性栏目名，没有新内容时保留
    if (next === undefined && !bodyDone && t.role === 'title' && DECOR_LABEL.test(t.text) && (t.text.match(/[一-鿿]/g)?.length ?? 0) <= 6) continue
    values[t.id] = next ?? ''
  }
  return { values, placed: Math.min(n, f.photos?.length ?? 0) }
}

const htmlBlock = (block: Block<'html'>, html: string): Block => ({ id: newId(), type: 'html', props: { html, label: block.props.label, ...(block.props.source && { source: block.props.source }) } })

function fillHtml(block: Block<'html'>, f: Fill, opts: AssembleOptions): { block: Block; placed: number } {
  const { values, placed } = slotValues(block, f, opts)
  const filled = fillSlots(block.props.html, values, { parse: opts.parse, ratios: opts.ratios })
  return { block: htmlBlock(block, removeBackgroundPhotos(filled, opts.parse).html), placed }
}

const para = (lines: string[]) => createBlock('paragraph', coerceProps('paragraph', { content: lines.join('\n') }))

function fillBuiltin(block: Block, f: Fill): { block: Block; placed: number } {
  const b = cloneBlock(block) as Block
  const p: any = b.props
  const photos = f.photos ?? []
  const body = (f.body ?? []).join('\n')
  let placed = 0
  const take = (n: number) => {
    const list = photos.slice(0, n)
    placed = list.length
    return list
  }
  switch (b.type) {
    case 'heading':
      p.title = f.titles?.[0] ?? ''
      p.subtitle = f.titles?.[1] ?? ''
      if (f.number !== undefined) p.index = String(f.number).padStart(2, '0')
      break
    case 'cover':
      p.title = f.titles?.[0] ?? ''
      p.subtitle = f.titles?.[1] ?? ''
      p.meta = ''
      p.image = take(1)[0]
      break
    case 'paragraph':
      p.content = coerceProps('paragraph', { content: body }).content
      break
    case 'card':
    case 'imageText':
      p.title = f.titles?.[0] ?? ''
      p.content = coerceProps('paragraph', { content: body }).content
      if (b.type === 'imageText') p.image = take(1)[0]
      break
    case 'box':
      p.title = f.titles?.[0] ?? ''
      p.children = body ? [para(f.body!)] : []
      break
    case 'quote':
      p.text = f.body?.[0] ?? ''
      p.source = f.notes?.[0] ?? ''
      break
    case 'image':
    case 'frame':
      p.image = take(1)[0]
      p.caption = f.captions?.[0] ?? ''
      break
    case 'photos':
      p.pics = Array.from({ length: p.count }, (_, i) => ({ ...(photos[i] && { image: photos[i] }), caption: f.captions?.[i] ?? '' }))
      placed = Math.min(p.count, photos.length)
      break
    case 'carousel':
      p.pics = take(30).map((image, i) => ({ image, caption: f.captions?.[i] ?? '' }))
      break
    case 'gallery':
      p.images = take(9)
      p.caption = f.groupCaption ?? ''
      break
    case 'ending':
      if (f.credits?.length) p.author = f.credits.join('\n')
      break
  }
  b.id = newId()
  return { block: b, placed }
}

export function fillModule(block: Block, f: Fill, opts: AssembleOptions = {}): { block: Block; placed: number } {
  return block.type === 'html' ? fillHtml(block, f, opts) : fillBuiltin(block, f)
}

/** 模块能放几张照片 */
export function photoCapacity(block: Block, opts: AssembleOptions = {}): number {
  if (block.type === 'html') return extractSlots(block.props.html, opts.parse).filter((s) => s.kind === 'image' && isPhotoSlot(s, opts.ratios)).length
  if (block.type === 'photos') return block.props.count
  if (block.type === 'carousel') return 30
  if (block.type === 'gallery') return 9
  return ['image', 'frame', 'imageText', 'cover'].includes(block.type) ? 1 : 0
}

/** n 张照片在模块里能用的版式（只返回所选模块里有的） */
export function layoutsFor(kit: Kit, n: number, opts: AssembleOptions = {}): RoleId[] {
  return rolesForPhotos(n).filter((r) => {
    const e = kit[r]
    if (!e) return false
    const cap = photoCapacity(e.block, opts)
    return r === 'carousel' ? cap >= 2 : cap >= Math.min(n, roleDef(r).photos)
  })
}

/** 所选模块里有几级标题（从一级开始连续计） */
export function kitLevels(kit: Kit): number {
  let n = 0
  while (n < 3 && kit[(['h1', 'h2', 'h3'] as RoleId[])[n]]) n++
  return n
}

/** 没指定位置的照片：按章节平均分配，放在每节第一段之后（只有一段时放在节末） */
export function autoPlace(copy: Copy, units: number[][], taken: Placement[] = []): Placement[] {
  if (!units.length) return []
  const top = Math.min(...copy.items.filter((i) => i.kind === 'heading').map((i) => (i as Extract<CopyItem, { kind: 'heading' }>).level), 9)
  const sections: CopyItem[][] = [[]]
  for (const it of copy.items) {
    if (it.kind === 'heading' && it.level === top) sections.push([it])
    else sections[sections.length - 1].push(it)
  }
  const anchors = sections
    .filter((s) => s.length)
    .map((s) => {
      const paras = s.filter((i) => i.kind !== 'heading')
      if (!paras.length) return s[s.length - 1].id
      return paras.length >= 2 ? paras[0].id : paras[paras.length - 1].id
    })
  // 已有指定照片的位置不再重复放
  const busy = new Set(taken.map((p) => p.after))
  const free = anchors.filter((a) => !busy.has(a))
  const targets = free.length ? free : anchors
  return units.map((photos, i) => ({ after: targets[Math.floor((i * targets.length) / units.length)], photos }))
}


type Piece = { lines: string[] } | { block: Block }

/** 把一组内容装进大型容器；容器装不下时（没有正文位）返回逐项排列的模块 */
function wrapContainer(entry: KitEntry, pieces: Piece[], opts: AssembleOptions): Block[] {
  const flat = () => pieces.map((p) => ('lines' in p ? para(p.lines) : p.block))
  const c = entry.block
  if (c.type === 'box') {
    const b = cloneBlock(c)
    b.id = newId()
    b.props.title = ''
    b.props.children = flat().filter((x) => x.type !== 'box')
    return [b]
  }
  if (c.type !== 'html') return flat()
  const theme = resolveTheme({ themeId: opts.theme?.themeId ?? 'minimal-magazine', themeOverrides: opts.theme?.themeOverrides })
  const html = nestInto(
    c.props.html,
    pieces.map((p) => ('lines' in p ? p : { html: p.block.type === 'html' ? p.block.props.html : compileBlock(p.block, theme) })),
    slotValues(c, {}, opts).values,
    { parse: opts.parse, ratios: opts.ratios },
  )
  return html === null ? flat() : [htmlBlock(c, removeBackgroundPhotos(html, opts.parse).html)]
}

/**
 * 生成文档。
 * 顺序：顶部装饰 → 封面标题 → 文案各项（标题、正文、引言，指定位置后插入照片）→ 结尾署名。
 * 正文：有「正文段落」时逐段使用，导语放进「大型容器」；只有「大型容器」时，导语和每个一级章节的内容各装进一个容器。
 */
export function assemble(copy: Copy, kit: Kit, photos: ImageRef[], placements: Placement[], opts: AssembleOptions = {}): { doc: Doc; warnings: string[] } {
  const blocks: Block[] = []
  const warnings = new Set<string>()
  const captions = opts.captions ?? []
  const nestMode = !kit.body && !!kit.container
  let nest: Piece[] | null = nestMode ? [] : null
  const emit = (b: Block) => (nest ? nest.push({ block: b }) : blocks.push(b))
  const closeNest = () => {
    if (!nest) return
    const inner = nest
    nest = null
    if (inner.length) blocks.push(...wrapContainer(kit.container!, inner, opts))
  }
  const put = (role: RoleId, f: Fill, direct = false) => {
    const e = kit[role]
    if (!e) return 0
    const r = fillModule(e.block, f, opts)
    if (direct) blocks.push(r.block)
    else emit(r.block)
    return r.placed
  }

  if (kit.topDecor) blocks.push({ ...cloneBlock(kit.topDecor.block), id: newId() })
  if (kit.cover) put('cover', { titles: [copy.title, copy.subtitle].filter(Boolean), photos: placements.filter((p) => p.after === 'cover').flatMap((p) => p.photos).map((i) => photos[i]) }, true)
  else warnings.add('所选模块里没有「封面标题」，推文开头不放大标题')

  let run: string[] = []
  let intro = true
  const flush = () => {
    if (!run.length) return
    if (nest) nest.push({ lines: run })
    else if (kit.body && kit.container && intro) put('container', { body: run })
    else if (kit.body) put('body', { body: run })
    else {
      blocks.push(para(run))
      warnings.add('所选模块里没有「正文段落」或「大型容器」，正文使用普通段落')
    }
    run = []
  }

  const placePhotos = (p: Placement) => {
    const ids = p.photos.filter((i) => photos[i])
    if (!ids.length) return
    const singles = () => {
      for (const i of ids) {
        if (kit.img1) put('img1', { photos: [photos[i]], captions: [captions[i] ?? ''] })
        else {
          emit(createBlock('image', { image: photos[i], caption: captions[i] ?? '', variant: 'full' }))
          warnings.add('所选模块里没有「单图」，单张照片使用普通图片')
        }
      }
    }
    if (p.layout === 'singles' || ids.length === 1) return singles()
    const layout = p.layout && kit[p.layout] ? p.layout : layoutsFor(kit, ids.length, opts)[0]
    if (!layout) {
      warnings.add(`所选模块里没有能放 ${ids.length} 张照片的版式，已逐张使用单图`)
      return singles()
    }
    const use = ids.slice(0, photoCapacity(kit[layout]!.block, opts))
    const placed = put(layout, { photos: use.map((i) => photos[i]), captions: use.map((i) => captions[i] ?? '') })
    const rest = ids.slice(placed)
    if (rest.length) {
      warnings.add(`有 ${rest.length} 张照片超出「${roleDef(layout).name}」的照片位，已接在后面逐张排列`)
      placePhotos({ after: p.after, photos: rest, layout: 'singles' })
    }
  }
  const after = new Map<string, Placement[]>()
  for (const p of placements) if (p.after !== 'cover') after.set(p.after, [...(after.get(p.after) ?? []), p])
  const counters = [0, 0, 0]
  const chapters = copy.items.filter((i) => i.kind === 'heading' && i.level === 1).length
  let sections = 0

  for (const it of copy.items) {
    if (it.kind === 'heading') {
      flush()
      const lv = Math.min(3, Math.max(1, it.level))
      counters[lv - 1]++
      for (let j = lv; j < 3; j++) counters[j] = 0
      const role = (['h1', 'h2', 'h3'] as RoleId[])[lv - 1]
      if (lv === 1) {
        intro = false
        closeNest()
        if (sections++ > 0 && kit.divider) blocks.push({ ...cloneBlock(kit.divider.block), id: newId() })
      }
      if (kit[role]) put(role, { titles: [it.text], number: counters[lv - 1], ...(lv === 1 && { total: chapters }) }, lv === 1)
      else {
        run.push(`**${it.text}**`)
        warnings.add(`所选模块里没有「${roleDef(role).name}」，这一级标题改为加粗正文`)
      }
      if (lv === 1 && nestMode) nest = []
    } else if (it.kind === 'quote') {
      if (kit.quote) {
        flush()
        put('quote', { body: [`“${it.text}”`], notes: it.source ? [`—— ${it.source}`] : [] })
      } else run.push(`“${it.text}”${it.source ? `——${it.source}` : ''}`)
    } else run.push(it.text)
    const here = after.get(it.id)
    if (here) {
      flush()
      here.forEach(placePhotos)
      after.delete(it.id)
    }
  }
  flush()
  // 位置没找到的照片放在结尾前
  for (const list of after.values()) list.forEach(placePhotos)
  closeNest()

  if (kit.ending) put('ending', { credits: copy.credits }, true)
  else if (copy.credits.length) {
    blocks.push(para(copy.credits))
    warnings.add('所选模块里没有「结尾署名」，署名使用普通段落')
  }

  const used = new Set(placements.flatMap((p) => p.photos))
  const firstPhoto = placements.flatMap((p) => p.photos)[0]
  const now = Date.now()
  return {
    doc: {
      id: newId(),
      title: copy.title,
      author: '',
      digest: (copy.subtitle || copy.items.find((i) => i.kind === 'para')?.text || '').replace(/\*\*/g, '').slice(0, 54),
      themeId: opts.theme?.themeId ?? 'minimal-magazine',
      ...(opts.theme?.themeOverrides && { themeOverrides: opts.theme.themeOverrides }),
      ...(firstPhoto !== undefined && photos[firstPhoto] && { cover: photos[firstPhoto] }),
      blocks,
      createdAt: now,
      updatedAt: now,
    },
    warnings: [...warnings, ...(photos.length > used.size ? [`有 ${photos.length - used.size} 张照片没有安排位置`] : [])],
  }
}
