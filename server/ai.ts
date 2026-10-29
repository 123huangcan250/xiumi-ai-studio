// AI 提供方抽象：OpenAI 兼容接口（DeepSeek / 通义 / Kimi / 智谱 / MiniMax / MiMo / 豆包 / OpenAI / Gemini / Ollama…）或 Anthropic。
// 密钥只在服务端读取；所有输出都要求是 JSON，再由调用方校验。
import { getProfile, type AiProfile } from './settings'

export interface AiStatus {
  enabled: boolean
  provider: string
  model: string
  name: string
  profileId: string
}

export async function aiStatus(profileId?: string): Promise<AiStatus> {
  const p = await getProfile(profileId)
  // 本地模型（Ollama 等）可以不填密钥
  const usable = Boolean(p && p.baseUrl && p.model && (p.apiKey || /localhost|127\.0\.0\.1/.test(p.baseUrl)))
  return { enabled: usable, provider: p?.provider ?? '', model: p?.model ?? '', name: p?.name ?? '', profileId: p?.id ?? '' }
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.search(/[[{]/)
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('AI 没有返回 JSON')
  return JSON.parse(raw.slice(start, end + 1))
}

interface ChatOpts {
  maxTokens?: number
  temperature?: number
  profileId?: string
  /** 直接指定配置（用于“测试连接”） */
  profile?: AiProfile
}

async function readError(res: Response) {
  const text = await res.text()
  try {
    const d = JSON.parse(text)
    return d?.error?.message ?? d?.message ?? text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

export async function chatJson(system: string, user: string, opts: ChatOpts = {}): Promise<any> {
  const p = opts.profile ?? (await getProfile(opts.profileId))
  if (!p || !p.baseUrl || !p.model) throw Object.assign(new Error('尚未配置 AI 模型：请在「AI 模型设置」中添加'), { status: 503 })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180_000)
  try {
    if (p.provider === 'anthropic') {
      const res = await fetch(`${p.baseUrl}/v1/messages`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: p.model,
          max_tokens: opts.maxTokens ?? 8000,
          temperature: opts.temperature ?? 0.4,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })
      if (!res.ok) throw Object.assign(new Error(`AI 请求失败 ${res.status}: ${await readError(res)}`), { status: 502 })
      const data: any = await res.json()
      return extractJson(data.content?.map((c: any) => c.text ?? '').join('') ?? '')
    }
    const send = (json: boolean) =>
      fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
        body: JSON.stringify({
          model: p.model,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 8000,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
    let res = await send(p.jsonMode)
    // 部分服务不支持 response_format：去掉后重试一次
    if (!res.ok && p.jsonMode && res.status === 400) res = await send(false)
    if (!res.ok) throw Object.assign(new Error(`AI 请求失败 ${res.status}: ${await readError(res)}`), { status: 502 })
    const data: any = await res.json()
    return extractJson(data.choices?.[0]?.message?.content ?? '')
  } catch (e: any) {
    if (e.name === 'AbortError') throw Object.assign(new Error('AI 请求超时（180 秒）'), { status: 504 })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export const OUTLINE_SYSTEM = `你是资深的微信公众号主编。把用户提供的文稿整理为结构化大纲，用于自动排版。
严格输出 JSON，结构：
{
  "title": "标题（不超过 30 字）",
  "subtitle": "一句话副标题（不超过 36 字）",
  "kicker": "封面小标签，如 活动回顾 / EVENT REVIEW",
  "meta": "时间地点等元信息，可空",
  "intro": ["导语段落"],
  "sections": [{
    "heading": "章节小标题（不超过 16 字，可根据内容拟写）",
    "paragraphs": ["正文段落，保持原文措辞，可用 **加粗** 标出关键句"],
    "quotes": [{"text": "原文中的直接引语", "source": "说话人"}],
    "timeline": [{"time": "09:00", "title": "环节", "desc": "说明"}],
    "table": {"headers": ["项目","数据"], "rows": [["",""]]} 或 null,
    "people": [{"name":"","role":"","bio":""}],
    "imageRefs": []
  }],
  "highlights": ["带数字的亮点短句，最多 4 条"],
  "ending": {"text": "结尾语", "author": "文字/图片/编辑署名，原文有则照抄", "note": "关注引导语"}
}
规则：不得编造事实、数据、引语或人物；原文没有的字段给空数组。不要删减正文内容，只做结构整理。`

export const DESIGN_SYSTEM = `你是顶级的微信公众号视觉设计师。根据文章结构摘要，设计 3 套风格明显不同、精致耐看的排版方案。
你只做设计决策，不改写正文。严格输出 JSON：
{"designs":[{
  "name": "方案名（≤8字）",
  "concept": "设计理念（≤40字）",
  "palette": {"primary":"#RRGGBB 主色，需能承载白字","accent":"#RRGGBB 点缀色","primarySoft":"#RRGGBB 主色极浅底","text":"#RRGGBB 正文深色","surface":"#RRGGBB 卡片浅底","border":"#RRGGBB 浅边框"},
  "type": {"headingFont":"serif|sans","fontSize":14-17,"h1Size":20-30,"h2Size":16-22,"lineHeight":1.6-2.1,"letterSpacing":0-1.5,"paragraphSpacing":10-28,"blockSpacing":18-40,"radius":0-16,"imageRadius":0-16},
  "styles": {"cover":"hero|band|minimal","heading":"number|bar|pill|underline","quote":"mark|line|center","card":"border|fill|accent","divider":"line|dots|ornament|space"},
  "kicker": "封面小标签（≤12字，可中英）",
  "opening": "quote|card|paragraph",
  "highlights": "card|none",
  "dividers": true|false,
  "sections": [{"layout":"text|imageTop|imageText|cards|galleryLead|quoteLead|timeline","images":0-4,"subtitle":"章节副标题（≤12字，可为英文标签如 PART 01，或留空）"}],
  "closingColumns": 1|2|3
}]}
版式说明：text=正文中插图；imageTop=先大图后文字；imageText=左右图文分栏；cards=段落卡片化；galleryLead=先多图相册；quoteLead=先引语；timeline=先时间轴（仅当该章有时间节点）。
设计原则：
- 三套方案在配色气质、字体（衬线/无衬线）、模块风格、章节节奏上都要拉开差异；同一方案内相邻章节版式要有变化。
- 配色克制高级：主色饱和度适中，正文色接近黑色，浅底足够浅；不要使用纯红纯绿等刺眼颜色。
- sections 数量必须与摘要中的章节数一致，所有章节 images 之和尽量等于图片总数减 1（封面占 1 张）。
- 用户的风格要求优先。`

export const TEMPLATE_SYSTEM = `你是微信公众号排版编辑。用户提供了一篇新推文的文稿（可能只是活动要点）、若干照片，以及一组“模板部件”（拆自用户收藏的推文模板，每个部件保留原有版式）。
你的任务：挑选部件拼出新推文，给每个部件的文字槽位写入新内容，并给图片位置分配照片。你不写 HTML，只输出方案。
部件字段：id；kind（cover 封面 / heading 章节标题 / body 正文 / image 图片 / mixed 图文 / ending 结尾 / decor 装饰）；texts 文字槽位（id、role、max 建议最大字数、tight、sample 模板原文）；images 可放照片的数量。
规则：
- 按阅读顺序输出部件，部件可以重复使用，也可以不用。常见结构：封面 → 导语 → 每个章节（标题 + 正文 + 图片）→ 结尾。优先使用同一个模板（from 相同）的部件，保持风格统一。
- 用到的部件里，role 为 title、body、caption 的槽位都必须写新内容，不能保留模板里旧活动的文字；label 和装饰性文字可以写 null 保留原样；number 写章节序号并沿用 sample 的格式（如 01、PART 2、第三章）；写 "" 表示删掉这一行。
- tight=true 的槽位在 SVG 图形里，字数必须不超过 max；其他标题尽量不超过 max；正文槽位不限长度，可以用 \\n 分段，可以用 **加粗** 标出重点。
- 结尾部件里的署名（文字/图片/编辑等）换成文稿中的署名；文稿没有时只保留“文字：”这类标签。关注引导等固定文字可以保留。
- 照片用编号表示（0 到 N-1），每张最多用一次，尽量全部用上；封面通常用 0 号。给部件分配的照片数应等于它的 images；kind=image 的部件适合放照片，相册内置部件 b:gallery 可放任意张。
- 文稿完整时保留原文措辞，不删减内容；文稿只是要点时，据此扩写成完整推文，但不得编造文稿里没有的人名、数据、引语和具体事实。
- 模板里没有合适部件时（例如时间轴、表格、引语），使用内置部件（id 以 b: 开头，字段名就是槽位 id；b:timeline 的 items 每行写“时间 | 环节 | 说明”，b:table 的 rows 第一行是表头，单元格用 | 分隔）。
输出 JSON：{"title":"推文标题","digest":"摘要（不超过 54 字）","parts":[{"part":"部件 id","text":{"槽位 id":"内容"},"images":[照片编号]}]}`

export const EDIT_SYSTEM =`你是微信公众号排版助手。你只能通过输出“操作列表”修改结构化文档，绝不能输出 HTML。
可用操作：
- {"op":"insert","index":数字,"block":{"type":模块类型,"props":{...}},"reason":"原因"}
- {"op":"update","id":模块id,"props":{只写要修改的字段},"reason":"原因"}
- {"op":"remove","id":模块id,"reason":"原因"}
- {"op":"move","id":模块id,"to":目标位置,"reason":"原因"}
- {"op":"setTheme","themeId":主题id,"reason":"原因"}
- {"op":"setMeta","title":"","digest":"","reason":"原因"}
模块类型与字段：
cover{kicker,title,subtitle,meta,variant:auto|hero|band|minimal}
heading{index,title,subtitle,variant:auto|number|bar|pill|underline}
paragraph{content:"文本，可用 **加粗**，换行分段",align:left|justify|center}
card{title,content:"文本",variant:auto|border|fill|accent}
quote{text,source,variant:auto|mark|line|center}
imageText{title,content:"文本",imagePosition:left|right}（图片字段保持不变）
image{caption,variant:full|framed|rounded}
gallery{columns:1|2|3,caption}
timeline{items:[{time,title,desc}]}
table{headers:[],rows:[[]],caption}
profile{name,role,bio}
divider{variant:auto|line|dots|ornament|space}
ending{text,author,note}
规则：不得编造事实；修改正文时保留原意；操作尽量少而精准。
字段类型：除 columns 为数字 1-3 外，所有字段值都必须是字符串（例如 index 写 "01" 而不是 1）；items、headers、rows 为数组；不要输出 image、images、html 字段。
原文片段（type=html，导入推文的原版式）：只能修改文字，不能插入新的原文片段、不能改结构和样式。上下文里的 slots 列出了它的文字槽位，修改方式：{"op":"update","id":模块id,"slots":{"t0":"新文字","t2":"新文字"},"reason":"原因"}。同一个片段的所有改动合并在一条 update 里；带 max 的槽位在图形里，字数不能超过 max；写 "" 会删掉这一行。
输出 JSON：{"summary":"一句话说明做了什么","ops":[...]}`
