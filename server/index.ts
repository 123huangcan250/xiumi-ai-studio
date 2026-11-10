import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { cropAsset, deleteAsset, listAssets, saveAsset, variantPath } from './assets'
import { listComponents, removeComponent, saveComponent, updateComponent } from './components'
import { IMAGE_HOST, safeFetch, WECHAT_IMAGE_HOST } from './net'
import { aiStatus, chatJson, discoverModels, testConnection, COPY_SYSTEM, DESIGN_SYSTEM, EDIT_SYSTEM, ENRICH_SYSTEM, OUTLINE_SYSTEM, PLACE_SYSTEM } from './ai'
import { probeEfforts } from './aiModels'
import { editPrompt, scopeEditResult } from './aiEdit'
import { suggestionPrompt, readSuggestion, SUGGESTION_SYSTEM } from './aiSuggestion'
import { isRoleId } from '../src/core/roles'
import { publicAiSettings, resolveDraftProfile, saveAiSettings } from './settings'
import { importFile } from './importer'
import { collection, DIRS, ROOT, safeId } from './store'
import { addDraft, uploadContentImage, uploadCover, validateDraft, wechatStatus } from './wechat'

try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  /* 没有 .env 时使用默认配置 */
}

type Doc = { id: string; title: string; updatedAt: number; [k: string]: any }
type Version = { id: string; projectId: string; label: string; createdAt: number; doc: Doc }

const projects = collection<Doc>(DIRS.projects)
const templates = collection<{ id: string; name: string; blocks: unknown[]; themeId?: string; themeOverrides?: unknown; roles?: Record<string, string>; createdAt: number }>(DIRS.templates)
const themes = collection<{ id: string; name: string }>(DIRS.themes)
const versionsOf = (pid: string) => collection<Version>(join(DIRS.versions, safeId(pid)))

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '20mb' }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 50 } })

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
const MAX_IMPORT_IMAGE = 30 * 1024 * 1024
const fixName = (n: string) => Buffer.from(n, 'latin1').toString('utf8') // multer 按 latin1 解码中文文件名

// ---------- 素材 ----------
app.get('/media/:file', h(async (req, res) => {
  const p = await variantPath(String(req.params.file), req.query.fit as string | undefined, Number(req.query.w) || undefined)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(p)
}))
app.get('/api/assets', h(async (_req, res) => res.json(await listAssets())))
app.post('/api/assets', upload.array('files'), h(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? []
  const out = []
  for (const f of files) out.push(await saveAsset(f.buffer, fixName(f.originalname)))
  res.json(out)
}))
app.post('/api/assets/:id/crop', h(async (req, res) => res.json(await cropAsset(String(req.params.id), req.body))))
app.delete('/api/assets/:id', h(async (req, res) => {
  await deleteAsset(String(req.params.id))
  res.json({ ok: true })
}))

// ---------- 导入 ----------
app.post('/api/import', upload.single('file'), h(async (req, res) => {
  if (!req.file) throw Object.assign(new Error('缺少文件'), { status: 400 })
  res.json(await importFile(req.file.buffer, fixName(req.file.originalname)))
}))

/** 载入仓库内的验收样例（约 2000 字 + 10 张图） */
app.post('/api/samples/load', h(async (_req, res) => {
  const dir = join(ROOT, 'samples')
  if (!existsSync(join(dir, 'activity.txt'))) throw Object.assign(new Error('样例不存在，请先运行 pnpm sample'), { status: 404 })
  const { readFile } = await import('node:fs/promises')
  const assets = []
  for (let i = 1; i <= 10; i++) {
    const name = `photo-${String(i).padStart(2, '0')}.jpg`
    assets.push(await saveAsset(await readFile(join(dir, name)), name))
  }
  res.json({ text: await readFile(join(dir, 'activity.txt'), 'utf8'), assets })
}))

// ---------- 项目与版本 ----------
app.get('/api/projects', h(async (_req, res) => {
  const list = await projects.list()
  res.json(list.sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt, themeId, blocks }) => ({ id, title, updatedAt, themeId, blockCount: blocks?.length ?? 0 })))
}))
app.get('/api/projects/:id', h(async (req, res) => {
  const p = await projects.get(String(req.params.id))
  if (!p) return res.status(404).json({ error: '项目不存在' })
  res.json(p)
}))
app.put('/api/projects/:id', h(async (req, res) => {
  const doc = { ...req.body, id: safeId(String(req.params.id)), updatedAt: Date.now() }
  await projects.put(doc)
  res.json({ ok: true, updatedAt: doc.updatedAt })
}))
app.delete('/api/projects/:id', h(async (req, res) => {
  await projects.remove(String(req.params.id))
  res.json({ ok: true })
}))
app.get('/api/projects/:id/versions', h(async (req, res) => {
  const list = await versionsOf(String(req.params.id)).list()
  res.json(list.sort((a, b) => b.createdAt - a.createdAt).map(({ id, label, createdAt, doc }) => ({ id, label, createdAt, blockCount: doc.blocks?.length ?? 0 })))
}))
app.post('/api/projects/:id/versions', h(async (req, res) => {
  const pid = String(req.params.id)
  const v: Version = { id: `${Date.now()}-${nanoid(4).replace(/[^\w]/g, 'x')}`, projectId: pid, label: String(req.body.label ?? '手动保存'), createdAt: Date.now(), doc: req.body.doc }
  const col = versionsOf(pid)
  await col.put(v)
  // 每个项目最多保留 50 个版本
  const all = (await col.list()).sort((a, b) => b.createdAt - a.createdAt)
  for (const old of all.slice(50)) await col.remove(old.id)
  res.json({ id: v.id, label: v.label, createdAt: v.createdAt })
}))
app.get('/api/projects/:id/versions/:vid', h(async (req, res) => {
  const v = await versionsOf(String(req.params.id)).get(String(req.params.vid))
  if (!v) return res.status(404).json({ error: '版本不存在' })
  res.json(v)
}))

// ---------- 模板收藏与自定义主题 ----------
app.get('/api/templates', h(async (_req, res) => res.json((await templates.list()).sort((a, b) => b.createdAt - a.createdAt))))
app.post('/api/templates', h(async (req, res) => {
  const { themeId, themeOverrides } = req.body
  const t = {
    id: nanoid(10).replace(/[^\w-]/g, '_'),
    name: String(req.body.name ?? '未命名模板'),
    blocks: req.body.blocks ?? [],
    // 记录模板所用主题，套用时新推文沿用同一主题
    ...(typeof themeId === 'string' && { themeId }),
    ...(themeOverrides && typeof themeOverrides === 'object' && { themeOverrides }),
    createdAt: Date.now(),
  }
  await templates.put(t)
  res.json(t)
}))
/** 修改模板名称和模块的标准名称（roles：模块 id → 标准名称 id） */
app.put('/api/templates/:id', h(async (req, res) => {
  const t = await templates.get(String(req.params.id))
  if (!t) return res.status(404).json({ error: '模板不存在' })
  const ids = new Set((t.blocks as { id?: string }[]).map((b) => b.id))
  const roles: Record<string, string> = {}
  if (req.body?.roles && typeof req.body.roles === 'object') {
    for (const [k, v] of Object.entries(req.body.roles)) if (ids.has(k) && isRoleId(v)) roles[k] = v
  }
  const next = { ...t, ...(typeof req.body?.name === 'string' && req.body.name.trim() && { name: req.body.name.trim().slice(0, 60) }), ...(req.body?.roles && { roles }) }
  await templates.put(next)
  res.json(next)
}))
app.delete('/api/templates/:id', h(async (req, res) => {
  await templates.remove(String(req.params.id))
  res.json({ ok: true })
}))
// ---------- 组件库（只存本机，不提供分享或导出） ----------
app.get('/api/components', h(async (_req, res) => res.json(await listComponents())))
app.post('/api/components', h(async (req, res) => res.json(await saveComponent(req.body))))
app.put('/api/components/:id', h(async (req, res) => res.json(await updateComponent(String(req.params.id), req.body))))
app.delete('/api/components/:id', h(async (req, res) => {
  await removeComponent(String(req.params.id))
  res.json({ ok: true })
}))
app.get('/api/themes', h(async (_req, res) => res.json(await themes.list())))
app.post('/api/themes', h(async (req, res) => {
  await themes.put({ ...req.body, id: safeId(String(req.body.id)) })
  res.json({ ok: true })
}))
app.delete('/api/themes/:id', h(async (req, res) => {
  await themes.remove(String(req.params.id))
  res.json({ ok: true })
}))

// ---------- AI ----------
app.get('/api/ai/status', h(async (req, res) => res.json(await aiStatus(req.query.profileId as string | undefined))))
app.get('/api/settings/ai', h(async (_req, res) => res.json(await publicAiSettings())))
app.put('/api/settings/ai', h(async (req, res) => res.json(await saveAiSettings(req.body))))
/** 测试连接：让模型返回一个最小 JSON */
app.post('/api/settings/ai/models', h(async (req, res) => {
  res.json(await discoverModels(await resolveDraftProfile(req.body ?? {})))
}))

app.post('/api/settings/ai/test', h(async (req, res) => {
  const profile = await resolveDraftProfile(req.body ?? {})
  const t0 = Date.now()
  const r = await testConnection(profile)
  res.json({ ok: r?.ok === true, reply: r, ms: Date.now() - t0 })
}))
/** 检测这个模型接受哪些思考强度：每个强度发一条极短的请求，会产生少量调用费用 */
app.post('/api/settings/ai/probe-effort', h(async (req, res) => {
  const profile = await resolveDraftProfile(req.body ?? {})
  if (!profile.baseUrl || !profile.model) throw Object.assign(new Error('请先填写接口地址和模型名称'), { status: 400 })
  res.json(await probeEfforts(profile))
}))
const pid = (req: Request) => (typeof req.body?.profileId === 'string' ? req.body.profileId : undefined)
app.post('/api/ai/outline', h(async (req, res) => {
  const text = String(req.body.text ?? '').slice(0, 30000)
  const imageNames: string[] = req.body.imageNames ?? []
  const imageNotes: string[] = Array.isArray(req.body.imageNotes) ? req.body.imageNotes.map(String) : []
  const images = imageNames.map((n, i) => (imageNotes[i]?.trim() ? `${n}（${imageNotes[i].trim().slice(0, 100)}）` : n))
  const user = `文稿如下：

${text}

可用图片（括号内是用户对照片的描述，按描述把照片归到对应章节；imageRefs 只填文件名，可留空）：${images.join('、') || '无'}`
  res.json(await chatJson(OUTLINE_SYSTEM, user, { maxTokens: 8000, profileId: pid(req) }))
}))
app.post('/api/ai/design', h(async (req, res) => {
  const hint = String(req.body.hint ?? '').slice(0, 500)
  const user = `文章结构摘要：
${JSON.stringify(req.body.brief)}

用户的风格要求：${hint || '无，自行判断最适合该内容的风格'}`
  res.json(await chatJson(DESIGN_SYSTEM, user, { maxTokens: 6000, temperature: 0.8, profileId: pid(req) }))
}))
app.post('/api/ai/copywrite', h(async (req, res) => {
  const b = req.body ?? {}
  const levels = Math.min(3, Math.max(1, Math.round(Number(b.levels)) || 2))
  const names = ['一级标题（##）', '二级标题（###）', '三级标题（####）'].slice(0, levels).join('、')
  const previous = String(b.previous ?? '').slice(0, 12000)
  const revise = String(b.revise ?? '').slice(0, 800)
  const user = `活动描述：
${String(b.brief ?? '').slice(0, 6000)}

文风：${String(b.style ?? '').slice(0, 200) || '自然真实的活动通讯'}
篇幅：正文约 ${String(b.length ?? '1500–2000')} 字
标题级别：使用 ${levels} 级标题：${names}
补充要求：${String(b.extra ?? '').slice(0, 500) || '无'}${previous ? `

上一版文案：
${previous}

修改意见：${revise || '换一种写法重新写，保留事实'}
请在上一版基础上按修改意见改写，格式要求不变，输出完整文案。` : ''}`
  res.json(await chatJson(COPY_SYSTEM, user, { maxTokens: 6000, temperature: 0.85, profileId: pid(req) }))
}))
app.post('/api/ai/enrich-copy', h(async (req, res) => {
  const b = req.body ?? {}
  const photos: { no?: unknown; note?: unknown; group?: unknown; after?: unknown }[] = Array.isArray(b.photos) ? b.photos.slice(0, 60) : []
  const lines = photos
    .map((p) => {
      const tags = [p.group && `组 ${String(p.group).slice(0, 2)}`, p.after && `放在「${String(p.after).slice(0, 80)}」后面`].filter(Boolean).join('，')
      return `照片 ${Number(p.no) || '?'}${tags ? `（${tags}）` : ''}：${String(p.note ?? '').slice(0, 300)}`
    })
    .filter((l) => !l.endsWith('：'))
  const keep: string[] = Array.isArray(b.keep) ? b.keep.map((s: unknown) => String(s).slice(0, 200)).slice(0, 30) : []
  if (!lines.length) throw Object.assign(new Error('没有照片描述，无需补充'), { status: 400 })
  const user = `原文案：
${String(b.text ?? '').slice(0, 15000)}

照片描述（按照片编号）：
${lines.join('\n')}

必须原样保留的句子：
${keep.map((k) => `- ${k}`).join('\n') || '无'}`
  res.json(await chatJson(ENRICH_SYSTEM, user, { maxTokens: 8000, temperature: 0.5, profileId: pid(req) }))
}))
app.post('/api/ai/place-photos', h(async (req, res) => {
  const b = req.body ?? {}
  const user = `段落：
${JSON.stringify(b.items ?? []).slice(0, 30000)}

照片单元：
${JSON.stringify(b.units ?? []).slice(0, 8000)}

可用版式（按照片张数）：
${JSON.stringify(b.layouts ?? {})}`
  res.json(await chatJson(PLACE_SYSTEM, user, { maxTokens: 3000, temperature: 0.3, profileId: pid(req) }))
}))
app.post('/api/ai/suggest-instruction', h(async (req, res) => {
  const { context, selectedId } = req.body
  if (selectedId !== undefined && (typeof selectedId !== 'string' || !selectedId)) {
    throw Object.assign(new Error('无效的选中模块'), { status: 400 })
  }
  const prompt = suggestionPrompt(context, selectedId)
  res.json(readSuggestion(await chatJson(SUGGESTION_SYSTEM, prompt, { maxTokens: 2000, profileId: pid(req) })))
}))
app.post('/api/ai/edit', h(async (req, res) => {
  const { context, instruction } = req.body
  const selectedId = req.body.selectedId ?? context?.focus?.id
  if (selectedId !== undefined && (typeof selectedId !== 'string' || !selectedId)) {
    throw Object.assign(new Error('无效的选中模块'), { status: 400 })
  }
  const user = editPrompt(context, instruction, selectedId)
  res.json(scopeEditResult(await chatJson(EDIT_SYSTEM, user, { maxTokens: 6000, profileId: pid(req) }), selectedId))
}))

// ---------- 文章抓取（导入公众号推文 / 参考风格） ----------
async function fetchPage(raw: string) {
  const r = await safeFetch(raw, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9' },
    maxRedirects: 5,
    maxBytes: 5_000_000,
  })
  if (!r.ok) throw Object.assign(new Error(`抓取失败 HTTP ${r.status}`), { status: 502 })
  return r.text()
}
app.post('/api/article/fetch', h(async (req, res) => res.json({ html: await fetchPage(String(req.body.url)) })))
app.post('/api/reference/fetch', h(async (req, res) => res.json({ html: await fetchPage(String(req.body.url)) })))
/** 编辑器显示微信背景图用：只读转发，只放行微信图床，不保存 */
app.get('/api/wx-image', h(async (req, res) => {
  const r = await safeFetch(String(req.query.u ?? ''), { headers: { 'user-agent': 'Mozilla/5.0' }, allowHost: (host) => WECHAT_IMAGE_HOST.test(host), maxBytes: MAX_IMPORT_IMAGE }).catch(() => null)
  if (!r?.ok) return res.status(502).end()
  res.setHeader('Content-Type', r.headers.get('content-type') ?? 'image/jpeg')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(Buffer.from(await r.arrayBuffer()))
}))
/** 把导入内容里的图片下载到素材库（仅限微信和秀米图床，重定向目标同样检查） */
app.post('/api/assets/fetch', h(async (req, res) => {
  const urls: string[] = (req.body.urls ?? []).slice(0, 80)
  const out: Record<string, unknown> = {}
  const queue = [...new Set(urls)]
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        const r = await safeFetch(u, { headers: { 'user-agent': 'Mozilla/5.0' }, allowHost: (host) => IMAGE_HOST.test(host), maxBytes: MAX_IMPORT_IMAGE })
        if (!r.ok) continue
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > MAX_IMPORT_IMAGE) continue
        const name = `wx-${new URL(u).pathname.split('/').filter(Boolean).slice(-2, -1)[0]?.slice(-10) ?? 'img'}.jpg`
        out[u] = await saveAsset(buf, name)
      } catch {
        /* 单张失败不影响其他图片 */
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  res.json(out)
}))

// ---------- 微信公众号 ----------
app.get('/api/wechat/status', (_req, res) => {
  res.json(wechatStatus())
})
/** 把正文中的本地图片上传到微信，返回 本地地址 → mmbiz 地址 映射 */
app.post('/api/wechat/upload-images', h(async (req, res) => {
  const urls: string[] = req.body.urls ?? []
  const map: Record<string, string> = {}
  for (const u of urls) {
    const m = u.match(/^\/media\/([\w-]+\.(?:jpg|png))(?:\?(.*))?$/)
    if (!m) continue
    const q = new URLSearchParams(m[2] ?? '')
    const p = await variantPath(m[1], q.get('fit') ?? undefined, Number(q.get('w')) || undefined)
    map[u] = await uploadContentImage(u, p)
  }
  res.json(map)
}))
app.post('/api/wechat/draft', h(async (req, res) => {
  const { title, author, digest, html, cover, confirm } = req.body
  // 发布闸门：必须由用户在界面上二次确认
  if (confirm !== true) throw Object.assign(new Error('推送草稿箱需要用户确认'), { status: 400 })
  const m = String(cover ?? '').match(/^\/media\/([\w-]+\.(?:jpg|png))/)
  if (!m) throw Object.assign(new Error('请先设置封面图片'), { status: 400 })
  const pre = validateDraft({ title, author, digest, content: html, thumb_media_id: 'pending' })
  if (pre.length) throw Object.assign(new Error(pre.join('；')), { status: 400 })
  const coverPath = await variantPath(m[1], '235:100', 900)
  const c = await uploadCover(`${m[1]}#cover`, coverPath)
  res.json(await addDraft({ title, author, digest, content: html, thumb_media_id: c.media_id }))
}))

// ---------- 生产环境静态文件 ----------
const dist = join(ROOT, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message ?? String(err) })
})

const port = Number(process.env.API_PORT ?? 5174)
app.listen(port, '127.0.0.1', async () => {
  const ai = await aiStatus()
  console.log(`XIUMI AI Studio API http://127.0.0.1:${port}  AI:${ai.enabled ? `${ai.name} / ${ai.model}` : '规则模式'}  微信:${wechatStatus().configured ? '已配置' : '未配置'}`)
})
