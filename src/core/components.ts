// 组件库：跨模板收藏、检索、复用版块。组件存在 data/components/，只属于本机用户。
// 来自公众号或秀米的内容永远标记为不可分发：秀米用户协议不允许把编辑区素材和风格模板提供给他人，
// 所以这里不提供分享或导出组件库的能力，组件也不得进入 Git 仓库。
import { cloneBlock, isBlockType, normalizeBlocks } from './blocks'
import { fragmentStats, isCarousel, type FragmentStats } from './fragments'
import { toHsl } from './color'
import { clusterHues, collectColors, fixedDecorCount } from './recolor'
import { guardHtml, sanitizeHtml } from './sanitize'
import { skeleton, type Parse } from './slots'
import { guessRole, isRoleId, roleDef, type RoleId } from './roles'
import { guessKind, type PartKind } from './templateFill'
import type { Block, ContentSource, SourceKind } from './types'

export const COMPONENT_SCHEMA = 1
export const MAX_COMPONENT_CHARS = 400_000
export const KIND_LABEL: Record<PartKind, string> = { cover: '封面', heading: '标题', body: '正文', image: '图片', mixed: '图文', ending: '结尾', decor: '装饰' }
export const SOURCE_LABEL: Record<SourceKind, string> = { original: '自己制作', wechat: '公众号文章', xiumi: '秀米', other: '其他' }

export interface ComponentOrigin extends ContentSource {
  /** 取得方式：画布模块、模块里的子结构、模板部件、导入时批量加入 */
  via: 'block' | 'fragment' | 'template' | 'import'
  /** 用户确认对内容有使用权 */
  attested: boolean
  attestedAt: number
  /** 是否可分发给他人：只有内置模块做的组件才可以 */
  redistributable: boolean
}

export interface LibraryComponent {
  id: string
  schema: number
  rev: number
  name: string
  kind: PartKind
  /** 标准名称（一级标题、双图左右……）；旧数据为空，表示未分类 */
  role?: RoleId | ''
  tags: string[]
  block: Block
  /** 结构指纹：文字图片不同但样式相同的组件指纹相同，用于去重 */
  fingerprint: string
  /** 主要颜色，用于按色系筛选 */
  palette: string[]
  /** 不能改色的图片装饰数量 */
  fixedDecor: number
  stats: FragmentStats
  /** 检索用的文字 */
  text: string
  origin: ComponentOrigin
  createdAt: number
  updatedAt: number
  /** 服务端计算：素材已被删除的图片 */
  missing?: string[]
}

export type ComponentDraft = Omit<LibraryComponent, 'id' | 'schema' | 'rev' | 'createdAt' | 'updatedAt' | 'missing'>

const defaultParse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')

function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function fingerprint(block: Block, parse: Parse = defaultParse): string {
  if (block.type !== 'html') return `b:${block.type}:${fnv(JSON.stringify(block.props))}`
  const sk = skeleton(block.props.html, parse)
  return `h:${fnv(sk)}:${sk.length}`
}

/** 生成待保存的组件：统计槽位、颜色和指纹；导入内容必须已确认使用权 */
export function makeDraft(input: { name: string; kind?: PartKind; role?: RoleId; tags?: string[]; block: Block; source: ContentSource; via: ComponentOrigin['via']; attested: boolean }, parse: Parse = defaultParse): ComponentDraft {
  const { block, source } = input
  const role = input.role ?? guessRole(block, { parse, label: input.name })
  const html = block.type === 'html'
  const content = html ? block.props.html : ''
  const colors = html ? clusterHues(collectColors(content, parse)).map((g) => g.rep.hex) : []
  const text = html ? (parse(`<!doctype html><body>${content}`).body.textContent ?? '').replace(/\s+/g, ' ').trim() : JSON.stringify(block.props).replace(/[{}[\]"]/g, ' ')
  return {
    name: input.name.trim() || '未命名组件',
    kind: input.kind ?? (role === 'other' ? guessKind(block, parse) : roleDef(role).kind),
    role,
    // 轮播没有文字可搜，自动带上标签
    tags: normalizeTags([...(input.tags ?? []), ...(html && isCarousel(content, parse) ? ['轮播'] : [])]),
    block,
    fingerprint: fingerprint(block, parse),
    palette: colors.slice(0, 4),
    fixedDecor: html ? fixedDecorCount(content, parse) : 0,
    stats: html ? fragmentStats(content, parse) : { texts: 0, photos: 0, bgPhotos: 0, chars: 0 },
    text: text.slice(0, 600),
    origin: { ...source, via: input.via, attested: input.attested, attestedAt: input.attested ? Date.now() : 0, redistributable: !html },
  }
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((t) => String(t).trim().slice(0, 16)).filter(Boolean))].slice(0, 12)
}

const KINDS: PartKind[] = ['cover', 'heading', 'body', 'image', 'mixed', 'ending', 'decor']
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * 校验外部传入的组件（服务端保存时、读取历史数据时用，不依赖 DOM）。
 * 原文片段必须已确认使用权，并强制不可分发。返回错误信息或规范化后的数据。
 */
export function validateDraft(raw: any): { draft?: ComponentDraft; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: '组件数据无效' }
  if (!isBlockType(raw.block?.type)) return { error: '组件内容无效' }
  const [block] = normalizeBlocks([raw.block])
  if (!block) return { error: '组件内容无效' }
  const html = block.type === 'html'
  if (html) {
    if (block.props.html.length > MAX_COMPONENT_CHARS) return { error: `组件超过 ${MAX_COMPONENT_CHARS.toLocaleString()} 字符，请先拆分` }
    if (!block.props.html.trim()) return { error: '组件内容为空' }
    block.props.html = guardHtml(block.props.html)
  }
  const o = raw.origin && typeof raw.origin === 'object' ? raw.origin : {}
  if (html && o.attested !== true) return { error: '导入内容需要先确认使用权' }
  const kind: SourceKind = ['original', 'wechat', 'xiumi', 'other'].includes(o.kind) ? o.kind : 'other'
  return {
    draft: {
      name: str(raw.name, 40).trim() || '未命名组件',
      kind: isRoleId(raw.role) && raw.role !== 'other' ? roleDef(raw.role).kind : KINDS.includes(raw.kind) ? raw.kind : 'body',
      role: isRoleId(raw.role) ? raw.role : '',
      tags: normalizeTags(raw.tags),
      block,
      fingerprint: str(raw.fingerprint, 80),
      palette: Array.isArray(raw.palette) ? raw.palette.filter((c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4) : [],
      fixedDecor: Math.max(0, Number(raw.fixedDecor) || 0),
      stats: { texts: Number(raw.stats?.texts) || 0, photos: Number(raw.stats?.photos) || 0, bgPhotos: Number(raw.stats?.bgPhotos) || 0, chars: Number(raw.stats?.chars) || 0 },
      text: str(raw.text, 600),
      origin: {
        kind,
        title: str(o.title, 120),
        url: /^https?:\/\//i.test(str(o.url, 500)) ? str(o.url, 500) : '',
        account: str(o.account, 60),
        via: ['block', 'fragment', 'template', 'import'].includes(o.via) ? o.via : 'block',
        attested: o.attested === true,
        attestedAt: o.attested === true ? Number(o.attestedAt) || Date.now() : 0,
        redistributable: !html && o.redistributable !== false,
      },
    },
  }
}

/** 生成可插入文档的模块：重新清洗并分配新 id，同一组件插入多次也不会 id 冲突 */
export function componentBlock(block: Block, parse: Parse = defaultParse): Block {
  const [b] = normalizeBlocks([block])
  const copy = cloneBlock(b)
  if (copy.type === 'html') copy.props.html = sanitizeHtml(copy.props.html, parse)
  return copy
}

export const HUE_FAMILIES = [
  { id: 'red', label: '红', color: '#d9534f' },
  { id: 'orange', label: '橙', color: '#e8913a' },
  { id: 'yellow', label: '黄', color: '#d9b92e' },
  { id: 'green', label: '绿', color: '#57a55a' },
  { id: 'cyan', label: '青', color: '#3aa6a6' },
  { id: 'blue', label: '蓝', color: '#3f7fd1' },
  { id: 'purple', label: '紫', color: '#7f5bc8' },
  { id: 'none', label: '无彩', color: '#9a9a9a' },
] as const
export type HueFamily = (typeof HUE_FAMILIES)[number]['id']

export function hueFamily(hex?: string): HueFamily {
  if (!hex) return 'none'
  const { h, s } = toHsl(hex)
  if (s < 0.12) return 'none'
  if (h < 15 || h >= 335) return 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 165) return 'green'
  if (h < 195) return 'cyan'
  if (h < 255) return 'blue'
  return 'purple'
}

export interface ComponentQuery {
  text?: string
  kind?: PartKind | ''
  role?: RoleId | ''
  hue?: HueFamily | ''
}

/** 按文字（名称、标签、内容、来源）、类别、主色系筛选 */
export function searchComponents<T extends Pick<LibraryComponent, 'name' | 'kind' | 'role' | 'tags' | 'text' | 'palette' | 'origin'>>(list: T[], q: ComponentQuery, roleOf: (c: T) => RoleId | '' = (c) => c.role ?? ''): T[] {
  const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((c) => {
    if (q.kind && c.kind !== q.kind) return false
    if (q.role && roleOf(c) !== q.role) return false
    if (q.hue && hueFamily(c.palette[0]) !== q.hue) return false
    const role = roleOf(c)
    const hay = [c.name, ...c.tags, c.text, c.origin.title, c.origin.account, KIND_LABEL[c.kind], role ? roleDef(role).name : ''].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
