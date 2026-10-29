import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { cropAsset, deleteAsset, listAssets, saveAsset, variantPath } from './assets'
import { aiStatus, chatJson, DESIGN_SYSTEM, EDIT_SYSTEM, OUTLINE_SYSTEM, TEMPLATE_SYSTEM } from './ai'
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
const templates = collection<{ id: string; name: string; blocks: unknown[]; themeId?: string; themeOverrides?: unknown; createdAt: number }>(DIRS.templates)
const themes = collection<{ id: string; name: string }>(DIRS.themes)
const versionsOf = (pid: string) => collection<Version>(join(DIRS.versions, safeId(pid)))

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '20mb' }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 50 } })

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
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
app.delete('/api/templates/:id', h(async (req, res) => {
  await templates.remove(String(req.params.id))
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
app.post('/api/settings/ai/test', h(async (req, res) => {
  const profile = await resolveDraftProfile(req.body ?? {})
  const t0 = Date.now()
  const r = await chatJson('只输出 JSON。', '请输出 {"ok":true,"model":"你的模型名称"}', { profile, maxTokens: 100, temperature: 0 })
  res.json({ ok: r?.ok === true, reply: r, ms: Date.now() - t0 })
}))
const pid = (req: Request) => (typeof req.body?.profileId === 'string' ? req.body.profileId : undefined)
app.post('/api/ai/outline', h(async (req, res) => {
  const text = String(req.body.text ?? '').slice(0, 30000)
  const imageNames: string[] = req.body.imageNames ?? []
  const user = `文稿如下：

${text}

可用图片文件名（用于 imageRefs，可留空）：${imageNames.join('、') || '无'}`
  res.json(await chatJson(OUTLINE_SYSTEM, user, { maxTokens: 8000, profileId: pid(req) }))
}))
app.post('/api/ai/design', h(async (req, res) => {
  const hint = String(req.body.hint ?? '').slice(0, 500)
  const user = `文章结构摘要：
${JSON.stringify(req.body.brief)}

用户的风格要求：${hint || '无，自行判断最适合该内容的风格'}`
  res.json(await chatJson(DESIGN_SYSTEM, user, { maxTokens: 6000, temperature: 0.8, profileId: pid(req) }))
}))
app.post('/api/ai/template-fill', h(async (req, res) => {
  const text = String(req.body.text ?? '').slice(0, 30000)
  const photos: string[] = Array.isArray(req.body.photos) ? req.body.photos.slice(0, 60).map(String) : []
  const user = `新推文的文稿或要点：
${text}

照片（编号：文件名）：${photos.map((n, i) => `${i}：${n}`).join('；') || '无'}

模板部件：
${JSON.stringify(req.body.catalog ?? []).slice(0, 60000)}

用户的额外要求：${String(req.body.hint ?? '').slice(0, 500) || '无'}`
  res.json(await chatJson(TEMPLATE_SYSTEM, user, { maxTokens: 8000, temperature: 0.5, profileId: pid(req) }))
}))
app.post('/api/ai/edit', h(async (req, res) => {
  const { context, instruction } = req.body
  const user = `当前文档（模块按顺序排列）：
${JSON.stringify(context)}

用户指令：${String(instruction).slice(0, 2000)}`
  res.json(await chatJson(EDIT_SYSTEM, user, { maxTokens: 6000, profileId: pid(req) }))
}))

// ---------- 文章抓取（导入公众号推文 / 参考风格） ----------
async function fetchPage(raw: string) {
  const url = new URL(raw)
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('仅支持 http(s) 链接'), { status: 400 })
  if (/^(localhost|127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[)/.test(url.hostname)) throw Object.assign(new Error('不允许访问内网地址'), { status: 400 })
  const r = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow',
  })
  if (!r.ok) throw Object.assign(new Error(`抓取失败 HTTP ${r.status}`), { status: 502 })
  return r.text()
}
app.post('/api/article/fetch', h(async (req, res) => res.json({ html: (await fetchPage(String(req.body.url))).slice(0, 5_000_000) })))
app.post('/api/reference/fetch', h(async (req, res) => res.json({ html: (await fetchPage(String(req.body.url))).slice(0, 5_000_000) })))
/** 把公众号文章中的图片下载到素材库（仅限微信图片域名） */
app.post('/api/assets/fetch', h(async (req, res) => {
  const urls: string[] = (req.body.urls ?? []).slice(0, 80)
  const out: Record<string, unknown> = {}
  const queue = [...new Set(urls)]
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        const host = new URL(u).hostname
        if (!/(^|\.)(qpic\.cn|qlogo\.cn)$/.test(host)) continue
        const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' }, referrerPolicy: 'no-referrer' })
        if (!r.ok) continue
        const name = `wx-${new URL(u).pathname.split('/').filter(Boolean).slice(-2, -1)[0]?.slice(-10) ?? 'img'}.jpg`
        out[u] = await saveAsset(Buffer.from(await r.arrayBuffer()), name)
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
