// 按照片信息补充文案：文案往往是照片到齐之前按活动流程写的，照片描述里有更具体的人物、地点和细节。
// 这里整理发给 AI 的照片信息，并检查改写结果（标题结构是否变了、用户指定位置的句子是否还在）。
import { findAnchor, normalizeCopyText, parseCopy, type Copy } from './copy'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export interface EnrichPhoto {
  /** 照片编号（从 1 开始，与照片面板一致） */
  no: number
  note: string
  /** 所在组的字母 */
  group?: string
  /** 用户指定放在这句话后面 */
  after?: string
}

export interface EnrichSource {
  images: { id: string }[]
  notes: Record<string, string>
  groups: { id: string; photos: string[] }[]
  anchors: Record<string, string>
}

/** 写了描述的照片；一张都没有时返回空数组，不必询问是否补充文案 */
export function enrichPhotos(s: EnrichSource): EnrichPhoto[] {
  return s.images
    .map((a, i) => {
      const gi = s.groups.findIndex((g) => g.photos.includes(a.id))
      const after = ((gi >= 0 ? s.anchors[s.groups[gi].id] : s.anchors[a.id]) ?? '').trim()
      return { no: i + 1, note: (s.notes[a.id] ?? '').trim(), ...(gi >= 0 && { group: LETTERS[gi] ?? '?' }), ...(after && { after }) }
    })
    .filter((p) => p.note)
}

/** 用户指定的位置句：改写时必须原样保留，否则照片放不到原来的位置 */
export function keepSentences(text: string, anchors: Record<string, string>): string[] {
  const copy = parseCopy(text)
  return [...new Set(Object.values(anchors).map((a) => a.trim()).filter((a) => a && findAnchor(copy, a)))]
}

const headings = (c: Copy) => c.items.filter((i) => i.kind === 'heading').map((i) => (i.kind === 'heading' ? `${i.level}|${i.text}` : ''))
const bodyLength = (s: string) => s.replace(/^#.*$/gm, '').replace(/\s/g, '').length

export interface EnrichCheck {
  /** 标题的文字、级别或顺序有变化 */
  headingsChanged: boolean
  /** 改写后找不到的位置句 */
  lostAnchors: string[]
  /** 正文字数变化 */
  added: number
}

export function checkEnriched(before: string, after: string, keep: string[]): EnrichCheck {
  const a = parseCopy(after)
  return {
    headingsChanged: headings(parseCopy(before)).join('\n') !== headings(a).join('\n'),
    lostAnchors: keep.filter((k) => !findAnchor(a, k)),
    added: bodyLength(after) - bodyLength(before),
  }
}

/** 模型返回的文案：去掉代码块；原文没有用 # 标记时不加（加了会改变整篇的标题识别方式） */
export function enrichedText(raw: unknown, before: string): string {
  const md = normalizeCopyText(raw)
  return before.trim().startsWith('#') ? md : md.replace(/^# /, '')
}

/** 改写说明：模型返回的 changes，只保留短字符串 */
export function enrichChanges(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' ? (raw as { changes?: unknown }).changes : undefined
  return Array.isArray(list) ? list.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 120)) : []
}
