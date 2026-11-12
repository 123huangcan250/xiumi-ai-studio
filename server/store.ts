// 本地文件存储：项目、历史版本、模板收藏、自定义主题、素材。
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA, ROOT } from './paths'

export { DATA, ROOT }
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

/** 原子写入，避免保存中断导致项目损坏 */
export async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data), 'utf8')
  await rename(tmp, file)
}

export function collection<T extends { id: string }>(dir: string) {
  return {
    async list(): Promise<T[]> {
      // 历史版本按项目分目录，项目还没有版本时目录不存在
      if (!existsSync(dir)) return []
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
      return Promise.all(files.map((f) => readJson<T>(join(dir, f), null as unknown as T))).then((xs) => xs.filter(Boolean))
    },
    get: (id: string) => readJson<T | null>(join(dir, `${safeId(id)}.json`), null),
    async put(item: T) {
      const file = join(dir, `${safeId(item.id)}.json`)
      await mkdir(dir, { recursive: true })
      await writeJson(file, item)
    },
    remove: (id: string) => rm(join(dir, `${safeId(id)}.json`), { force: true }),
    exists: (id: string) => existsSync(join(dir, `${safeId(id)}.json`)),
  }
}
