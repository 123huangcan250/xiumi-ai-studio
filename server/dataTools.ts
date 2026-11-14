// 数据备份、恢复与旧版本迁移。
// 三者共用同一套合并规则：只复制认识的文件；目标已有同名内容时保留本机版本，从不覆盖；来源文件只读不改。
// 备份不含 AI 密钥和 .env（公众号 AppSecret）；迁移是本机复制，AI 设置连同密钥一起复制，.env 原样复制。
import { closeSync, constants, createReadStream, existsSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Writable } from 'node:stream'
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { APP_ID, DATA, DATA_ENV } from './paths'
import { readJson, writeJson, mutateJson } from './store'
import { restoreProjectFile } from './projectStore'

export const CATEGORIES = {
  projects: { label: '项目', re: /^projects\/[\w-]{1,64}\.json$/ },
  versions: { label: '历史版本', re: /^versions\/[\w-]{1,64}\/[\w-]{1,80}\.json$/ },
  templates: { label: '模板', re: /^templates\/[\w-]{1,64}\.json$/ },
  components: { label: '组件', re: /^components\/[\w-]{1,64}\.json$/ },
  themes: { label: '自定义主题', re: /^themes\/[\w-]{1,64}\.json$/ },
  assets: { label: '素材图片', re: /^assets\/[\w-]{1,64}\.(?:jpg|png)$/ },
} as const
export type Category = keyof typeof CATEGORIES
const ASSET_INDEX = 'assets/_index.json'
const SETTINGS = 'settings.json'
const MANIFEST = 'xiumi-backup.json'

const httpError = (message: string, status = 400) => Object.assign(new Error(message), { status })
const categoryOf = (rel: string) => (Object.keys(CATEGORIES) as Category[]).find((c) => CATEGORIES[c].re.test(rel))
const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
/** child 是否在 parent 里面（Windows 路径不区分大小写） */
const inside = (child: string, parent: string) => {
  const r = relative(resolve(parent).toLowerCase(), resolve(child).toLowerCase())
  return !!r && !r.startsWith('..') && !isAbsolute(r)
}

async function walk(dir: string, base = dir): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, base)))
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'))
  }
  return out
}

interface AiProfileLike {
  id: string
  name?: string
  apiKey?: string
  [k: string]: unknown
}
interface SettingsLike {
  ai?: { activeId?: string; profiles?: AiProfileLike[] }
  [k: string]: unknown
}

export interface MergePlan {
  /** 来源数据目录 */
  source: string
  /** 写入目标（当前数据目录） */
  target: string
  counts: Record<Category, { add: number; skip: number }>
  /** 未识别、损坏或不在白名单内的文件数（不会复制） */
  ignored: number
  ai: { add: string[]; skip: string[]; withKeys: boolean }
  env: { source: string; target: string; action: 'copy' | 'exists' } | null
  files: { rel: string; category: Category }[]
}

async function validJson(file: string) {
  try {
    JSON.parse(await readFile(file, 'utf8'))
    return true
  } catch {
    return false
  }
}

/** 比较来源目录与当前数据目录，列出会复制和会跳过的内容（不写任何文件） */
export async function planMerge(source: string, envSource: string | null, target = DATA): Promise<MergePlan> {
  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, { add: 0, skip: 0 }])) as MergePlan['counts']
  const files: MergePlan['files'] = []
  let ignored = 0
  for (const rel of await walk(source)) {
    if (rel === ASSET_INDEX || rel === SETTINGS || rel === MANIFEST) continue
    const category = categoryOf(rel)
    if (!category || (rel.endsWith('.json') && !(await validJson(join(source, rel))))) {
      ignored++
      continue
    }
    if (existsSync(join(target, rel))) counts[category].skip++
    else {
      counts[category].add++
      files.push({ rel, category })
    }
  }
  const src = await readJson<SettingsLike>(join(source, SETTINGS), {})
  const dst = await readJson<SettingsLike>(join(target, SETTINGS), {})
  const have = new Set((dst.ai?.profiles ?? []).map((p) => p.id))
  const profiles = (src.ai?.profiles ?? []).filter((p) => p && typeof p.id === 'string')
  const ai = {
    add: profiles.filter((p) => !have.has(p.id)).map((p) => p.name || p.id),
    skip: profiles.filter((p) => have.has(p.id)).map((p) => p.name || p.id),
    withKeys: profiles.some((p) => !have.has(p.id) && !!p.apiKey),
  }
  const env = envSource && existsSync(envSource) ? { source: envSource, target: join(target, '.env'), action: existsSync(join(target, '.env')) ? ('exists' as const) : ('copy' as const) } : null
  return { source, target, counts, ignored, ai, env, files }
}

export interface MergeResult {
  copied: number
  skipped: number
  aiAdded: number
  envCopied: boolean
}

/** 按计划复制。COPYFILE_EXCL 保证即使计划之后目标出现同名文件也不会被覆盖 */
export async function applyMerge(plan: MergePlan): Promise<MergeResult> {
  const { source, target } = plan
  let copied = 0
  let skipped = Object.values(plan.counts).reduce((n, c) => n + c.skip, 0)
  const addedAssets = new Set<string>()
  for (const { rel, category } of plan.files) {
    const to = join(target, rel)
    await mkdir(dirname(to), { recursive: true })
    try {
      const copy = () => copyFile(join(source, rel), to, constants.COPYFILE_EXCL)
      if (category === 'projects') await restoreProjectFile(join(source, rel), to)
      else await copy()
      copied++
      if (category === 'assets') addedAssets.add(basename(rel))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      skipped++
    }
  }
  // 素材索引：补上新复制的图片，以及目标里有文件、但索引里缺的条目
  const srcIndex = await readJson<Record<string, { file?: string }>>(join(source, ASSET_INDEX), {})
  if (Object.keys(srcIndex).length) {
    await mkdir(join(target, 'assets'), { recursive: true })
    await mutateJson<Record<string, unknown>>(join(target, ASSET_INDEX), {}, async dstIndex => {
    let changed = false
    for (const [id, a] of Object.entries(srcIndex)) {
      if (dstIndex[id] || !a?.file || !/^[\w-]+\.(?:jpg|png)$/.test(a.file)) continue
      if (addedAssets.has(a.file) || existsSync(join(target, 'assets', a.file))) {
        dstIndex[id] = a
        changed = true
      }
    }
    return changed
    })
  }
  // AI 设置：按 id 补充没有的配置，不改动已有配置和当前选用的模型
  let aiAdded = 0
  if (plan.ai.add.length) {
    const src = await readJson<SettingsLike>(join(source, SETTINGS), {})
    const dst = await readJson<SettingsLike>(join(target, SETTINGS), {})
    const have = new Set((dst.ai?.profiles ?? []).map((p) => p.id))
    const add = (src.ai?.profiles ?? []).filter((p) => p && typeof p.id === 'string' && !have.has(p.id))
    if (add.length) {
      const profiles = [...(dst.ai?.profiles ?? []), ...add]
      const activeId = dst.ai?.activeId || src.ai?.activeId || profiles[0].id
      await writeJson(join(target, SETTINGS), { ...dst, ai: { activeId, profiles } })
      aiAdded = add.length
    }
  }
  let envCopied = false
  if (plan.env?.action === 'copy') {
    try {
      await copyFile(plan.env.source, plan.env.target, constants.COPYFILE_EXCL)
      envCopied = true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  return { copied, skipped, aiAdded, envCopied }
}

// ---------- 旧版本（源码运行时的 data/ 与 .env）迁移 ----------

/** 用户填写的位置：可以是旧版的项目文件夹（含 data 子目录），也可以直接是 data 文件夹 */
export function resolveLegacy(input: string, target = DATA): { dataDir: string; envFile: string | null } {
  const raw = String(input ?? '').trim().replace(/^"(.*)"$/, '$1')
  if (!raw) throw httpError('请填写旧版本所在的文件夹')
  const p = resolve(raw)
  if (!existsSync(p)) throw httpError(`找不到文件夹：${p}`)
  const looksLikeData = (d: string) => ['projects', 'assets', 'templates', 'components', SETTINGS].some((x) => existsSync(join(d, x)))
  let dataDir: string
  let envFile: string | null = null
  if (existsSync(join(p, 'data')) && looksLikeData(join(p, 'data'))) {
    dataDir = join(p, 'data')
    envFile = existsSync(join(p, '.env')) ? join(p, '.env') : null
  } else if (looksLikeData(p)) {
    dataDir = p
    if (existsSync(join(p, '.env'))) envFile = join(p, '.env')
    else if (basename(p).toLowerCase() === 'data' && existsSync(join(dirname(p), '.env'))) envFile = join(dirname(p), '.env')
  } else {
    throw httpError('这个位置没有 XIUMI AI Studio 的数据：应包含 projects、assets、templates 等文件夹，或 settings.json')
  }
  if (samePath(dataDir, target) || inside(target, dataDir) || inside(dataDir, target)) throw httpError('这就是当前正在使用的数据目录，无需迁移')
  if (envFile && samePath(envFile, DATA_ENV)) envFile = null
  return { dataDir, envFile }
}

// ---------- 备份 ----------

/** 把当前数据打包成 zip 写入 out。包含项目、版本、模板、组件、主题、素材和去掉密钥的 AI 设置 */
export async function writeBackup(out: Writable, version: string): Promise<{ files: number }> {
  const rels = (await walk(DATA)).filter((r) => categoryOf(r) || r === ASSET_INDEX)
  const settings = await readJson<SettingsLike | null>(join(DATA, SETTINGS), null)
  return new Promise((resolvePromise, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err)
      out.write(chunk)
      if (final) {
        out.end()
        resolvePromise({ files: rels.length })
      }
    })
    const addBytes = (name: string, data: Uint8Array, store: boolean) => {
      const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 })
      zip.add(f)
      f.push(data, true)
    }
    ;(async () => {
      const manifest = { app: APP_ID, version, createdAt: new Date().toISOString(), note: '不含 AI 密钥与 .env（公众号 AppSecret）' }
      addBytes(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)), false)
      if (settings) {
        const ai = settings.ai ? { ...settings.ai, profiles: (settings.ai.profiles ?? []).map((p) => ({ ...p, apiKey: '' })) } : undefined
        addBytes(SETTINGS, Buffer.from(JSON.stringify({ ...settings, ...(ai && { ai }) })), false)
      }
      for (const rel of rels) addBytes(rel, await readFile(join(DATA, rel)), /\.(?:jpg|png)$/.test(rel))
      zip.end()
    })().catch(reject)
  })
}

/** 解压备份到临时目录：只解出认识的文件（路径白名单同时防止 zip 路径穿越） */
export async function extractBackup(zipFile: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let manifestOk = false
  let manifestBuf = ''
  const pending: Promise<void>[] = []
  const uz = new Unzip((file) => {
    const name = file.name
    const wanted = name === MANIFEST || name === SETTINGS || name === ASSET_INDEX || !!categoryOf(name)
    if (!wanted) return
    if (name === MANIFEST) {
      const dec = new TextDecoder()
      file.ondata = (err, data, final) => {
        if (err) throw err
        manifestBuf += dec.decode(data, { stream: !final })
        if (final) {
          try {
            manifestOk = JSON.parse(manifestBuf).app === APP_ID
          } catch {
            manifestOk = false
          }
        }
      }
      file.start()
      return
    }
    const to = join(dir, ...name.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    const fd = openSync(to, 'w')
    pending.push(
      new Promise((done, fail) => {
        file.ondata = (err, data, final) => {
          if (err) {
            closeSync(fd)
            return fail(err)
          }
          writeSync(fd, data)
          if (final) {
            closeSync(fd)
            done()
          }
        }
      }),
    )
    file.start()
  })
  uz.register(UnzipInflate)
  await new Promise<void>((done, fail) => {
    const rs = createReadStream(zipFile)
    rs.on('data', (chunk) => {
      try {
        uz.push(chunk as Buffer)
      } catch (e) {
        rs.destroy()
        fail(e)
      }
    })
    rs.on('end', () => {
      try {
        uz.push(new Uint8Array(0), true)
        done()
      } catch (e) {
        fail(e)
      }
    })
    rs.on('error', fail)
  }).catch(() => {
    throw httpError('无法读取这个文件：不是有效的 zip 备份')
  })
  await Promise.all(pending)
  if (!manifestOk) throw httpError('这不是 XIUMI AI Studio 导出的备份文件')
}
