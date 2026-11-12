// 打包运行相关：配置加载顺序、本机访问限制、日志打码、备份/恢复/迁移、端口选择
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `xiumi-${p}-`))
const DATA = tmp('data 数据')
process.env.DATA_DIR = DATA

let tools: typeof import('../../server/dataTools')
let app: typeof import('../../server/app')
let launcher: typeof import('../../server/launcher')
let log: typeof import('../../server/log')
beforeAll(async () => {
  tools = await import('../../server/dataTools')
  app = await import('../../server/app')
  launcher = await import('../../server/launcher')
  log = await import('../../server/log')
})

const write = (file: string, data: string | Buffer) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, data)
}
const json = (o: unknown) => JSON.stringify(o)

/** 在独立进程里加载 paths.ts，返回解析出的路径和环境变量 */
function loadPaths(env: Record<string, string>) {
  const script = `import('./server/paths.ts').then((p) => console.log(JSON.stringify({ DATA: p.DATA, ROOT: p.ROOT, files: p.loadedEnvFiles, model: process.env.AI_MODEL ?? null, wx: process.env.WECHAT_APPID ?? null })))`
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATA_DIR|XIUMI_|AI_|WECHAT_)/.test(k)))
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: join(import.meta.dirname, '..', '..'), env: { ...clean, ...env }, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop()!)
}

describe('配置加载顺序', () => {
  it('源码运行：仓库 .env 里的 DATA_DIR 在数据目录确定之前生效', () => {
    const root = tmp('repo')
    const target = join(root, '自定义 数据')
    write(join(root, '.env'), `DATA_DIR=${target}\nAI_MODEL=from-repo-env\n`)
    const r = loadPaths({ XIUMI_RESOURCES: root })
    expect(r.DATA).toBe(target)
    expect(r.model).toBe('from-repo-env')
  })
  it('打包运行：数据在 LOCALAPPDATA，读数据目录的 .env，不读程序目录的 .env，系统环境变量优先', () => {
    const local = tmp('local appdata')
    const res = tmp('resources')
    write(join(res, '.env'), 'AI_MODEL=should-not-load\n')
    write(join(local, 'XIUMI AI Studio', '.env'), 'WECHAT_APPID=wx-from-data\nAI_MODEL=from-data-env\n')
    const r = loadPaths({ XIUMI_PACKAGED: '1', XIUMI_RESOURCES: res, LOCALAPPDATA: local, AI_MODEL: 'from-system' })
    expect(r.DATA).toBe(join(local, 'XIUMI AI Studio'))
    expect(r.ROOT).toBe(res)
    expect(r.wx).toBe('wx-from-data')
    expect(r.model).toBe('from-system')
    expect(r.files).toEqual([join(local, 'XIUMI AI Studio', '.env')])
  })
  it('XIUMI_DATA_DIR 可以指定数据目录（路径含中文和空格）', () => {
    const d = join(tmp('custom'), '我的 数据')
    expect(loadPaths({ XIUMI_PACKAGED: '1', XIUMI_DATA_DIR: d, LOCALAPPDATA: tmp('x') }).DATA).toBe(d)
  })
})

describe('历史版本存储', () => {
  it('项目第一次保存版本时创建目录；没有版本时列表为空', async () => {
    const { collection } = await import('../../server/store')
    const col = collection<{ id: string; label: string }>(join(DATA, 'versions', 'new-project'))
    expect(await col.list()).toEqual([])
    await col.put({ id: '1-a', label: '第一个版本' })
    expect((await col.list()).map((v) => v.label)).toEqual(['第一个版本'])
  })
})

describe('本机访问限制', () => {
  const req = (host: string, method = 'GET', origin?: string) => ({ method, headers: { host, ...(origin && { origin }) } })
  it('只接受回环地址的 Host', () => {
    expect(app.localOnly(req('127.0.0.1:5174'))).toBeNull()
    expect(app.localOnly(req('localhost:5273'))).toBeNull()
    expect(app.localOnly(req('[::1]:5174'))).toBeNull()
    expect(app.localOnly(req('evil.example.com:5174'))).toContain('本机')
    expect(app.localOnly(req('192.168.1.5:5174'))).toContain('本机')
  })
  it('拒绝其他网站发来的写请求，读取不受影响', () => {
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'http://localhost:5273'))).toBeNull()
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'https://evil.example.com'))).toContain('其他网站')
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'null'))).toContain('其他网站')
    expect(app.localOnly(req('127.0.0.1:5174', 'GET', 'https://evil.example.com'))).toBeNull()
  })
})

describe('日志打码', () => {
  it('去掉登记过的密钥和常见密钥格式', () => {
    log.addSecret('my-very-secret-value')
    const s = log.redact('key=my-very-secret-value auth: Bearer abc.def sk-1234567890abcdef {"apiKey":"zzz999"} appsecret=qwerty123')
    expect(s).not.toMatch(/my-very-secret-value|abc\.def|1234567890abcdef|zzz999|qwerty123/)
  })
})

describe('迁移、备份与恢复', () => {
  function legacyRepo() {
    const repo = tmp('旧版 repo')
    const d = join(repo, 'data')
    write(join(d, 'projects', 'p1.json'), json({ id: 'p1', title: '旧项目', blocks: [] }))
    write(join(d, 'projects', 'p2.json'), json({ id: 'p2', title: '同名项目（旧）' }))
    write(join(d, 'projects', 'broken.json'), '{not json')
    write(join(d, 'versions', 'p1', '1-a.json'), json({ id: '1-a' }))
    write(join(d, 'templates', 't1.json'), json({ id: 't1' }))
    write(join(d, 'components', 'c1.json'), json({ id: 'c1' }))
    write(join(d, 'themes', 'th1.json'), json({ id: 'th1' }))
    write(join(d, 'assets', 'img1.jpg'), Buffer.from([1, 2, 3]))
    write(join(d, 'assets', '_index.json'), json({ img1: { id: 'img1', file: 'img1.jpg' } }))
    write(join(d, 'cache', 'x.jpg'), 'cache')
    write(join(d, 'settings.json'), json({ ai: { activeId: 'old', profiles: [{ id: 'old', name: 'DeepSeek', apiKey: 'sk-oldkey123456' }, { id: 'same', name: '同名' }] } }))
    write(join(repo, '.env'), 'WECHAT_APPID=wx1\n')
    return repo
  }
  function target() {
    const t = tmp('目标 data')
    write(join(t, 'projects', 'p2.json'), json({ id: 'p2', title: '本机版本' }))
    write(join(t, 'settings.json'), json({ ai: { activeId: 'same', profiles: [{ id: 'same', name: '本机' }] } }))
    return t
  }

  it('识别旧版项目文件夹或 data 文件夹，拒绝当前数据目录', () => {
    const repo = legacyRepo()
    const t = target()
    expect(tools.resolveLegacy(repo, t)).toEqual({ dataDir: join(repo, 'data'), envFile: join(repo, '.env') })
    expect(tools.resolveLegacy(`"${join(repo, 'data')}"`, t)).toEqual({ dataDir: join(repo, 'data'), envFile: join(repo, '.env') })
    expect(() => tools.resolveLegacy(t, t)).toThrow('当前正在使用')
    expect(() => tools.resolveLegacy(tmp('empty'), t)).toThrow('没有 XIUMI AI Studio 的数据')
    expect(() => tools.resolveLegacy(join(repo, 'nope'), t)).toThrow('找不到')
  })

  it('预览不写文件；执行时只补充缺少的内容，不覆盖本机，不改动原件', async () => {
    const repo = legacyRepo()
    const t = target()
    const { dataDir, envFile } = tools.resolveLegacy(repo, t)
    const before = readFileSync(join(dataDir, 'settings.json'), 'utf8')
    const plan = await tools.planMerge(dataDir, envFile, t)
    expect(plan.counts.projects).toEqual({ add: 1, skip: 1 })
    expect(plan.counts.assets.add).toBe(1)
    expect(plan.ignored).toBe(2) // 损坏的 JSON 与缓存
    expect(plan.ai).toEqual({ add: ['DeepSeek'], skip: ['同名'], withKeys: true })
    expect(plan.env?.action).toBe('copy')
    expect(existsSync(join(t, 'projects', 'p1.json'))).toBe(false)

    const r = await tools.applyMerge(plan)
    expect(r).toMatchObject({ copied: 6, aiAdded: 1, envCopied: true })
    expect(JSON.parse(readFileSync(join(t, 'projects', 'p2.json'), 'utf8')).title).toBe('本机版本')
    expect(JSON.parse(readFileSync(join(t, 'projects', 'p1.json'), 'utf8')).title).toBe('旧项目')
    expect(JSON.parse(readFileSync(join(t, 'assets', '_index.json'), 'utf8')).img1.file).toBe('img1.jpg')
    const s = JSON.parse(readFileSync(join(t, 'settings.json'), 'utf8'))
    expect(s.ai.activeId).toBe('same')
    expect(s.ai.profiles.map((p: { name: string }) => p.name)).toEqual(['本机', 'DeepSeek'])
    expect(readFileSync(join(t, '.env'), 'utf8')).toBe('WECHAT_APPID=wx1\n')
    expect(existsSync(join(t, 'cache', 'x.jpg'))).toBe(false)
    // 原件不变；再执行一次不会重复
    expect(readFileSync(join(dataDir, 'settings.json'), 'utf8')).toBe(before)
    const again = await tools.applyMerge(await tools.planMerge(dataDir, envFile, t))
    expect(again).toMatchObject({ copied: 0, aiAdded: 0, envCopied: false })
  })

  it('备份不含密钥；恢复到另一台电脑的数据目录后内容齐全', async () => {
    write(join(DATA, 'projects', 'b1.json'), json({ id: 'b1', title: '备份项目' }))
    write(join(DATA, 'assets', 'pic.png'), Buffer.from([9, 9, 9]))
    write(join(DATA, 'assets', '_index.json'), json({ pic: { id: 'pic', file: 'pic.png' } }))
    write(join(DATA, 'settings.json'), json({ ai: { activeId: 'k', profiles: [{ id: 'k', name: 'Kimi', apiKey: 'sk-secret-should-not-leak' }] } }))
    write(join(DATA, '.env'), 'WECHAT_APPSECRET=topsecret\n')
    const chunks: Buffer[] = []
    const out = new PassThrough()
    out.on('data', (c) => chunks.push(c))
    await tools.writeBackup(out, 'test')
    const zipBuf = Buffer.concat(chunks)
    expect(zipBuf.toString('latin1')).not.toMatch(/sk-secret-should-not-leak|topsecret/)
    const zipFile = join(tmp('zip'), 'backup.zip')
    writeFileSync(zipFile, zipBuf)

    const dir = join(tmp('restore'), 'x')
    await tools.extractBackup(zipFile, dir)
    const t = tmp('新电脑')
    const plan = await tools.planMerge(dir, null, t)
    expect(plan.counts.projects.add).toBe(1)
    expect(plan.ai.withKeys).toBe(false)
    await tools.applyMerge(plan)
    expect(JSON.parse(readFileSync(join(t, 'projects', 'b1.json'), 'utf8')).title).toBe('备份项目')
    expect(readFileSync(join(t, 'assets', 'pic.png'))).toEqual(Buffer.from([9, 9, 9]))
    expect(JSON.parse(readFileSync(join(t, 'settings.json'), 'utf8')).ai.profiles[0]).toMatchObject({ name: 'Kimi', apiKey: '' })
    expect(existsSync(join(t, '.env'))).toBe(false)
  })

  it('拒绝不是备份的 zip，不解出路径穿越和白名单以外的文件', async () => {
    const d = tmp('evil')
    const plain = join(d, 'plain.zip')
    writeFileSync(plain, zipSync({ 'projects/a.json': new TextEncoder().encode('{}') }))
    await expect(tools.extractBackup(plain, join(d, 'out1'))).rejects.toThrow('不是 XIUMI AI Studio')
    const evil = join(d, 'evil.zip')
    writeFileSync(evil, zipSync({ 'xiumi-backup.json': new TextEncoder().encode(json({ app: 'xiumi-ai-studio' })), '../escape.json': new TextEncoder().encode('{}'), 'projects/../../x.json': new TextEncoder().encode('{}') }))
    await tools.extractBackup(evil, join(d, 'out2'))
    expect(existsSync(join(d, 'escape.json'))).toBe(false)
    expect(existsSync(join(d, 'x.json'))).toBe(false)
    const notZip = join(d, 'note.zip')
    writeFileSync(notZip, 'hello')
    await expect(tools.extractBackup(notZip, join(d, 'out3'))).rejects.toThrow()
  })
})

describe('端口与单实例', () => {
  it('端口被其他程序占用时换下一个，不影响占用者', async () => {
    const other = createServer((_q, s) => s.end('other'))
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r))
    const busy = (other.address() as { port: number }).port
    const ours = createServer()
    const port = await launcher.listenOnFreePort(ours, [busy, busy + 1, busy + 2])
    expect(port).not.toBe(busy)
    expect(await fetch(`http://127.0.0.1:${busy}/`).then((r) => r.text())).toBe('other')
    ours.close()
    other.close()
  })
  it('只把使用同一数据目录的实例当成“已在运行”', async () => {
    const ask = async (p: number) => (p === 6001 ? { app: 'xiumi-ai-studio', dataDir: 'C:\\Other' } : p === 6002 ? { app: 'xiumi-ai-studio', dataDir: DATA.toUpperCase() } : null)
    expect(await launcher.findRunning(DATA, [6000, 6001, 6002], ask)).toBe(6002)
    expect(await launcher.findRunning(DATA, [6000, 6001], ask)).toBeNull()
  })
})
