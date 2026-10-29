// 文章结构抽取：Markdown / 纯文本 / Word 文本 → Outline。
// 这是无 AI 时的规则版本；有 AI 时由模型输出同样结构的 JSON。
import { marked } from 'marked'

export interface OutlineSection {
  heading: string
  paragraphs: string[]
  quotes: { text: string; source: string }[]
  timeline: { time: string; title: string; desc: string }[]
  table?: { headers: string[]; rows: string[][] }
  people: { name: string; role: string; bio: string }[]
  /** 原文中出现在本节的图片（markdown 图片语法） */
  imageRefs: string[]
}

export interface Outline {
  title: string
  subtitle: string
  kicker: string
  meta: string
  intro: string[]
  sections: OutlineSection[]
  highlights: string[]
  ending: { text: string; author: string; note: string }
}

const emptySection = (heading: string): OutlineSection => ({ heading, paragraphs: [], quotes: [], timeline: [], people: [], imageRefs: [] })

const HEADING_RE = /^(第[一二三四五六七八九十\d]+[章节部分篇]|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d{1,2}[.、．]\s*\S)/
const TIME_RE = /^(\d{1,2}[:：]\d{2}(\s*[-–~至]\s*\d{1,2}[:：]\d{2})?|\d{1,2}月\d{1,2}日|上午|下午|晚上|Day\s*\d+)/i
// 时间与环节之间的分隔符：空白（含全角空格 U+3000）、竖线、逗号、冒号
const SEP_RE = new RegExp('^[\\s' + String.fromCharCode(0x3000) + '|丨,，、:：]+')
const QUOTE_RE =/^[“"「](.{6,120})[”"」]\s*(?:[—–-]{1,2}\s*(.{1,30}))?$/
const SAID_RE = /^(.{2,12}?)(?:表示|说|谈到|指出|感慨道|分享道)[，：:,]\s*[“"「](.{6,150})[”"」]/
const CREDIT_RE = /^(文字|文\s*字|图片|摄影|编辑|排版|审核|责编|供稿|来源|文|图)[\s：:|丨/]/

/** 判断纯文本中的一行是否像小标题 */
function looksLikeHeading(line: string): boolean {
  if (HEADING_RE.test(line)) return line.length <= 30
  return line.length >= 2 && line.length <= 16 && !/[，。！？；,.!?;：:]$/.test(line) && !/[，。]/.test(line)
}

/** 规范化 AI 返回的大纲：补齐缺失字段、裁剪类型，保证排版配方可直接使用 */
export function normalizeOutline(raw: any, fallback: Outline): Outline {
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v.trim() : d)
  const arr = <T>(v: unknown, map: (x: any) => T | undefined): T[] => (Array.isArray(v) ? v.map(map).filter((x): x is T => x !== undefined) : [])
  const sections = arr(raw?.sections, (s): OutlineSection | undefined => {
    const heading = str(s?.heading)
    if (!heading) return undefined
    const table = s?.table && Array.isArray(s.table.headers) && Array.isArray(s.table.rows) ? { headers: s.table.headers.map(String), rows: s.table.rows.map((r: unknown[]) => (Array.isArray(r) ? r.map(String) : [])) } : undefined
    return {
      heading,
      paragraphs: arr(s.paragraphs, (p) => str(p) || undefined),
      quotes: arr(s.quotes, (q) => (str(q?.text) ? { text: str(q.text), source: str(q.source) } : undefined)),
      timeline: arr(s.timeline, (t) => (str(t?.title) ? { time: str(t.time), title: str(t.title), desc: str(t.desc) } : undefined)),
      table,
      people: arr(s.people, (p) => (str(p?.name) ? { name: str(p.name), role: str(p.role), bio: str(p.bio) } : undefined)),
      imageRefs: arr(s.imageRefs, (x) => str(x) || undefined),
    }
  })
  if (!sections.length) return fallback
  return {
    title: str(raw.title, fallback.title) || fallback.title,
    subtitle: str(raw.subtitle, fallback.subtitle),
    kicker: str(raw.kicker, fallback.kicker) || fallback.kicker,
    meta: str(raw.meta, fallback.meta),
    intro: arr(raw.intro, (p) => str(p) || undefined),
    sections,
    highlights: arr(raw.highlights, (p) => str(p) || undefined).slice(0, 4),
    ending: {
      text: str(raw.ending?.text, fallback.ending.text) || fallback.ending.text,
      author: str(raw.ending?.author, fallback.ending.author) || fallback.ending.author,
      note: str(raw.ending?.note, fallback.ending.note) || fallback.ending.note,
    },
  }
}

export function parseArticle(input: string): Outline {
  const text = input.replace(/\r\n?/g, '\n').trim()
  const isMd = /^#{1,3}\s/m.test(text) || /!\[[^\]]*\]\([^)]+\)/.test(text)
  return isMd ? parseMarkdown(text) : parsePlain(text)
}

function finalize(o: Outline): Outline {
  // 从段落中识别引语、时间安排、人物、署名
  const credits: string[] = []
  const allSections = [{ paragraphs: o.intro } as OutlineSection, ...o.sections]
  for (const s of allSections) {
    const keep: string[] = []
    for (const p of s.paragraphs) {
      const q = p.match(QUOTE_RE)
      const said = p.match(SAID_RE)
      if (CREDIT_RE.test(p) && p.length < 60) {
        credits.push(p)
      } else if (q && s.quotes) {
        s.quotes.push({ text: q[1], source: q[2] ?? '' })
      } else if (TIME_RE.test(p) && p.length < 80 && s.timeline) {
        const time = p.match(TIME_RE)![0]
        const rest = p.slice(time.length).replace(SEP_RE, '')
        const [title, desc] = rest.split(/[，,；;]/, 2)
        s.timeline.push({ time, title: title.trim(), desc: (desc ?? '').trim() })
      } else {
        if (said && s.quotes && said[2].length >= 10) s.quotes.push({ text: said[2], source: said[1] })
        keep.push(p)
      }
    }
    s.paragraphs.splice(0, s.paragraphs.length, ...keep)
  }
  if (credits.length) o.ending.author = credits.join('\n')
  // 时间点太少不算时间轴，退回正文
  for (const s of o.sections) {
    if (s.timeline.length === 1) {
      const t = s.timeline.pop()!
      s.paragraphs.unshift(`${t.time} ${t.title}${t.desc ? '，' + t.desc : ''}`)
    }
  }
  // 亮点：带数字的短句
  // 只取带数量单位的句子（如 “3,200 余人次”），排除日期时间
  const QTY = /\d[\d,.]*\s*(余|多)?\s*(名|人次|人|场|件|张|个|小时|所|支|条|项|家|%)/
  const numeric = o.sections.flatMap((s) => s.paragraphs).flatMap((p) => p.split(/[。！；，]/)).filter((x) => QTY.test(x) && x.length >= 6 && x.length < 40)
  o.highlights = numeric.slice(0, 4).map((x) => x.trim())
  // 标题后紧跟的短句视为副标题，不再重复出现在导语中
  if (!o.subtitle && o.intro.length > 1 && o.intro[0].length <= 50) o.subtitle = o.intro.shift()!
  if (!o.subtitle) o.subtitle = (o.intro[0] ?? o.sections[0]?.paragraphs[0] ?? '').split(/[。！？]/)[0].slice(0, 36)
  o.sections = o.sections.filter((s) => s.paragraphs.length || s.timeline.length || s.quotes.length || s.table || s.imageRefs.length || s.people.length)
  return o
}

function baseOutline(): Outline {
  return { title: '', subtitle: '', kicker: '活动回顾', meta: '', intro: [], sections: [], highlights: [], ending: { text: '感谢阅读', author: '', note: '欢迎关注，获取更多活动资讯' } }
}

function parsePlain(text: string): Outline {
  const o = baseOutline()
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  o.title = (lines.shift() ?? '未命名推文').replace(/^#+\s*/, '')
  let cur: OutlineSection | null = null
  for (const line of lines) {
    if (line.startsWith('|')) {
      // 竖线分隔的表格行：第一行为表头，跳过 --- 分隔行
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
      const sec = cur ?? (o.sections[0] ??= emptySection('正文'))
      if (!sec.table) sec.table = { headers: cells, rows: [] }
      else sec.table.rows.push(cells)
      continue
    }
    if (looksLikeHeading(line) && !TIME_RE.test(line) && !CREDIT_RE.test(line)) {
      cur = emptySection(line.replace(HEADING_RE, (m) => (/^\d/.test(m) ? m.replace(/^\d{1,2}[.、．]\s*/, '') : '')).trim() || line)
      o.sections.push(cur)
    } else if (cur) cur.paragraphs.push(line)
    else o.intro.push(line)
  }
  return finalize(o)
}

function parseMarkdown(text: string): Outline {
  const o = baseOutline()
  const tokens = marked.lexer(text)
  let cur: OutlineSection | null = null
  const push = (p: string) => (cur ? cur.paragraphs.push(p) : o.intro.push(p))
  for (const tk of tokens) {
    if (tk.type === 'heading') {
      if (tk.depth === 1 && !o.title) o.title = tk.text
      else {
        cur = emptySection(tk.text.replace(HEADING_RE, '').trim() || tk.text)
        o.sections.push(cur)
      }
    } else if (tk.type === 'paragraph') {
      const imgs = [...tk.raw.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1])
      if (imgs.length) (cur ?? (o.sections[0] ??= emptySection('正文'))).imageRefs.push(...imgs)
      const rest = tk.raw.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim()
      if (rest) push(rest.replace(/\n/g, ''))
    } else if (tk.type === 'blockquote') {
      const t = tk.text.trim()
      const m = t.match(/^(.*?)(?:\s*[—–-]{2}\s*(.+))?$/s)
      ;(cur ?? (o.sections[0] ??= emptySection('正文'))).quotes.push({ text: (m?.[1] ?? t).replace(/^[“"]|[”"]$/g, ''), source: m?.[2] ?? '' })
    } else if (tk.type === 'list') {
      for (const it of tk.items) push(it.text)
    } else if (tk.type === 'table') {
      const sec = cur ?? (o.sections[0] ??= emptySection('正文'))
      sec.table = { headers: tk.header.map((h: any) => h.text), rows: tk.rows.map((r: any[]) => r.map((c) => c.text)) }
    }
  }
  if (!o.title) o.title = o.intro.shift() ?? '未命名推文'
  return finalize(o)
}
