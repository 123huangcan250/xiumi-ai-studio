// 打包产物验证：把 release 里的便携文件夹复制到“含中文和空格”的临时路径，用隔离的数据目录运行 exe，
// 检查启动、重复启动、退出、重启后数据仍在、端口冲突、强制结束后重启、缺少 app 文件夹等情况，
// 以及导入文档、图片处理、项目/版本/模板/主题保存、AI 设置与测试连接（本地模拟服务）、规则模式、草稿箱确认闸门、备份恢复与迁移。
//
//   pnpm verify:package
//
// 运行时会从 PATH 去掉 Node.js / pnpm 所在目录，但这仍是开发机，不等于干净的 Windows 环境。
// 不访问真实 AI、公众号或秀米；不读写本机真实数据（LOCALAPPDATA 也指向临时目录）。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { zipSync } from 'fflate'
import sharp from 'sharp'

const ROOT = join(import.meta.dirname, '..')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const NAME = `XIUMI-AI-Studio-${VERSION}-win-x64`
const ZIP = join(ROOT, 'release', `${NAME}.zip`)
if (!existsSync(ZIP)) {
  console.error(`没有找到 ${ZIP}，请先运行 pnpm package:win`)
  process.exit(1)
}

// 用 Windows 自带的解压（PowerShell Expand-Archive）解压交付的 zip，和队员的操作一致
const BASE = mkdtempSync(join(tmpdir(), 'xiumi 验证 '))
execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath $env:XZIP -DestinationPath $env:XDST`], { env: { ...process.env, XZIP: ZIP, XDST: join(BASE, '程序 文件夹') }, stdio: 'inherit' })
const DIR = join(BASE, '程序 文件夹', NAME)
const EXE = join(DIR, 'XIUMI AI Studio.exe')
const LOCAL = join(BASE, '本地 应用数据')
const DATA = join(LOCAL, 'XIUMI AI Studio')
const PORT = 5390
const FAKE_KEY = 'sk-verify-SHOULD-NOT-APPEAR-123456'
/** 模拟 AI 服务的端口，不能落在 PORT..PORT+19 的候选范围内 */
const MOCK_PORT = 5450

// 去掉 PATH 中带 node.exe / pnpm 的目录，模拟没有安装开发工具
const PATH = (process.env.PATH ?? '').split(delimiter).filter((p) => p && !['node.exe', 'pnpm.cmd', 'pnpm.exe', 'npm.cmd'].some((f) => existsSync(join(p, f)))).join(delimiter)
const ENV: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_|npm_|PNPM|XIUMI_|DATA_DIR|API_PORT|AI_|WECHAT_)/i.test(k) && k.toUpperCase() !== 'PATH'))
Object.assign(ENV, { Path: PATH, LOCALAPPDATA: LOCAL, XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1', XIUMI_PORT: String(PORT) })

const results: { name: string; ok: boolean; detail?: string }[] = []
async function check(name: string, fn: () => Promise<string | void> | string | void) {
  try {
    const detail = (await fn()) ?? undefined
    results.push({ name, ok: true, detail })
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message })
    console.log(`✗ ${name} — ${(e as Error).message}`)
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

interface Run {
  proc: ChildProcess
  out: () => string
  exit: Promise<number | null>
}
function launch(exe = EXE, env: NodeJS.ProcessEnv = ENV): Run {
  // 工作目录故意设为别处：程序不能依赖工作目录
  const proc = spawn(exe, [], { cwd: BASE, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  proc.stdout!.on('data', (d) => (out += d))
  proc.stderr!.on('data', (d) => (out += d))
  const exit = new Promise<number | null>((r) => proc.on('exit', (c) => r(c)))
  return { proc, out: () => out, exit }
}
async function waitFor<T>(fn: () => T | undefined | null | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`等待超时：${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}
async function start(env = ENV) {
  const run = launch(EXE, env)
  const url = await waitFor(() => run.out().match(/已启动：(http:\/\/127\.0\.0\.1:\d+)\//)?.[1], 30_000, `启动（输出：${run.out().slice(-300)}）`)
  return { ...run, url }
}
const timeout = <T>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<never>((_, j) => setTimeout(() => j(new Error(`超时：${what}`)), ms))])
const portOpen = (port: number) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }).then(() => true, () => false)
const exeProcesses = () => execFileSync('tasklist', ['/FI', 'IMAGENAME eq XIUMI AI Studio.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('XIUMI AI Studio.exe')).length

async function api(url: string, path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { origin: url, ...(init.headers as Record<string, string>) }
  let body = init.body
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const r = await fetch(url + path, { ...init, headers, body })
  const text = await r.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, data, type: r.headers.get('content-type') ?? '' }
}
const upload = (url: string, path: string, field: string, name: string, data: Buffer | string, type: string) => {
  const fd = new FormData()
  fd.append(field, new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type }), name)
  return api(url, path, { method: 'POST', body: fd })
}

/** 最小的 docx（mammoth 可读） */
function makeDocx(text: string) {
  const enc = (s: string) => new TextEncoder().encode(s)
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': enc('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': enc(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
    }),
  )
}

// 本地模拟的 OpenAI 兼容服务（测试连接用）
const mock: Server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true, model: 'mock' }) } }] }))
})
await new Promise<void>((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))

const before = exeProcesses()
console.log(`程序位置：${DIR}\n数据位置：${DATA}\nPATH 已去掉 Node.js/pnpm：${!PATH.split(delimiter).some((p) => existsSync(join(p, 'node.exe')))}\n`)

// ---------- 第一次启动 ----------
const a = await start()
await check('zip 解压后文件齐全，exe 带版本信息', () => {
  for (const f of ['XIUMI AI Studio.exe', '使用说明.txt', 'THIRD_PARTY_NOTICES.md', 'app/server.cjs', 'app/dist/index.html', 'app/samples/activity.txt', 'app/node_modules/@img/sharp-win32-x64/package.json', 'app/licenses/THIRD_PARTY_LICENSES.txt', 'app/licenses/Node.js-LICENSE.txt']) assert(existsSync(join(DIR, f)), `缺少 ${f}`)
  const v = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:XEXE).VersionInfo.ProductName + " " + (Get-Item -LiteralPath $env:XEXE).VersionInfo.FileVersion'], { env: { ...process.env, XEXE: EXE }, encoding: 'utf8' }).trim()
  assert(v.startsWith('XIUMI AI Studio'), v)
  return v
})
await check('首次启动并输出中文提示与地址', () => {
  assert(a.out().includes('退出：关闭此窗口'), '缺少退出说明')
  return a.url
})
await check('默认数据目录为 %LOCALAPPDATA%\\XIUMI AI Studio，程序目录与工作目录无关', async () => {
  const { data } = await api(a.url, '/api/app/info')
  assert(data.packaged === true, 'packaged 应为 true')
  assert(data.dataDir === DATA, `dataDir=${data.dataDir}`)
  assert(!existsSync(join(DIR, 'data')) && !existsSync(join(BASE, 'data')), '不应在程序目录或工作目录创建 data')
  return data.dataDir
})
await check('只监听 127.0.0.1', () => {
  const lines = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(`:${PORT} `) && l.includes('LISTENING'))
  assert(lines.length && lines.every((l) => l.includes(`127.0.0.1:${PORT}`)), lines.join(' | ') || '未找到监听')
})
await check('前端页面可访问', async () => {
  const r = await fetch(a.url + '/')
  assert(r.status === 200 && (await r.text()).includes('id="root"'), `HTTP ${r.status}`)
})
await check('拒绝非本机 Host 与跨站写请求', async () => {
  // fetch 会忽略自定义 Host，用 http.request 模拟 DNS 重绑定
  const hostStatus = await new Promise<number>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: Number(new URL(a.url).port), path: '/api/projects', headers: { host: 'evil.example.com' } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)))
    r.on('error', reject)
    r.end()
  })
  const o = await api(a.url, '/api/templates', { method: 'POST', json: { name: 'x' }, headers: { origin: 'https://evil.example.com' } })
  assert(hostStatus === 403, `伪造 Host ${hostStatus}`)
  assert(o.status === 403, `跨站写请求 ${o.status}`)
  return `伪造 Host：${hostStatus}；跨站 POST：${o.status}`
})
await check('规则模式：未配置 AI 时可用', async () => {
  const { data } = await api(a.url, '/api/ai/status')
  assert(data.enabled === false, JSON.stringify(data))
})
await check('导入 TXT / Markdown / Word', async () => {
  const t = await upload(a.url, '/api/import', 'file', '活动 记录.txt', '第一行\n第二行正文', 'text/plain')
  const m = await upload(a.url, '/api/import', 'file', '推文.md', '# 标题\n\n正文 **加粗**', 'text/markdown')
  const d = await upload(a.url, '/api/import', 'file', '文稿.docx', makeDocx('这是 Word 正文'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert(t.data.text?.includes('第二行正文'), `txt ${JSON.stringify(t.data)}`)
  assert(m.data.text?.includes('标题'), `md ${JSON.stringify(m.data)}`)
  assert(d.data.text?.includes('这是 Word 正文'), `docx ${JSON.stringify(d.data)}`)
})
let assetFile = ''
await check('图片上传、裁切变体与裁剪另存（sharp 原生库）', async () => {
  const up = await upload(a.url, '/api/assets', 'files', '照片 1.jpg', readFileSync(join(ROOT, 'samples', 'photo-01.jpg')), 'image/jpeg')
  const asset = up.data[0]
  assert(asset?.file, JSON.stringify(up.data))
  assetFile = asset.file
  const v = await fetch(`${a.url}/media/${asset.file}?fit=1:1&w=300`)
  const meta = await sharp(Buffer.from(await v.arrayBuffer())).metadata()
  assert(meta.width === 300 && meta.height === 300, `变体 ${meta.width}x${meta.height}`)
  const crop = await api(a.url, `/api/assets/${asset.id}/crop`, { method: 'POST', json: { x: 10, y: 10, width: 200, height: 100 } })
  assert(crop.data.width === 200 && crop.data.height === 100, JSON.stringify(crop.data))
  return `${asset.width}×${asset.height} → 变体 300×300，裁剪 200×100`
})
await check('载入验收样例（约 2000 字 + 10 张图）', async () => {
  const { data } = await api(a.url, '/api/samples/load', { method: 'POST' })
  assert(data.text?.length > 1500 && data.assets?.length === 10, `${data.text?.length} 字，${data.assets?.length} 张`)
})
const doc = { id: 'verify-project', title: '验证项目', author: '', digest: '', themeId: 'tsinghua', blocks: [{ id: 'b1', type: 'paragraph', props: { content: '正文', align: 'left' } }], createdAt: 1, updatedAt: 1 }
await check('保存项目与历史版本、模板、自定义主题', async () => {
  assert((await api(a.url, '/api/projects/verify-project', { method: 'PUT', json: doc })).status === 200, '保存项目失败')
  assert((await api(a.url, '/api/projects/verify-project/versions', { method: 'POST', json: { doc, label: '验证版本' } })).status === 200, '保存版本失败')
  assert((await api(a.url, '/api/templates', { method: 'POST', json: { name: '验证模板', blocks: doc.blocks } })).status === 200, '保存模板失败')
  assert((await api(a.url, '/api/themes', { method: 'POST', json: { id: 'verify-theme', name: '验证主题' } })).status === 200, '保存主题失败')
})
await check('AI 设置：保存、密钥打码、测试连接（本地模拟服务）', async () => {
  await api(a.url, '/api/settings/ai', { method: 'PUT', json: { activeId: 'v1', profiles: [{ id: 'v1', name: '模拟模型', provider: 'openai', baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: FAKE_KEY, model: 'mock', jsonMode: true }] } })
  const s = await api(a.url, '/api/settings/ai')
  assert(!JSON.stringify(s.data).includes(FAKE_KEY), '接口返回了完整密钥')
  const t = await api(a.url, '/api/settings/ai/test', { method: 'POST', json: { id: 'v1', apiKey: s.data.profiles[0].apiKey } })
  assert(t.data.ok === true, JSON.stringify(t.data))
  const st = await api(a.url, '/api/ai/status')
  assert(st.data.enabled === true, '配置后应启用 AI')
})
await check('公众号草稿箱：未确认被拒绝，未配置时给出中文提示', async () => {
  const no = await api(a.url, '/api/wechat/draft', { method: 'POST', json: { title: 't', html: '<p>x</p>', cover: `/media/${assetFile}` } })
  assert(no.status === 400 && String(no.data.error).includes('确认'), JSON.stringify(no.data))
  const yes = await api(a.url, '/api/wechat/draft', { method: 'POST', json: { title: 't', author: '', digest: '', html: '<p>x</p>', cover: `/media/${assetFile}`, confirm: true } })
  assert(yes.status >= 400 && String(yes.data.error).includes('未配置公众号接口'), JSON.stringify(yes.data))
  return `${no.status} / ${yes.status}`
})
let backupZip: Buffer = Buffer.alloc(0)
await check('备份下载：zip 不含 AI 密钥', async () => {
  const r = await fetch(a.url + '/api/data/backup')
  backupZip = Buffer.from(await r.arrayBuffer())
  assert(r.headers.get('content-type')?.includes('zip') && backupZip.length > 1000, `HTTP ${r.status}`)
  assert(!backupZip.toString('latin1').includes(FAKE_KEY), '备份中出现了密钥')
  return `${(backupZip.length / 1024).toFixed(0)} KB`
})
await check('从备份恢复：先预览，同名内容保留本机', async () => {
  const up = await upload(a.url, '/api/data/restore', 'file', '备份.zip', backupZip, 'application/zip')
  assert(up.data.token && up.data.plan.counts.projects.skip >= 1 && up.data.plan.counts.projects.add === 0, JSON.stringify(up.data))
  const ap = await api(a.url, `/api/data/restore/${up.data.token}/apply`, { method: 'POST', json: {} })
  assert(ap.data.copied === 0, JSON.stringify(ap.data))
})
await check('从旧版本迁移：预览列出来源和目标，执行后原件不变', async () => {
  const legacy = join(BASE, '旧版 项目')
  mkdirSync(join(legacy, 'data', 'projects'), { recursive: true })
  writeFileSync(join(legacy, 'data', 'projects', 'legacy-1.json'), JSON.stringify({ ...doc, id: 'legacy-1', title: '旧版项目' }))
  writeFileSync(join(legacy, '.env'), 'WECHAT_APPID=\n')
  const pv = await api(a.url, '/api/data/migrate/preview', { method: 'POST', json: { path: legacy } })
  assert(pv.data.plan?.source === join(legacy, 'data') && pv.data.plan.target === DATA && pv.data.plan.counts.projects.add === 1 && pv.data.plan.env?.action === 'copy', JSON.stringify(pv.data))
  const ap = await api(a.url, '/api/data/migrate/apply', { method: 'POST', json: { path: legacy } })
  assert(ap.data.copied === 1 && ap.data.envCopied === true, JSON.stringify(ap.data))
  assert(existsSync(join(legacy, 'data', 'projects', 'legacy-1.json')) && existsSync(join(legacy, '.env')), '原件被改动')
})
await check('重复启动：打开已有实例，不再启动第二个', async () => {
  const b = launch()
  const code = await timeout(b.exit, 15_000, '第二个实例没有退出')
  assert(code === 0 && b.out().includes('已经有一个 XIUMI AI Studio 在运行'), `退出码 ${code}：${b.out().slice(-200)}`)
  assert((await api(a.url, '/api/app/info')).status === 200, '原实例不可用')
})
await check('页面「退出」：进程结束、端口释放、运行记录清除', async () => {
  await api(a.url, '/api/app/quit', { method: 'POST', json: {} })
  const code = await timeout(a.exit, 10_000, '进程没有退出')
  assert(code === 0, `退出码 ${code}`)
  assert(!(await portOpen(PORT)), '端口仍被占用')
  assert(!existsSync(join(DATA, 'runtime.json')), 'runtime.json 未清除')
})

// ---------- 重启 ----------
const b = await start()
await check('重启后项目、版本、模板、主题、素材、AI 设置与迁移的数据仍在', async () => {
  const p = await api(b.url, '/api/projects/verify-project')
  const v = await api(b.url, '/api/projects/verify-project/versions')
  const t = await api(b.url, '/api/templates')
  const th = await api(b.url, '/api/themes')
  const as = await api(b.url, '/api/assets')
  const s = await api(b.url, '/api/settings/ai')
  const l = await api(b.url, '/api/projects/legacy-1')
  assert(p.data.title === '验证项目' && v.data.length === 1 && t.data.some((x: any) => x.name === '验证模板') && th.data.some((x: any) => x.id === 'verify-theme'), '项目/版本/模板/主题缺失')
  assert(as.data.length >= 12 && s.data.profiles[0]?.hasKey === true && l.data.title === '旧版项目', '素材/AI 设置/迁移项目缺失')
  assert(existsSync(join(DATA, '.env')), '迁移的 .env 缺失')
  return `${as.data.length} 张素材`
})
await check('强制结束后可以重新启动（残留运行记录不影响）', async () => {
  execFileSync('taskkill', ['/PID', String(b.proc.pid), '/T', '/F'], { stdio: 'ignore' })
  await timeout(b.exit, 10_000, '强制结束失败')
  assert(existsSync(join(DATA, 'runtime.json')), '预期留下运行记录')
  const c = await start()
  assert((await api(c.url, '/api/projects/verify-project')).data.title === '验证项目', '数据丢失')
  await api(c.url, '/api/app/quit', { method: 'POST', json: {} })
  await timeout(c.exit, 10_000, '退出失败')
})

// ---------- 端口冲突 ----------
await check('端口被其他程序占用时自动换用下一个，不影响占用者', async () => {
  const other = createServer((_q, s) => s.end('other-app'))
  await new Promise<void>((r) => other.listen(PORT, '127.0.0.1', r))
  const c = await start()
  try {
    assert(c.url.endsWith(`:${PORT + 1}`), c.url)
    assert(c.out().includes(`端口 ${PORT} 被其他程序占用`), '缺少换端口提示')
    assert((await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text())) === 'other-app', '占用者被影响')
  } finally {
    await api(c.url, '/api/app/quit', { method: 'POST', json: {} })
    await timeout(c.exit, 10_000, '退出失败')
    other.close()
  }
  return c.url
})
await check('全部候选端口被占用：中文错误并退出（退出码 1）', async () => {
  const servers: Server[] = []
  for (let p = PORT; p < PORT + 20; p++) {
    const s = createServer((_q, r) => r.end('busy'))
    await new Promise<void>((r) => s.listen(p, '127.0.0.1', r))
    servers.push(s)
  }
  try {
    const c = launch()
    const code = await timeout(c.exit, 30_000, '没有退出')
    assert(code === 1 && c.out().includes('都被其他程序占用') && c.out().includes('XIUMI_PORT'), `退出码 ${code}：${c.out().slice(-300)}`)
  } finally {
    servers.forEach((s) => s.close())
  }
})
await check('只复制 exe 出来运行：提示完整解压（退出码 1）', async () => {
  const lone = join(BASE, '单独的 exe')
  mkdirSync(lone, { recursive: true })
  copyFileSync(EXE, join(lone, 'XIUMI AI Studio.exe'))
  const c = launch(join(lone, 'XIUMI AI Studio.exe'))
  const code = await timeout(c.exit, 15_000, '没有退出')
  assert(code === 1 && c.out().includes('完整解压'), `退出码 ${code}：${c.out()}`)
})
await check('日志存在且不含密钥', () => {
  const logs = readdirSync(join(DATA, 'logs'))
  assert(logs.length > 0, '没有日志')
  const all = logs.map((f) => readFileSync(join(DATA, 'logs', f), 'utf8')).join('\n')
  assert(!all.includes(FAKE_KEY), '日志中出现密钥')
  return logs.join(', ')
})
await check('没有残留进程', async () => {
  await new Promise((r) => setTimeout(r, 1000))
  const now = exeProcesses()
  assert(now <= before, `运行前 ${before} 个，现在 ${now} 个`)
})

mock.close()
const failed = results.filter((r) => !r.ok)
const report = [
  `# 打包产物验证报告`,
  ``,
  `- 时间：${new Date().toISOString()}`,
  `- 产物：${NAME}`,
  `- 运行位置：\`${DIR}\`（含中文和空格）`,
  `- 数据位置：\`${DATA}\`（隔离的临时 LOCALAPPDATA）`,
  `- 环境：本开发机，PATH 已去掉 Node.js/pnpm 目录；**不是干净的 Windows 环境**`,
  `- 结果：${results.length - failed.length}/${results.length} 通过`,
  ``,
  ...results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? `：${r.detail.replace(/\n/g, ' ')}` : ''}`),
  ``,
].join('\n')
writeFileSync(join(ROOT, 'release', 'verify-report.md'), report)
rmSync(BASE, { recursive: true, force: true })
console.log(`\n${results.length - failed.length}/${results.length} 通过，报告：release/verify-report.md`)
process.exit(failed.length ? 1 : 0)
