import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { collection, safeId } from './store'

type Project = { id: string; revision?: string; [key: string]: any }
const pending = new Map<string, Promise<unknown>>()
/** Shared by API read/check/write/delete and add-only restore for one project file. */
export function withProjectFile<T>(file: string, action: () => Promise<T>): Promise<T> {
  const absolute = resolve(file)
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  const result = (pending.get(key) ?? Promise.resolve()).then(action)
  const settled = result.then(() => {}, () => {})
  pending.set(key, settled)
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key) })
  return result
}
function assertProject(value: unknown, file: string): asserts value is Project {
  const id = value && typeof value === 'object' && !Array.isArray(value) ? (value as Project).id : undefined
  const expected = basename(file, '.json')
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) ||
      (process.platform === 'win32' ? id.toLowerCase() !== expected.toLowerCase() : id !== expected)) {
    throw Object.assign(new Error('项目文件形状或 id 无效，未覆盖原文件。'), { status: 409 })
  }
}
async function readProject<T>(file: string): Promise<T | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    assertProject(value, file)
    return value as T
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw Object.assign(new Error('项目文件无法读取或已损坏；为保留原文件，本次保存未执行。'), { status: 409 })
  }
}
/** Add-only restore keeps content, but must not resurrect a pre-deletion CAS token. */
export function restoreProjectFile(source: string, target: string): Promise<void> {
  return withProjectFile(target, async () => {
    try {
      await stat(target)
      throw Object.assign(new Error('Target already exists'), { code: 'EEXIST' })
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const raw = await readFile(source, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    assertProject(parsed, target)
    const content = JSON.stringify({ ...parsed, revision: randomUUID() })
    const temporary = target + '.' + randomUUID() + '.restore.tmp'
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
      await copyFile(temporary, target, constants.COPYFILE_EXCL)
    } finally { await rm(temporary, { force: true }) }
  })
}
function versioned<T extends Project>(doc: T): T & { revision: string } {
  return { ...doc, revision: doc.revision ?? `legacy-${createHash('sha256').update(JSON.stringify(doc)).digest('hex')}` }
}
export function projectCollection<T extends Project = Project>(dir: string) {
  const base = collection<T>(dir)
  const file = (id: string) => resolve(dir, `${safeId(id)}.json`)
  return {
    ...base,
    get: (id: string) => withProjectFile(file(id), async () => { const doc = await readProject<T>(file(id)); return doc ? versioned(doc) : null }),
    put(item: T) {
      const snapshot = structuredClone(item)
      return withProjectFile(file(item.id), async () => {
        const current = await readProject<T>(file(snapshot.id))
        if (current ? snapshot.revision !== versioned(current).revision : snapshot.revision != null) {
          throw Object.assign(new Error('此稿件已在其他页面修改或删除。当前内容未覆盖服务器，请另存副本或导出备份；旧页面请刷新后重新打开。'), { status: 409 })
        }
        const doc = { ...snapshot, revision: randomUUID(), updatedAt: Date.now() }
        await base.put(doc)
        return doc
      })
    },
    remove: (id: string) => withProjectFile(file(id), () => base.remove(id)),
  }
}
