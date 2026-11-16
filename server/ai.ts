import { THEMES } from '../src/core/themes'
import { safeProviderError } from './providerError'
// AI 提供方抽象：OpenAI 兼容接口（DeepSeek / 通义 / Kimi / 智谱 / MiniMax / MiMo / 豆包 / OpenAI / Gemini / Ollama…）或 Anthropic。
// 密钥只在服务端读取；所有输出都要求是 JSON，再由调用方校验。
import { getProfile, type AiProfile } from './settings'
import { fetchModels, type ModelInfo } from './aiModels'
import { PROTECTED_AI_PARAMETERS } from '../src/core/aiParameters'

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
  /** 思考强度：不写 = 用配置里的；'' = 不发送；其他 = 指定（检测支持的强度时用） */
  effort?: string
  /** 服务拒绝思考强度时不要悄悄去掉它，直接报错（检测时需要知道哪些强度被拒绝） */
  keepEffort?: boolean
  /** Capability probes only need an accepted request, not a complete answer. */
  allowTruncated?: boolean
  signal?: AbortSignal
  timeoutMs?: number
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

/** 请求里这些字段不能被“额外参数”改掉 */
const PROTECTED = new Set<string>(PROTECTED_AI_PARAMETERS)

/** 配置里的额外请求参数（JSON 对象），去掉不允许覆盖的字段 */
export function extraBodyOf(p: AiProfile): Record<string, unknown> {
  if (!p.extraBody) return {}
  try {
    const o = JSON.parse(p.extraBody)
    return Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).filter(([k]) => !PROTECTED.has(k)))
  } catch {
    return {}
  }
}

/** 一次请求用到的可选参数。第三方服务支持的参数不一样，被拒绝时按报错信息逐项去掉后重试 */
interface Wire {
  json: boolean
  tokenField: 'max_tokens' | 'max_completion_tokens'
  temperature: boolean
  effort: boolean
  maxTokens: number
}

/** 400 报错里点名了哪个参数，就去掉（或改写）哪个；没有可调整的返回 null */
export function adjustWire(w: Wire, message: string, keepEffort = true): Wire | null {
  const m = message.toLowerCase()
  // Compatible providers may support reasoning_effort with the older token field.
  // Only rewrite on an explicit parameter rejection, not an output-budget error.
  if (w.tokenField === 'max_completion_tokens' && /max_completion_tokens/.test(m) && /unsupported|unknown|unrecognized|unexpected|not supported|not allowed|not permitted/.test(m)) return { ...w, tokenField: 'max_tokens' }
  if (w.tokenField === 'max_tokens' && /max_completion_tokens/.test(m) && /unsupported|not supported|use |must|required|only supports/.test(m)) return { ...w, tokenField: 'max_completion_tokens' }
  if (w.temperature && /temperature/.test(m)) return { ...w, temperature: false }
  if (w.effort && !keepEffort && /reasoning|effort|thinking/.test(m)) return { ...w, effort: false }
  if (w.json && /response_format|json_object|json_schema|json mode|json_mode/.test(m)) return { ...w, json: false }
  // 输出上限过大：报错里常带着模型允许的数字
  if (/max_tokens|max_completion_tokens|output tokens|completion tokens|maximum.*token/.test(m)) {
    const limit = (m.match(/\d{3,7}/g) ?? []).map(Number).filter((n) => n >= 256 && n < w.maxTokens).sort((x, y) => y - x)[0]
    if (limit) return { ...w, maxTokens: limit }
  }
  // 其他 400：老办法，先去掉 JSON 模式再试
  if (w.json) return { ...w, json: false }
  return null
}

async function sendAdaptive(send: (w: Wire) => Promise<Response>, start: Wire, keepEffort: boolean): Promise<Response> {
  let w = start
  const attempted = new Set<string>()
  for (let i = 0; i < 6; i++) {
    attempted.add(JSON.stringify(w))
    const res = await send(w)
    if (res.ok) return res
    const message = await readError(res)
    const next = res.status === 400 || res.status === 422 ? adjustWire(w, message, keepEffort) : null
    if (!next && w.effort && keepEffort && (res.status === 400 || res.status === 422) && /reasoning|effort|thinking/i.test(message) && /unsupported|not supported|not allowed|unknown|unrecognized|invalid|must be|不支持|无效/i.test(message)) {
      throw Object.assign(new Error(`该模型拒绝了配置的思考强度。请在 AI 模型设置中清空“思考强度”后重试，或选择该模型支持的强度。配置未被自动修改。服务返回 ${res.status}: ${message}`), { status: 502 })
    }
    if (!next || attempted.has(JSON.stringify(next))) throw Object.assign(new Error(`AI 请求失败 ${res.status}: ${message}`), { status: 502 })
    w = next
  }
  throw Object.assign(new Error('AI 请求失败：参数被服务反复拒绝'), { status: 502 })
}

/** 调用模型，返回文本。OpenAI 兼容接口或 Anthropic */
export async function chatText(system: string, user: string, opts: ChatOpts = {}): Promise<string> {
  opts.signal?.throwIfAborted()
  const p = opts.profile ?? (await getProfile(opts.profileId))
  opts.signal?.throwIfAborted()
  if (!p || !p.baseUrl || !p.model) throw Object.assign(new Error('尚未配置 AI 模型：请在「AI 模型设置」中添加'), { status: 503 })
  const ctrl = new AbortController()
  const cancel = () => ctrl.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = opts.timeoutMs ?? 180_000
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const effort = opts.effort ?? p.reasoningEffort ?? ''
    const wanted = opts.maxTokens ?? 8000
    const start: Wire = {
      json: p.jsonMode && p.provider !== 'anthropic',
      tokenField: effort && p.provider !== 'anthropic' && new URL(p.baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens',
      temperature: !effort,
      effort: Boolean(effort),
      maxTokens: p.maxOutputTokens ? Math.min(wanted, p.maxOutputTokens) : wanted,
    }
    const extra = extraBodyOf(p)
    if (p.provider === 'anthropic') {
      const res = await sendAdaptive(
        (w) =>
          fetch(`${anthropicBase(p.baseUrl)}/messages`, {
            method: 'POST',
            redirect: 'error',
            signal: ctrl.signal,
            headers: { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: p.model,
              max_tokens: w.maxTokens,
              ...(w.temperature ? { temperature: opts.temperature ?? 0.4 } : {}),
              ...(w.effort ? { output_config: { effort } } : {}),
              system,
              messages: [{ role: 'user', content: user }],
              ...extra,
            }),
          }),
        start,
        Boolean(effort) || Boolean(opts.keepEffort),
      )
      const data: any = await res.json()
      ctrl.signal.throwIfAborted()
      if (!opts.allowTruncated && data.stop_reason === 'max_tokens') throw new Error('AI 已响应，但输出达到 token 上限；请降低思考强度或减少输入后重试')
      return data.content?.map((c: any) => c.text ?? '').join('') ?? ''
    }
    const res = await sendAdaptive(
      (w) =>
        fetch(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          redirect: 'error',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}) },
          body: JSON.stringify({
            model: p.model,
            ...(w.temperature ? { temperature: opts.temperature ?? 0.4 } : {}),
            [w.tokenField]: w.maxTokens,
            ...(w.effort ? { reasoning_effort: effort } : {}),
            ...(w.json ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            ...extra,
          }),
        }),
      start,
      Boolean(effort) || Boolean(opts.keepEffort),
    )
    const data: any = await res.json()
    ctrl.signal.throwIfAborted()
    if (!opts.allowTruncated && data.choices?.[0]?.finish_reason === 'length') throw new Error('AI 已响应，但输出达到 token 上限；请降低思考强度或减少输入后重试')
    return data.choices?.[0]?.message?.content ?? ''
  } catch (e: any) {
    if (opts.signal?.aborted) throw opts.signal.reason
    if (e?.name === 'AbortError') throw Object.assign(new Error(`AI 请求超时（${Math.round(timeout / 1000)} 秒）`), { status: 504 })
    throw safeProviderError(e, p.apiKey)
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

export async function chatJson(system: string, user: string, opts: ChatOpts = {}): Promise<any> {
  return extractJson(await chatText(system, user, opts))
}

export type DiscoveredModel = ModelInfo

function anthropicBase(base: string) {
  return base.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'
}

export async function discoverModels(p: AiProfile): Promise<DiscoveredModel[]> {
  return fetchModels(p)
}

export function testConnection(profile: AiProfile): Promise<any> {
  return chatJson('只输出 JSON。', '请输出 {"ok":true,"model":"你的模型名称"}', {
    // Some models reason by default even without an explicit effort setting.
    profile, maxTokens: 4096, temperature: 0,
  })
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

export const EDIT_SYSTEM =`你是微信公众号排版助手。你只能通过输出“操作列表”修改结构化文档，绝不能输出 HTML。
可用操作：
- {"op":"insert","index":数字,"block":{"type":模块类型,"props":{...}},"reason":"原因"}
- {"op":"update","id":模块id,"props":{只写要修改的字段},"reason":"原因"}
- {"op":"remove","id":模块id,"reason":"原因"}
- {"op":"move","id":模块id,"to":目标位置,"reason":"原因"}
- {"op":"setTheme","themeId":主题id,"reason":"原因"}
- {"op":"setMeta","title":"","digest":"","reason":"原因"}
模块类型与字段：
cover{kicker,title,subtitle,meta,titleAlign:auto|left|center|right,variant:auto|hero|band|minimal}（仅将封面标题居中时，update props.titleAlign 为 center，不改文案、图片或 variant）
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
box{title,label,variant:plate|rule|paper}（大型文本框；框内模块在 props.children 里，各有 id，按 id 单独修改；不要输出 children）
carousel{label,pics:[{caption}],ratio:4:3|3:2|16:9|1:1|3:4,variant:peek|full}（轮播；pics 只能改图注，顺序和数量不变）
frame{caption,label,variant:flag|circuit|ticket}（图片框）
photos{pics:[{caption}],layout:even|feature}（双图 / 三图 / 四图；pics 只能改图注）
规则：不得编造事实；修改正文时保留原意；操作尽量少而精准。
字段类型：除 columns 为数字 1-3 外，所有字段值都必须是字符串（例如 index 写 "01" 而不是 1）；items、headers、rows、pics 为数组；不要输出 image、images、html、children 字段。
原文片段（type=html，导入推文的原版式）：支持文字槽位修改和显式主题适配，不允许输出任意 HTML 或删除内容来假装重做。用户明确要求全文或所选模块统一视觉主题时，必须对范围内每个原文片段输出 {"op":"update","id":模块id,"themeId":目标主题id,"reason":"统一主题配色与文字层级，保留全部文字、图片及结构"}；全文范围可另输出 setTheme，不能只 setTheme 就声称原文片段已改好。主题适配由应用安全计算配色、标题字体和正文排版，可与 slots 合并在同一条 update。它保留布局结构，不会重绘照片、位图内文字或SVG几何，不能承诺这些内容已改变。可用主题：${THEMES.map(t => `${t.id}（${t.name}）`).join("、")}。上下文里的 slots 列出了它的文字槽位，修改方式：{"op":"update","id":模块id,"slots":{"t0":"新文字","t2":"新文字"},"reason":"原因"}。同一个片段的所有改动合并在一条 update 里；带 max 的槽位在图形里，字数不能超过 max；写 "" 会删掉这一行。
用户明确要求重做模块、重排或改变布局时，HTML 的 update 必须同时给 themeId 和 layout:"editorial"（连续编辑式分段）或 layout:"chapters"（按标题分章）。不要仅 setTheme 或仅换颜色字体冒充结构重做。例：{"op":"update","id":"原模块id","themeId":"tsinghua-purple","layout":"chapters","reason":"按章节重新组织全文"}。布局由本地确定性转换生成，保留全部文字、图片、链接及阅读顺序。表格、SVG、背景图片和复杂定位结构以完整原子区块保留；仅其余安全段落重排，必须明确不能承诺所有复杂控件都重新绘制。完全无法安全拆分的片段会拒绝重排，不能宣称已完成。结构重排不改变图片像素内容。
输出 JSON：{"summary":"一句话说明做了什么","ops":[...]}`

export const COPY_SYSTEM = `你是高校公众号的资深主笔，写的活动推文读起来像一个在现场的人写的，而不是机器生成的。根据用户给的活动描述，写一篇完整的推文文案。
严格输出 JSON：{"markdown":"完整文案"}

文案格式（排版程序按标题级别选择标题模块，必须严格遵守）：
- 第一行：# 推文标题（不超过 26 字）
- 第二行：副标题：一句话副标题（不超过 30 字）
- 一级标题用「## 」，二级标题用「### 」，三级标题用「#### 」。最多使用用户指定的级数；不能跳级（二级标题前面必须有一级标题）；下级标题只用在确实需要细分的章节里，且必须和所属的上级章节是同一件事。
- 标题单独一行，不写序号（序号由模板生成），不带标点；一级标题 4–12 字，二级、三级标题 4–14 字。
- 正文每段单独一行，段与段之间空一行，每段 60–180 字。
- 引用某人的原话时单独一行：> 原话 —— 说话人
- 文末另起几行写署名：文字：××、图片：××、编辑：××（描述里没有就写【待补充】）。

结构：开头 1–2 段导语，从现场一个具体的画面、声音或细节写起，不要从“为了……”“近日……”开头；中间按活动进程或主题分成若干一级章节；最后一段收尾，落在具体的人或画面上，不喊口号。

文风（不要机器腔）：
- 用具体的人、动作、场景、数字代替抽象形容：写“二十多个人挤在操作台前”，不写“同学们热情高涨”。但具体内容必须来自活动描述。
- 用组织方或记者的第三人称来写；只有活动描述本身是第一人称时才用“我”。
- 句子长短交错，可以有短句和口语，不要每句都是四字词堆叠。
- 禁止使用：首先、其次、最后、总之、综上所述、不仅……更……、在……的背景下、旨在、助力、赋能、彰显、深刻体会到、收获满满、意义深远、凝聚……力量、让我们……吧、小编、emoji。“此次活动”“本次活动”全文最多出现一次。
- 不要排比，不要每段末尾总结升华，感叹号全文不超过两个。

事实（最重要）：只能写活动描述里有的事实，以及能从中直接推出的场面（例如“报告厅坐满了人”）。不得编造人名、数字、原话、对话、人物的反应和小故事——哪怕是为了让文章更生动。需要但描述里没有的细节，用【待补充：需要什么】占位，让用户自己补，全文不超过 8 处。`

export const PLACE_SYSTEM = `你是公众号排版编辑，负责决定照片放在文章哪一段后面、几张照片用什么版式。只输出 JSON。
输入：段落列表（id、所属章节、内容）；照片单元列表（id、照片编号、用户对照片的描述、版式要求、固定位置 fixedAfter、用户的自然语言要求 request）；各张数可用的版式 layouts。
规则：
- 每张照片必须安排且只安排一次。
- U 开头的单元：layout 不为空时是一组必须放在一起的照片，必须原样作为一个整体输出（photos 与输入完全相同）；layout 为空时是单张照片。把它们放在与描述最相符的段落后面；没有描述的按文章顺序均匀分布，不要都堆在同一处，同一段后面最多两个单元。
- R 开头的单元：必须放在 fixedAfter 段落后面，按 request 的要求决定是拆成几组、每组用什么版式（可以拆成多条输出，每条 after 都写 fixedAfter）。
- layout 只能从 layouts 里对应张数的版式中选，或写“单图”表示逐张排列；单元已给出具体版式时照抄。
输出：{"placements":[{"photos":[照片编号],"after":"段落 id","layout":"版式名称"}]}`

export const ENRICH_SYSTEM = `你是高校公众号的责任编辑。用户先按活动的大致流程写好了推文文案，之后上传了照片、写了照片描述。请把照片描述里的具体信息补进文案，让文字和照片对得上、内容更具体。
严格输出 JSON：{"markdown":"修改后的完整文案","changes":["一句话说明一处改动（写在哪个章节、补了什么）"]}

事实（最重要）：
- 只能使用原文案和照片描述里有的信息（人物、地点、动作、物品、数字、场面）。不得编造两者都没有的人名、数字、原话、对话、人物反应和小故事。
- 照片描述没有提供新信息的，不要为了用上它硬写。
- 原文中的【待补充：…】占位：照片描述正好给出答案的就替换掉，否则原样保留。

怎么改：
- 把信息写进与照片内容对应的段落：在原段落里加入细节，或在它后面新增一段（每段 60–180 字）。照片标了“放在某句话后面”的，信息写在那句话所在的章节。同一组的照片是同一个场面，合在一起写。
- 不要写“如图所示”“照片中”“下图”“左图”这类指代照片的话，照片会排在文字旁边。
- 保持原文的文风、人称和语气；原有段落不要删除或压缩，没有对应照片的内容不要动。
- 不要使用：首先、其次、总之、助力、赋能、彰显、收获满满、意义深远、深刻体会到、emoji。

格式（排版程序按标题选择模块，必须遵守）：
- 所有标题行（# ## ### ####）和“副标题：”行一字不改，不新增、不删除，顺序和级别不变；结尾署名行不变。
- 用户给出的“必须原样保留的句子”一个字都不能改，也不能拆开。
- 标题单独一行，段与段之间空一行，引用格式“> 原话 —— 说话人”保持不变。`
