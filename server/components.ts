// 组件库存储：每个组件一个 JSON 文件，放在 data/components/，不进入 Git。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { COMPONENT_SCHEMA, normalizeTags, validateDraft, type LibraryComponent } from '../src/core/components'
import { collection, DIRS } from './store'

const col = collection<LibraryComponent>(DIRS.components)
const httpError = (message: string, status = 400) => Object.assign(new Error(message), { status })

/** 组件用到、但已从素材库删除的本地图片 */
export function missingAssets(c: Pick<LibraryComponent, 'block'>): string[] {
  const files = new Set([...JSON.stringify(c.block).matchAll(/\/media\/([\w-]+\.(?:jpg|png))/g)].map((m) => m[1]))
  return [...files].filter((f) => !existsSync(join(DIRS.assets, f)))
}

export async function listComponents(): Promise<LibraryComponent[]> {
  const list = (await col.list()).filter((c) => c.block && c.schema <= COMPONENT_SCHEMA)
  return list.sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ ...c, missing: missingAssets(c) }))
}

/** 保存新组件。结构相同的组件已存在时不重复保存，返回已有的那个 */
export async function saveComponent(raw: unknown): Promise<{ component: LibraryComponent; duplicate: boolean }> {
  const { draft, error } = validateDraft(raw)
  if (!draft) throw httpError(error ?? '组件数据无效')
  if (draft.fingerprint) {
    const same = (await col.list()).find((c) => c.fingerprint === draft.fingerprint)
    if (same) return { component: same, duplicate: true }
  }
  const now = Date.now()
  const component: LibraryComponent = { ...draft, id: nanoid(10).replace(/[^\w-]/g, '_'), schema: COMPONENT_SCHEMA, rev: 1, createdAt: now, updatedAt: now }
  await col.put(component)
  return { component, duplicate: false }
}

/** 只允许修改名称、类别和标签；内容要改就重新收藏 */
export async function updateComponent(id: string, raw: any): Promise<LibraryComponent> {
  const c = await col.get(id)
  if (!c) throw httpError('组件不存在', 404)
  const next: LibraryComponent = {
    ...c,
    ...(typeof raw?.name === 'string' && raw.name.trim() && { name: raw.name.trim().slice(0, 40) }),
    ...(Array.isArray(raw?.tags) && { tags: normalizeTags(raw.tags) }),
    ...(typeof raw?.kind === 'string' && ['cover', 'heading', 'body', 'image', 'mixed', 'ending', 'decor'].includes(raw.kind) && { kind: raw.kind }),
    rev: c.rev + 1,
    updatedAt: Date.now(),
  }
  await col.put(next)
  return next
}

export const removeComponent = (id: string) => col.remove(id)
