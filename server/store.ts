// 本地文件存储：项目、历史版本、模板收藏、自定义主题、素材。
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..')
export const DATA = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'))
export const DIRS = {
  projects: join(DATA, 'projects'),
  versions: join(DATA, 'versions'),
  templates: join(DATA, 'templates'),
  components: join(DATA, 'components'),
  themes: join(DATA, 'themes'),
  assets: join(DATA, 'assets'),
  cache: join(DATA, 'cache'),
}
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true })

const SAFE_ID = /^[\w-]{1,64}$/
export function safeId(id: string) {
  if (!SAFE_ID.test(id)) throw Object.assign(new Error('非法 id'), { status: 400 })
  return id
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

// Windows 不允许对同一目标并发替换；不同文件仍可独立保存。
const pendingWrites = new Map<string, Promise<void>>()

/** 原子写入，避免保存中断导致项目损坏 */
export async function writeJson(file: string, data: unknown) {
  const target = resolve(file)
  // 在排队前捕获数据，避免调用方后续修改对象影响本次保存。
  const json = JSON.stringify(data)
  const write = (pendingWrites.get(target) ?? Promise.resolve()).then(async () => {
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, json, 'utf8')
      await rename(tmp, target)
    } finally {
      await rm(tmp, { force: true })
    }
  })
  // 失败只报告给当前调用者，不阻止已排队的后续保存。
  const settled = write.then(() => {}, () => {})
  pendingWrites.set(target, settled)
  try {
    await write
  } finally {
    if (pendingWrites.get(target) === settled) pendingWrites.delete(target)
  }
}

export function collection<T extends { id: string }>(dir: string) {
  return {
    async list(): Promise<T[]> {
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
      return Promise.all(files.map((f) => readJson<T>(join(dir, f), null as unknown as T))).then((xs) => xs.filter(Boolean))
    },
    get: (id: string) => readJson<T | null>(join(dir, `${safeId(id)}.json`), null),
    put: (item: T) => writeJson(join(dir, `${safeId(item.id)}.json`), item),
    remove: (id: string) => rm(join(dir, `${safeId(id)}.json`), { force: true }),
    exists: (id: string) => existsSync(join(dir, `${safeId(id)}.json`)),
  }
}
