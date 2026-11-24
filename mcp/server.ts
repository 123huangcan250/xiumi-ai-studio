// XIUMI AI Studio 的通用 MCP 服务：让 Claude Code、Codex、Antigravity、DSH 等 MCP 客户端，
// 以及不支持 MCP 的 Agent（如豆包，走 HTTP 接口），都能查看和控制整条推文流程。
//
// 运行方式（需要先启动 XIUMI AI Studio：pnpm dev 或 pnpm start，默认 API 在 127.0.0.1:5174）：
//   stdio（给 MCP 客户端拉起）：  tsx mcp/server.ts
//   HTTP（给其他程序/Agent）：    tsx mcp/server.ts --http [端口，默认 5175]
//
// 设计要点：
//   - 只做薄封装：所有数据读写都经过 XIUMI 自己的 REST 接口，文档修改走与界面相同的 DocOp 校验（validateOp/applyOps）。
//   - 不依赖 MCP SDK（stdio 为换行分隔的 JSON-RPC），避免给项目增加依赖。
//   - 危险/对外动作有闸门：删除需要 confirm:true；推送公众号草稿箱还需要环境变量 XIUMI_MCP_ALLOW_PUBLISH=1。
//   - 不读取、不输出任何 API 密钥或公众号密钥。
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { buildFromDesign, normalizeDesign, outlineBrief } from '../src/core/aiDesign'
import { createBlock, newId } from '../src/core/blocks'
import { compileDoc } from '../src/core/compiler'
import { docToMarkdown } from '../src/core/exporters'
import { applyOps, summarize, validateOp } from '../src/core/ops'
import { normalizeOutline, parseArticle } from '../src/core/outline'
import { allThemes } from '../src/core/themes'
import { flatBlocks } from '../src/core/tree'
import type { Block, Doc, DocOp, ImageRef } from '../src/core/types'

const API = (process.env.XIUMI_API ?? 'http://127.0.0.1:5174').replace(/\/$/, '')
const PUBLISH_ALLOWED = process.env.XIUMI_MCP_ALLOW_PUBLISH === '1'

// ---------------------------------------------------------------- 访问 XIUMI REST 接口
class ApiFailure extends Error {}
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180_000) })
  } catch {
    throw new ApiFailure(`连不上 XIUMI AI Studio（${API}）。请先在项目目录运行 pnpm dev 或 pnpm start；若端口不同，设置环境变量 XIUMI_API。`)
  }
  const text = await res.text()
  let data: any
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new ApiFailure(`${method} ${path} → ${res.status}：${data?.error ?? text.slice(0, 300)}`)
  return data as T
}

const imageRef = (a: any): ImageRef => ({ src: `/media/${a.file}`, assetId: a.id, alt: a.name, width: a.width, height: a.height })
const blockSummary = (b: Block, depth = 0): any => ({
  id: b.id,
  type: b.type,
  text: summarize(b).replace(/\s+/g, ' ').slice(0, 80),
  ...((b.props as any)?.children?.length ? { children: (b.props as any).children.map((c: Block) => blockSummary(c, depth + 1)) } : {}),
})
const docOverview = (d: Doc) => ({
  id: d.id, title: d.title, author: d.author, digest: d.digest, themeId: d.themeId, revision: d.revision, updatedAt: d.updatedAt,
  hasCover: Boolean(d.cover), blockCount: flatBlocks(d.blocks).length, blocks: d.blocks.map((b) => blockSummary(b)),
})
async function save(doc: Doc) {
  const r = await call<{ updatedAt: number; revision?: string }>('PUT', `/api/projects/${doc.id}`, doc)
  return { ...doc, updatedAt: r.updatedAt, revision: r.revision }
}

/** 把图片地址转成最终输出地址：local=本机绝对地址（仅本机预览），embed=base64 内嵌（可离线粘贴） */
async function compile(doc: Doc, images: 'local' | 'embed') {
  // 编译时图片地址会带上裁切参数（?fit=…&w=…），映射表必须按“编译实际请求的地址”来建：
  // 先空跑一遍收集这些地址，再逐个取图，最后正式编译。
  const seen = new Set<string>()
  compileDoc(doc, { mapImage: (u) => { seen.add(u); return u } })
  const map = new Map<string, string>()
  for (const u of seen) {
    if (!u.startsWith('/media/')) continue
    if (images === 'local') { map.set(u, API + u); continue }
    const r = await fetch(API + u)
    if (!r.ok) throw new ApiFailure(`读取图片失败 ${u}：${r.status}`)
    map.set(u, `data:${r.headers.get('content-type') ?? 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`)
  }
  const r = compileDoc(doc, { mapImage: (u) => map.get(u) ?? u })
  // 与界面一致：内嵌图片用于复制粘贴，不受草稿箱接口 20,000 字符上限约束
  if (images === 'embed') r.warnings = r.warnings.filter((w) => !w.includes('20,000'))
  return r
}

const needConfirm = (args: any, what: string) => {
  if (args.confirm !== true) throw new ApiFailure(`${what}需要明确确认：请先向用户说明并取得同意后，再带 confirm:true 重新调用。`)
}

// ---------------------------------------------------------------- 工具定义
type Tool = { name: string; description: string; schema: Record<string, any>; run: (a: any) => Promise<unknown> }
const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string) => ({ type: 'string', description })
const B = (description: string) => ({ type: 'boolean', description })

const tools: Tool[] = [
  // ---- 查看
  { name: 'xiumi_status', description: '查看 XIUMI AI Studio 运行状态：版本和数据目录、AI 模型是否可用（不含密钥）、公众号接口是否已配置。自动化流程开始前先调用它。',
    schema: obj({}), run: async () => {
      const [info, ai, wechat] = await Promise.all([call('GET', '/api/app/info'), call('GET', '/api/ai/status'), call('GET', '/api/wechat/status')])
      return { api: API, info, ai, wechat, publishAllowedByMcp: PUBLISH_ALLOWED }
    } },
  { name: 'xiumi_list_projects', description: '列出所有项目（推文稿件），按最近修改排序。', schema: obj({}), run: () => call('GET', '/api/projects') },
  { name: 'xiumi_get_project', description: '读取一个项目。默认只返回概览（标题、主题、每个模块的 id/类型/文字摘要）；full:true 返回完整文档 JSON（很大）。',
    schema: obj({ id: S('项目 id'), full: B('返回完整文档，默认 false') }, ['id']),
    run: async (a) => { const d = await call<Doc>('GET', `/api/projects/${a.id}`); return a.full ? d : docOverview(d) } },
  { name: 'xiumi_get_block', description: '读取项目中某个模块（含子模块）的完整数据，用于在 apply_ops 前了解它的 props。',
    schema: obj({ project_id: S('项目 id'), block_id: S('模块 id') }, ['project_id', 'block_id']),
    run: async (a) => {
      const d = await call<Doc>('GET', `/api/projects/${a.project_id}`)
      const b = flatBlocks(d.blocks).find((x) => x.id === a.block_id)
      if (!b) throw new ApiFailure(`没有找到模块 ${a.block_id}`)
      return b
    } },
  { name: 'xiumi_list_versions', description: '列出项目的历史版本。', schema: obj({ project_id: S('项目 id') }, ['project_id']), run: (a) => call('GET', `/api/projects/${a.project_id}/versions`) },
  { name: 'xiumi_list_assets', description: '列出素材库中的图片（id、文件名、尺寸）。', schema: obj({}), run: () => call('GET', '/api/assets') },
  { name: 'xiumi_list_themes', description: '列出可用主题（内置 + 自定义）。', schema: obj({}), run: async () => allThemes().map((t) => ({ id: t.id, name: (t as any).name })) },
  { name: 'xiumi_list_templates', description: '列出已收藏的模板。', schema: obj({}), run: () => call('GET', '/api/templates') },
  { name: 'xiumi_list_components', description: '列出组件库中的组件。', schema: obj({}), run: () => call('GET', '/api/components') },

  // ---- 创建与修改
  { name: 'xiumi_upload_asset', description: '把本机的一张图片（jpg/png/webp/gif，≤30MB）上传到素材库，返回素材 id，可用于 xiumi_create_project 的 image_asset_ids。',
    schema: obj({ file_path: S('本机图片的绝对路径') }, ['file_path']),
    run: async (a) => {
      const path = String(a.file_path ?? '')
      if (!/\.(jpe?g|png|webp|gif)$/i.test(path)) throw new ApiFailure('只支持 jpg / png / webp / gif 图片')
      const buf = await readFile(path)
      const fd = new FormData()
      fd.append('files', new Blob([new Uint8Array(buf)]), basename(path))
      let res: Response
      try { res = await fetch(`${API}/api/assets`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) }) } catch { throw new ApiFailure(`连不上 XIUMI AI Studio（${API}）`) }
      const data: any = await res.json().catch(() => null)
      if (!res.ok) throw new ApiFailure(`上传失败 ${res.status}：${data?.error ?? ''}`)
      return data
    } },
  { name: 'xiumi_create_project',
    description: '新建项目。给 text（文稿，纯文本/Markdown）时会自动解析大纲并排版；use_ai:true 时用已配置的 AI 做大纲和风格设计（需要 xiumi_status 显示 ai.enabled），否则用本地规则。不给 text 则建一个空白项目。',
    schema: obj({ title: S('标题，可省略（取文稿标题）'), text: S('文稿'), image_asset_ids: { type: 'array', items: { type: 'string' }, description: '要用的素材 id，按顺序分配到各章节' },
      use_ai: B('用 AI 做大纲和设计，默认 false'), style_hint: S('给 AI 的风格要求，例如“清爽的校园活动风”'), design_index: { type: 'integer', description: 'use_ai 时返回三套方案，选第几套（0-2），默认 0' } }),
    run: async (a) => {
      const assets: any[] = a.image_asset_ids?.length ? (await call<any[]>('GET', '/api/assets')).filter((x) => a.image_asset_ids.includes(x.id)) : []
      const refs = (a.image_asset_ids ?? []).map((id: string) => assets.find((x) => x.id === id)).filter(Boolean).map(imageRef)
      const now = Date.now()
      let doc: Doc
      if (!a.text) {
        doc = { id: newId(), title: a.title ?? '未命名推文', author: '', digest: '', themeId: 'tsinghua-purple', blocks: [createBlock('cover'), createBlock('heading'), createBlock('paragraph'), createBlock('ending')], createdAt: now, updatedAt: now }
      } else {
        const fallback = parseArticle(a.text)
        const outline = a.use_ai ? normalizeOutline(await call('POST', '/api/ai/outline', { text: a.text, imageNames: refs.map((r: ImageRef) => r.alt) }), fallback) : fallback
        const raw = a.use_ai ? (await call('POST', '/api/ai/design', { brief: outlineBrief(outline, refs.length), hint: a.style_hint ?? '' })).designs ?? [] : []
        const i = Math.min(Math.max(a.design_index ?? 0, 0), Math.max(raw.length - 1, 0))
        const design = normalizeDesign(raw[i], outline.sections.length, i)
        doc = { ...buildFromDesign(outline, refs, design), id: newId(), createdAt: now, updatedAt: now }
        if (a.title) doc.title = a.title
      }
      const saved = await save(doc)
      return { created: docOverview(saved) }
    } },
  { name: 'xiumi_apply_ops',
    description: '用与界面/AI 相同的操作集修改文档。ops 为数组，每项之一：{op:"insert",index,block:{id?,type,props}} | {op:"update",id,props} | {op:"remove",id} | {op:"move",id,to} | {op:"setTheme",themeId} | {op:"setMeta",title?,digest?,author?}。每个操作先校验，非法的会被拒绝并说明原因。dry_run:true 只校验和预览不保存。传 revision（取自 get_project）可避免覆盖他人修改。',
    schema: obj({ project_id: S('项目 id'), ops: { type: 'array', items: { type: 'object' }, description: '操作列表' }, dry_run: B('只预览不保存'), revision: S('期望的当前 revision；不一致则拒绝') }, ['project_id', 'ops']),
    run: async (a) => {
      const doc = await call<Doc>('GET', `/api/projects/${a.project_id}`)
      if (a.revision && doc.revision && a.revision !== doc.revision) throw new ApiFailure('项目已被修改（revision 不一致），请重新读取后再试。')
      const ok: DocOp[] = []
      const rejected: { index: number; error: string }[] = []
      let cur = doc
      ;(a.ops as any[]).forEach((raw, index) => {
        const v = validateOp(cur, raw)
        if (v.error || !v.op) rejected.push({ index, error: v.error ?? '无效操作' })
        else { ok.push(v.op); cur = applyOps(cur, [v.op]) }
      })
      const result = { applied: ok.length, rejected, dryRun: Boolean(a.dry_run) }
      if (a.dry_run || !ok.length) return { ...result, preview: docOverview(cur) }
      const saved = await save(cur)
      return { ...result, project: docOverview(saved) }
    } },
  { name: 'xiumi_save_version', description: '给项目存一个历史版本（建议在大改前后调用）。',
    schema: obj({ project_id: S('项目 id'), label: S('版本说明') }, ['project_id']),
    run: async (a) => call('POST', `/api/projects/${a.project_id}/versions`, { doc: await call('GET', `/api/projects/${a.project_id}`), label: a.label ?? 'MCP 保存' }) },
  { name: 'xiumi_delete_project', description: '删除项目（不可恢复）。必须 confirm:true，且应先取得用户同意。',
    schema: obj({ project_id: S('项目 id'), confirm: B('必须为 true') }, ['project_id', 'confirm']),
    run: async (a) => { needConfirm(a, '删除项目'); return call('DELETE', `/api/projects/${a.project_id}`) } },

  // ---- AI 辅助（使用 XIUMI 已配置的模型）
  { name: 'xiumi_ai_edit', description: '让 XIUMI 已配置的 AI 按自然语言指令生成修改建议（DocOp 列表），默认不保存；accept:true 时校验后直接应用。可用 selected_id 把修改限定在某个模块内。',
    schema: obj({ project_id: S('项目 id'), instruction: S('修改指令'), selected_id: S('限定范围的模块 id，可省略'), accept: B('直接应用建议，默认 false') }, ['project_id', 'instruction']),
    run: async (a) => {
      const doc = await call<Doc>('GET', `/api/projects/${a.project_id}`)
      const context = { title: doc.title, themeId: doc.themeId, digest: doc.digest, author: doc.author, blocks: doc.blocks }
      const r = await call<{ ops?: any[]; reply?: string }>('POST', '/api/ai/edit', { context, instruction: a.instruction, selectedId: a.selected_id })
      if (!a.accept) return { proposal: r }
      const ok: DocOp[] = []
      const rejected: { index: number; error?: string }[] = []
      let cur = doc
      ;(r.ops ?? []).forEach((raw, index) => {
        const v = validateOp(cur, raw)
        if (v.op) { ok.push(v.op); cur = applyOps(cur, [v.op]) } else rejected.push({ index, error: v.error })
      })
      return { applied: ok.length, rejected, project: ok.length ? docOverview(await save(cur)) : undefined, reply: r.reply }
    } },

  // ---- 导出
  { name: 'xiumi_compile', description: '把项目编译成公众号 HTML。images: local=图片用本机地址（仅预览）；embed=图片内嵌 base64（可直接复制粘贴到公众号编辑器）。返回 html、字符数和兼容性警告；可用 save_to 写入本机文件。注意：警告来自静态检查，不代表已在微信里验证。',
    schema: obj({ project_id: S('项目 id'), images: { type: 'string', enum: ['local', 'embed'], description: '默认 embed' }, save_to: S('可选：把 HTML 写入这个绝对路径'), include_html: B('返回里是否包含 html 正文，默认 true；写文件时可设 false 节省上下文') }, ['project_id']),
    run: async (a) => {
      const doc = await call<Doc>('GET', `/api/projects/${a.project_id}`)
      const r = await compile(doc, a.images ?? 'embed')
      if (a.save_to) await writeFile(a.save_to, r.html, 'utf8')
      return { title: doc.title, charCount: r.charCount, warnings: r.warnings, savedTo: a.save_to, ...(a.include_html === false ? {} : { html: r.html }) }
    } },
  { name: 'xiumi_export_markdown', description: '把项目导出为 Markdown 文本。', schema: obj({ project_id: S('项目 id') }, ['project_id']),
    run: async (a) => ({ markdown: docToMarkdown(await call<Doc>('GET', `/api/projects/${a.project_id}`)) }) },
  { name: 'xiumi_wechat_push_draft',
    description: '把项目推送到公众号草稿箱（对外发布动作）。默认被禁用：需要用户启动 MCP 时设置 XIUMI_MCP_ALLOW_PUBLISH=1，并且每次调用都必须在取得用户同意后带 confirm:true。需要已配置公众号接口且设置封面。',
    schema: obj({ project_id: S('项目 id'), confirm: B('必须为 true') }, ['project_id', 'confirm']),
    run: async (a) => {
      if (!PUBLISH_ALLOWED) throw new ApiFailure('推送草稿箱已被禁用。如需开放，请由用户在启动 MCP 时设置环境变量 XIUMI_MCP_ALLOW_PUBLISH=1。')
      needConfirm(a, '推送公众号草稿箱')
      const doc = await call<Doc>('GET', `/api/projects/${a.project_id}`)
      if (!doc.cover?.src) throw new ApiFailure('项目还没有封面图，请先设置封面。')
      // 与界面一致：按编译实际请求的图片地址（含裁切参数）上传，再用微信返回的地址重新编译
      const seen = new Set<string>()
      compileDoc(doc, { mapImage: (u) => { seen.add(u); return u } })
      const urls = [...seen].filter((u) => u.startsWith('/media/'))
      const map = urls.length ? await call<Record<string, string>>('POST', '/api/wechat/upload-images', { urls }) : {}
      const html = compileDoc(doc, { mapImage: (u) => map[u] ?? u }).html
      return call('POST', '/api/wechat/draft', { title: doc.title, author: doc.author, digest: doc.digest, html, cover: doc.cover.src, confirm: true })
    } },
]
const byName = new Map(tools.map((t) => [t.name, t]))

async function runTool(name: string, args: any) {
  const t = byName.get(name)
  if (!t) throw new ApiFailure(`未知工具 ${name}`)
  return t.run(args ?? {})
}
const toolResult = async (name: string, args: any) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await runTool(name, args), null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
  }
}

// ---------------------------------------------------------------- JSON-RPC / MCP
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
async function handle(msg: any): Promise<any | null> {
  const { id, method, params } = msg ?? {}
  const reply = (result: unknown) => (id === undefined ? null : { jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } })
  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0], capabilities: { tools: {} },
        serverInfo: { name: 'xiumi-ai-studio', version: '0.1.0' },
        instructions: '控制 XIUMI AI Studio（公众号推文编辑器）。建议流程：xiumi_status → xiumi_create_project 或 xiumi_list_projects → xiumi_get_project 查看 → xiumi_apply_ops/xiumi_ai_edit 修改 → xiumi_compile 导出。删除和推送草稿箱是危险操作，必须先取得用户同意。' })
    case 'ping': return reply({})
    case 'tools/list': return reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) })
    case 'tools/call': return reply(await toolResult(params?.name, params?.arguments))
    case 'resources/list': return reply({ resources: [] })
    case 'prompts/list': return reply({ prompts: [] })
    default:
      return method?.startsWith('notifications/') ? null : fail(-32601, `不支持的方法 ${method}`)
  }
}

// ---------------------------------------------------------------- 传输层
const httpIndex = process.argv.indexOf('--http')
if (httpIndex >= 0) {
  const port = Number(process.argv[httpIndex + 1]) || 5175
  const token = process.env.XIUMI_MCP_TOKEN
  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
  createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
    if (!LOOPBACK.test(String(req.headers.host ?? ''))) return send(403, { error: '只允许本机访问' })
    if (req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.origin))) return send(403, { error: '拒绝来自其他网站的请求' })
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: '缺少或错误的 Bearer token' })
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/tools') return send(200, tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })))
    if (req.method !== 'POST') return send(404, { error: '未知接口。可用：GET /tools、POST /call/<工具名>、POST /mcp' })
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) { size += c.length; if (size > 5_000_000) return send(413, { error: '请求太大' }); chunks.push(c as Buffer) }
    let body: any
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} } catch { return send(400, { error: 'JSON 无法解析' }) }
    if (url.pathname === '/mcp') {
      const out = Array.isArray(body) ? (await Promise.all(body.map(handle))).filter(Boolean) : await handle(body)
      if (out === null || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end() }
      return send(200, out)
    }
    const m = /^\/call\/([\w]+)$/.exec(url.pathname)
    if (m) { const r = await toolResult(m[1], body); return send(r.isError ? 400 : 200, r) }
    return send(404, { error: '未知接口' })
  }).listen(port, '127.0.0.1', () => console.error(`XIUMI MCP（HTTP）已在 http://127.0.0.1:${port} 监听：POST /mcp · POST /call/<工具> · GET /tools`))
} else {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg: any
      try { msg = JSON.parse(line) } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue }
      void Promise.resolve(Array.isArray(msg) ? Promise.all(msg.map(handle)).then((r) => r.filter(Boolean)) : handle(msg)).then((out) => {
        if (out && (!Array.isArray(out) || out.length)) process.stdout.write(JSON.stringify(out) + '\n')
      })
    }
  })
  console.error('XIUMI MCP（stdio）已就绪')
}
