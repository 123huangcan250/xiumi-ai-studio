// 文案结构：带标题级别的推文文稿（Markdown：# 推文标题，## 一级标题，### 二级标题，#### 三级标题）。
// 套用模板时按这个结构逐项取模块；照片可以指定放在某一句话后面。
import { parseArticle } from './outline'

export type CopyItem =
  | { id: string; kind: 'heading'; level: number; text: string }
  | { id: string; kind: 'para'; text: string }
  | { id: string; kind: 'quote'; text: string; source: string }

export interface Copy {
  title: string
  subtitle: string
  items: CopyItem[]
  /** 结尾署名行，例如“文字：张三” */
  credits: string[]
}

export const LEVEL_NAMES = ['一级标题', '二级标题', '三级标题']
const CREDIT_RE = /^(文字|文\s*字|文案|图片|摄影|供图|编辑|排版|审核|责编|供稿|来源|美编|校对|活动组织|策划|文|图)\s*[：:|丨/｜]/
const SUBTITLE_RE = /^(副标题|导语标题)\s*[：:]\s*/
/** 也接受“【一级标题】xxx”这种写法 */
const LABELED_RE = /^[【[]\s*([一二三])级标题\s*[】\]]\s*/

const stripBold = (s: string) => s.replace(/^\*\*(.+)\*\*$/, '$1').trim()

/** 解析文案。没有用 # 标出标题级别时退回规则识别（短行当作一级标题） */
export function parseCopy(input: string): Copy {
  const text = input.replace(/\r\n?/g, '\n').trim()
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const marked = lines.some((l) => /^#{2,4}\s/.test(l) || LABELED_RE.test(l))
  if (!marked) return fromOutline(text)
  const depths = [...new Set(lines.map((l) => l.match(/^(#{2,4})\s/)?.[1].length).filter((d): d is number => !!d))].sort()
  const copy: Copy = { title: '', subtitle: '', items: [], credits: [] }
  let n = 0
  const id = () => `P${++n}`
  for (const [i, line] of lines.entries()) {
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    const labeled = line.match(LABELED_RE)
    if (h && h[1].length === 1) {
      if (!copy.title) copy.title = stripBold(h[2])
      else copy.items.push({ id: id(), kind: 'heading', level: 1, text: stripBold(h[2]) })
    } else if (h) copy.items.push({ id: id(), kind: 'heading', level: depths.indexOf(h[1].length) + 1, text: stripBold(h[2]) })
    else if (labeled) copy.items.push({ id: id(), kind: 'heading', level: '一二三'.indexOf(labeled[1]) + 1, text: stripBold(line.slice(labeled[0].length)) })
    else if (!copy.title && i === 0) copy.title = line
    else if (SUBTITLE_RE.test(line) && !copy.items.length) copy.subtitle = line.replace(SUBTITLE_RE, '')
    else if (/^>/.test(line)) {
      const t = line.replace(/^>\s*/, '')
      const m = t.match(/^(.*?)\s*[—–]{1,2}\s*(.{1,30})$/)
      copy.items.push({ id: id(), kind: 'quote', text: (m?.[1] ?? t).replace(/^[“"「]|[”"」]$/g, ''), source: m?.[2] ?? '' })
    } else if (CREDIT_RE.test(line) && line.length < 80) copy.credits.push(line)
    else if (!/^!\[[^\]]*\]\([^)]+\)$/.test(line) && !/^-{3,}$/.test(line)) copy.items.push({ id: id(), kind: 'para', text: line.replace(/^[-*]\s+/, '') })
  }
  if (!copy.title) copy.title = '未命名推文'
  return copy
}

/** 没有级别标记的文稿：沿用原有的规则识别，章节标题都算一级 */
function fromOutline(text: string): Copy {
  const o = parseArticle(text)
  const copy: Copy = { title: o.title, subtitle: o.subtitle, items: [], credits: o.ending.author ? o.ending.author.split('\n') : [] }
  let n = 0
  const id = () => `P${++n}`
  for (const p of o.intro) copy.items.push({ id: id(), kind: 'para', text: p })
  for (const s of o.sections) {
    copy.items.push({ id: id(), kind: 'heading', level: 1, text: s.heading })
    for (const q of s.quotes) copy.items.push({ id: id(), kind: 'quote', text: q.text, source: q.source })
    for (const t of s.timeline) copy.items.push({ id: id(), kind: 'para', text: [t.time, t.title, t.desc].filter(Boolean).join(' ') })
    for (const p of s.paragraphs) copy.items.push({ id: id(), kind: 'para', text: p })
    if (s.table) for (const r of [s.table.headers, ...s.table.rows]) copy.items.push({ id: id(), kind: 'para', text: r.join(' | ') })
  }
  return copy
}

/** 文案用到几级标题 */
export function copyLevels(copy: Copy): number {
  return Math.max(0, ...copy.items.map((i) => (i.kind === 'heading' ? i.level : 0)))
}

export function levelCounts(copy: Copy): number[] {
  const out = [0, 0, 0]
  for (const i of copy.items) if (i.kind === 'heading') out[i.level - 1]++
  return out
}

/** 只保留前 max 级标题，更低级别的标题改为加粗的正文行 */
export function limitLevels(copy: Copy, max: number): Copy {
  return { ...copy, items: copy.items.map((i) => (i.kind === 'heading' && i.level > max ? { id: i.id, kind: 'para', text: `**${i.text}**` } : i)) }
}

/** 把解析结果写回 Markdown（压缩级别后回填到文本框） */
export function copyToMarkdown(copy: Copy): string {
  const out = [`# ${copy.title}`]
  if (copy.subtitle) out.push(`副标题：${copy.subtitle}`)
  for (const i of copy.items) {
    if (i.kind === 'heading') out.push(`${'#'.repeat(i.level + 1)} ${i.text}`)
    else if (i.kind === 'quote') out.push(`> ${i.text}${i.source ? ` —— ${i.source}` : ''}`)
    else out.push(i.text)
  }
  out.push(...copy.credits)
  return out.join('\n\n')
}

const norm = (s: string) => s.replace(/\*\*/g, '').replace(/[\s"'“”‘’「」『』]/g, '').replace(/^[，。！？；、,.!?;:：]+|[，。！？；、,.!?;:：]+$/g, '')

/** 找到包含这句话的段落（或标题），返回它的 id；找不到时返回空串 */
export function findAnchor(copy: Copy, sentence: string): string {
  const s = norm(sentence)
  if (!s) return ''
  const hit = copy.items.find((i) => norm(i.text).includes(s))
  return hit?.id ?? ''
}

/** 段落所在的章节标题（用于提示和 AI 安排照片） */
export function sectionOf(copy: Copy, id: string): string {
  let head = '导语'
  for (const i of copy.items) {
    if (i.kind === 'heading') head = i.text
    if (i.id === id) return head
  }
  return head
}

/** 常见的机器腔套话：生成后提示用户，方便改掉 */
export const ROBOT_PHRASES = ['首先', '其次', '综上所述', '总之', '不仅', '在此背景下', '的背景下', '旨在', '助力', '赋能', '彰显', '深刻体会', '收获满满', '意义深远', '凝聚', '让我们', '小编', '圆满落下帷幕', '此次活动', '本次活动', '与此同时', '不难看出', '值得一提的是']

export function robotPhrases(text: string): string[] {
  const hits = ROBOT_PHRASES.filter((p) => text.includes(p))
  // “此次活动 / 本次活动”允许出现一次
  return hits.filter((p) => !['此次活动', '本次活动'].includes(p) || text.split(p).length > 2)
}

/** 规范化模型返回的文案：去掉代码块标记，第一行补上 # 标题 */
export function normalizeCopyText(raw: unknown): string {
  const md = typeof raw === 'object' && raw ? (raw as { markdown?: unknown }).markdown : raw
  let s = String(md ?? '').replace(/\r\n?/g, '\n').trim()
  s = s.replace(/^```(?:markdown|md)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  if (s && !s.startsWith('#')) {
    const [first, ...rest] = s.split('\n')
    s = [`# ${first.trim()}`, ...rest].join('\n')
  }
  return s
}

export interface CopyCheck {
  title: string
  counts: number[]
  chars: number
  /** 需要处理的问题 */
  problems: string[]
  robot: string[]
  /** 【待补充】占位的数量 */
  todo: number
}

/** 检查文案：有没有标题、标题级别是否超出、是否跳级、是否有机器腔套话 */
export function checkCopy(text: string, maxLevels: number): CopyCheck {
  const copy = parseCopy(text)
  const counts = levelCounts(copy)
  const problems: string[] = []
  const used = counts.map((c, i) => (c ? i + 1 : 0)).filter(Boolean)
  if (!/^#\s/m.test(text)) problems.push('第一行需要用「# 」标出推文标题')
  if (!used.length) problems.push('没有标出章节标题：一级标题用「## 」，二级标题用「### 」')
  if (copyLevels(copy) > maxLevels) problems.push(`用了 ${copyLevels(copy)} 级标题，超过设定的 ${maxLevels} 级`)
  // 原文里写的是 ## 和 ####（跳过了 ###）会被当作连续的两级，这里检查的是解析前的井号层级
  const depths = [...new Set(text.split('\n').map((l) => l.match(/^(#{2,4})\s/)?.[1].length).filter(Boolean))] as number[]
  if (depths.length && Math.max(...depths) - Math.min(...depths) + 1 > depths.length) problems.push('标题级别有跳级（例如 ## 后直接用了 ####）')
  const chars = copy.items.filter((i) => i.kind !== 'heading').reduce((n, i) => n + i.text.replace(/\s|\*\*/g, '').length, 0)
  return { title: copy.title, counts, chars, problems, robot: robotPhrases(text), todo: (text.match(/【待补充/g) ?? []).length }
}
