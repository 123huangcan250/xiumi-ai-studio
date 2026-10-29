import { nanoid } from 'nanoid'
import { textToRich } from './richtext'
import type { Block, BlockPropsMap, BlockType } from './types'

export interface BlockMeta<T extends BlockType = BlockType> {
  type: T
  label: string
  icon: string
  group: '结构' | '文字' | '图片' | '信息'
  defaults: () => BlockPropsMap[T]
}

const META: { [K in BlockType]: BlockMeta<K> } = {
  cover: {
    type: 'cover', label: '封面', icon: '▣', group: '结构',
    defaults: () => ({ kicker: 'EVENT · 活动回顾', title: '在这里输入推文标题', subtitle: '一句话副标题，说明这篇推文讲了什么', meta: '2026 年 10 月', variant: 'auto' }),
  },
  heading: {
    type: 'heading', label: '章节标题', icon: 'H', group: '结构',
    defaults: () => ({ index: '01', title: '章节标题', subtitle: '', variant: 'auto' }),
  },
  paragraph: {
    type: 'paragraph', label: '正文', icon: '¶', group: '文字',
    defaults: () => ({ content: textToRich('在这里输入正文。双击即可直接编辑，支持**加粗**、斜体、列表与高亮。'), align: 'justify' }),
  },
  card: {
    type: 'card', label: '卡片', icon: '▤', group: '文字',
    defaults: () => ({ title: '卡片标题', content: textToRich('用卡片突出一段重点信息，例如活动亮点、注意事项或核心观点。'), variant: 'auto' }),
  },
  quote: {
    type: 'quote', label: '引言', icon: '❝', group: '文字',
    defaults: () => ({ text: '一句值得被记住的话，放在这里。', source: '嘉宾 / 出处', variant: 'auto' }),
  },
  imageText: {
    type: 'imageText', label: '图文分栏', icon: '◧', group: '图片',
    defaults: () => ({ title: '图文标题', content: textToRich('左图右文或左文右图的分栏布局，适合介绍场地、作品或环节。'), imagePosition: 'left' }),
  },
  image: {
    type: 'image', label: '单图', icon: '▢', group: '图片',
    defaults: () => ({ caption: '', variant: 'full' }),
  },
  gallery: {
    type: 'gallery', label: '相册', icon: '▦', group: '图片',
    defaults: () => ({ images: [], columns: 2, caption: '' }),
  },
  timeline: {
    type: 'timeline', label: '时间轴', icon: '⋮', group: '信息',
    defaults: () => ({
      items: [
        { time: '09:00', title: '签到入场', desc: '领取物料与胸牌' },
        { time: '09:30', title: '开幕致辞', desc: '' },
        { time: '10:00', title: '主题分享', desc: '' },
      ],
    }),
  },
  table: {
    type: 'table', label: '数据表', icon: '▥', group: '信息',
    defaults: () => ({ headers: ['项目', '数据'], rows: [['参与人数', '320'], ['覆盖院系', '18']], caption: '' }),
  },
  profile: {
    type: 'profile', label: '人物介绍', icon: '☺', group: '信息',
    defaults: () => ({ name: '姓名', role: '身份 / 职务', bio: '一段简短的人物介绍，说明其经历、研究方向或在本次活动中的角色。' }),
  },
  divider: {
    type: 'divider', label: '分割装饰', icon: '—', group: '结构',
    defaults: () => ({ variant: 'auto' }),
  },
  ending: {
    type: 'ending', label: '结尾署名', icon: '✎', group: '结构',
    defaults: () => ({ text: '感谢阅读', author: '文字 / 图片 / 编辑：', note: '欢迎关注我们，获取更多活动资讯' }),
  },
  html: {
    type: 'html', label: '原文片段', icon: '</>', group: '文字',
    defaults: () => ({
      html: '<section style="padding: 16px 18px; border: 1px dashed #c9c2e8; border-radius: 6px"><p style="margin: 0; color: #666666">原文片段：导入公众号推文时会自动生成，双击可直接修改文字；也可在右侧编辑源码。</p></section>',
      label: '原文片段',
    }),
  },
}

export const BLOCK_TYPES = Object.keys(META) as BlockType[]

export function blockMeta<T extends BlockType>(type: T): BlockMeta<T> {
  return META[type] as unknown as BlockMeta<T>
}

export function newId() {
  return nanoid(10)
}

export function createBlock<T extends BlockType>(type: T, props?: Partial<BlockPropsMap[T]>): Block<T> {
  // 程序内部调用，类型由 TS 保证；外部数据请先经过 coerceProps
  return { id: newId(), type, props: { ...META[type].defaults(), ...(props ?? {}) } } as Block<T>
}

/** 深拷贝并重新分配 id（复制模块 / 套用模板） */
export function cloneBlock<T extends Block>(b: T): T {
  return { ...structuredClone(b), id: newId() }
}

export function isBlockType(t: string): t is BlockType {
  return t in META
}

// ---------- 属性校验：AI 输出与历史数据都要经过这里，保证类型正确 ----------

const ENUMS: Record<string, string[]> = {
  'cover.variant': ['auto', 'hero', 'band', 'minimal'],
  'heading.variant': ['auto', 'number', 'bar', 'pill', 'underline'],
  'card.variant': ['auto', 'border', 'fill', 'accent'],
  'quote.variant': ['auto', 'mark', 'line', 'center'],
  'divider.variant': ['auto', 'line', 'dots', 'ornament', 'space'],
  'image.variant': ['full', 'framed', 'rounded'],
  'paragraph.align': ['left', 'justify', 'center'],
  'imageText.imagePosition': ['left', 'right'],
}
/** 默认值里没有、但允许出现的可选字段 */
const OPTIONAL_IMAGE: BlockType[] = ['cover', 'imageText', 'image', 'profile', 'ending']

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v))
const isRich = (v: any) => v && typeof v === 'object' && v.type === 'doc' && Array.isArray(v.content)
function imageRef(v: any) {
  if (!v || typeof v !== 'object' || typeof v.src !== 'string' || !v.src) return undefined
  return { src: v.src, ...(typeof v.assetId === 'string' && { assetId: v.assetId }), ...(typeof v.alt === 'string' && { alt: v.alt }), ...(Number(v.width) > 0 && { width: Number(v.width) }), ...(Number(v.height) > 0 && { height: Number(v.height) }) }
}

/**
 * 按模块默认值推断的结构强制转换字段类型；未知字段丢弃，非法枚举回退默认值。
 * partial=true 时只返回传入的字段（用于 update）。
 */
export function coerceProps<T extends BlockType>(type: T, raw: unknown, partial = false): Partial<BlockPropsMap[T]> {
  const defaults = META[type].defaults() as Record<string, any>
  const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const out: Record<string, any> = partial ? {} : { ...defaults }
  for (const [k, v] of Object.entries(src)) {
    const d = defaults[k]
    if (k === 'image' && OPTIONAL_IMAGE.includes(type)) {
      const ref = imageRef(v)
      // 非法图片：修改时忽略（保留原图），新建时不设图片
      if (ref) out.image = ref
      else if (!partial) delete out.image
      continue
    }
    if (!(k in defaults)) continue
    const en = ENUMS[`${type}.${k}`]
    if (en) out[k] = en.includes(v as string) ? v : d
    else if (k === 'content') out[k] = isRich(v) ? v : textToRich(str(v))
    else if (k === 'images') out[k] = Array.isArray(v) ? v.map(imageRef).filter(Boolean) : d
    else if (k === 'columns') out[k] = Math.min(3, Math.max(1, Math.round(Number(v)) || 2))
    else if (k === 'items') out[k] = Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').map((x) => ({ time: str(x.time), title: str(x.title), desc: str(x.desc) })) : d
    else if (k === 'headers') out[k] = Array.isArray(v) ? v.map(str) : d
    else if (k === 'rows') out[k] = Array.isArray(v) ? v.filter(Array.isArray).map((r: unknown[]) => r.map(str)) : d
    else if (typeof d === 'string') out[k] = str(v)
    else out[k] = d
  }
  return out as Partial<BlockPropsMap[T]>
}

/** 修复整个文档：过滤未知模块、补齐/纠正字段（加载项目、版本、模板时使用） */
export function normalizeBlocks(blocks: unknown): Block[] {
  if (!Array.isArray(blocks)) return []
  return blocks
    .filter((b) => b && typeof b === 'object' && isBlockType(b.type))
    .map((b) => ({ id: typeof b.id === 'string' && b.id ? b.id : newId(), type: b.type, props: coerceProps(b.type, b.props) }) as Block)
}
