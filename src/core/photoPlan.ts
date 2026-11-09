// 照片安排：用户可以把几张照片组成一组（必须放在同一个多图版式里），也可以指定照片放在某一句话后面。
// 排版前先检查这些要求能否满足，需要用户决定的情况（同一句后面有多张单独的照片、模块里没有对应张数的版式等）列为待确认问题。
import { autoPlace, kitLevels, layoutsFor, type AssembleOptions, type Kit, type Placement } from './assemble'
import { copyLevels, findAnchor, sectionOf, type Copy } from './copy'
import { roleDef, ROLES, type RoleId } from './roles'

export interface PhotoUnit {
  /** 组 id 或单张照片的素材 id */
  key: string
  /** 照片序号（从 0 开始） */
  photos: number[]
  grouped: boolean
  /** 组的版式；空表示自动选 */
  layout?: RoleId | ''
  /** 用户填的句子：照片放在这句话后面 */
  anchor?: string
}

/** 同一句话后面有多张单独的照片时的处理方式 */
export type Crowd = { mode: 'singles' } | { mode: 'group'; layout: RoleId } | { mode: 'ai'; request: string }

export interface CrowdIssue {
  /** 句子所在段落 id */
  after: string
  anchor: string
  section: string
  photos: number[]
  /** 可用的多图版式 */
  layouts: RoleId[]
}

export interface PlanCheck {
  levels: { copy: number; kit: number } | null
  /** 找不到的句子 */
  unmatched: PhotoUnit[]
  crowded: CrowdIssue[]
  /** 组的张数在所选模块里没有对应版式 */
  noLayout: PhotoUnit[]
}

export function checkPlan(copy: Copy, kit: Kit, units: PhotoUnit[], opts: AssembleOptions = {}): PlanCheck {
  const cl = copyLevels(copy)
  const kl = kitLevels(kit)
  const unmatched = units.filter((u) => u.anchor?.trim() && !findAnchor(copy, u.anchor))
  const byAnchor = new Map<string, PhotoUnit[]>()
  for (const u of units) {
    if (u.grouped || !u.anchor?.trim()) continue
    const id = findAnchor(copy, u.anchor)
    if (id) byAnchor.set(id, [...(byAnchor.get(id) ?? []), u])
  }
  const crowded: CrowdIssue[] = []
  for (const [after, list] of byAnchor) {
    if (list.length < 2) continue
    const photos = list.flatMap((u) => u.photos)
    crowded.push({ after, anchor: list[0].anchor!.trim(), section: sectionOf(copy, after), photos, layouts: layoutsFor(kit, photos.length, opts) })
  }
  const noLayout = units.filter((u) => u.grouped && u.photos.length > 1 && !(u.layout && kit[u.layout]) && !layoutsFor(kit, u.photos.length, opts).length)
  return { levels: cl > kl ? { copy: cl, kit: kl } : null, unmatched, crowded, noLayout }
}

export const planReady = (c: PlanCheck) => !c.levels && !c.unmatched.length && !c.crowded.length && !c.noLayout.length

/** 交给 AI 的照片安排请求 */
export interface AiPlaceRequest {
  items: { id: string; section: string; text: string }[]
  units: { id: string; photos: number[]; note: string; layout: string; fixedAfter?: string; request?: string }[]
  layouts: Record<string, string[]>
}

export interface PlanInput {
  copy: Copy
  kit: Kit
  units: PhotoUnit[]
  crowd: Record<string, Crowd>
  /** 没组成多图的照片在组无版式时改为单图 */
  singlesFor: Set<string>
  opts?: AssembleOptions
}

/**
 * 确定的安排（指定了句子的照片和组）直接生成；其余照片返回给调用方，由 AI 或规则安排。
 * askAi：同一句话后面的照片，用户用自然语言描述了要求，需要 AI 决定。
 */
export function fixedPlacements(input: PlanInput): { fixed: Placement[]; free: PhotoUnit[]; askAi: { after: string; photos: number[]; request: string }[] } {
  const { copy, units, crowd, singlesFor } = input
  const fixed: Placement[] = []
  const free: PhotoUnit[] = []
  const askAi: { after: string; photos: number[]; request: string }[] = []
  const handled = new Set<string>()
  for (const u of units) {
    if (handled.has(u.key)) continue
    const after = u.anchor?.trim() ? findAnchor(copy, u.anchor) : ''
    const layout = u.grouped && u.photos.length > 1 ? (singlesFor.has(u.key) ? 'singles' : u.layout || undefined) : undefined
    if (!after) {
      free.push({ ...u, layout: layout === 'singles' ? undefined : layout, grouped: u.grouped && layout !== 'singles' })
      continue
    }
    if (u.grouped) {
      fixed.push({ after, photos: u.photos, layout })
      continue
    }
    const decision = crowd[after]
    const same = units.filter((x) => !x.grouped && x.anchor?.trim() && findAnchor(copy, x.anchor) === after)
    same.forEach((x) => handled.add(x.key))
    const photos = same.flatMap((x) => x.photos)
    if (same.length < 2 || !decision || decision.mode === 'singles') fixed.push({ after, photos, layout: 'singles' })
    else if (decision.mode === 'group') fixed.push({ after, photos, layout: decision.layout })
    else askAi.push({ after, photos, request: decision.request })
  }
  return { fixed, free, askAi }
}

/** 没有 AI 时：自由照片按章节平均分配，组保持在一起 */
export function rulePlacements(copy: Copy, free: PhotoUnit[], fixed: Placement[]): Placement[] {
  return autoPlace(
    copy,
    free.map((u) => u.photos),
    fixed,
  ).map((p, i) => ({ ...p, ...(free[i].grouped && free[i].layout && { layout: free[i].layout as RoleId }) }))
}

export function aiPlaceRequest(input: PlanInput, free: PhotoUnit[], askAi: { after: string; photos: number[]; request: string }[], notes: string[]): AiPlaceRequest {
  const { copy, kit, opts } = input
  const layouts: Record<string, string[]> = {}
  const counts = new Set([...free.map((u) => u.photos.length), ...askAi.flatMap((a) => Array.from({ length: a.photos.length }, (_, i) => i + 1))])
  for (const n of counts) layouts[n] = layoutsFor(kit, n, opts).map((r) => roleDef(r).name)
  const note = (ps: number[]) => ps.map((i) => `照片${i + 1}${notes[i] ? `：${notes[i]}` : ''}`).join('；')
  return {
    items: copy.items.filter((i) => i.kind !== 'heading').map((i) => ({ id: i.id, section: sectionOf(copy, i.id), text: i.text.replace(/\*\*/g, '').slice(0, 90) })),
    units: [
      ...free.map((u, k) => ({ id: `U${k + 1}`, photos: u.photos.map((i) => i + 1), note: note(u.photos), layout: u.grouped ? (u.layout ? roleDef(u.layout).name : '自动') : '' })),
      ...askAi.map((a, k) => ({ id: `R${k + 1}`, photos: a.photos.map((i) => i + 1), note: note(a.photos), layout: '', fixedAfter: a.after, request: a.request })),
    ],
    layouts,
  }
}

const roleByName = (name: unknown): RoleId | undefined => ROLES.find((r) => r.name === String(name ?? '').trim())?.id

/**
 * 校验 AI 返回的安排：段落 id 必须存在，每张照片只用一次；组不能被拆开（拆开的组改为规则安排），
 * 版式必须是所选模块里有、张数也对得上的。AI 漏掉的照片按规则补上。
 */
export function normalizeAiPlacements(raw: any, input: PlanInput, req: AiPlaceRequest, free: PhotoUnit[], askAi: { after: string; photos: number[] }[], fixed: Placement[]): Placement[] {
  const ids = new Set(input.copy.items.map((i) => i.id))
  const unitOf = new Map<number, string>()
  req.units.forEach((u) => u.photos.forEach((p) => unitOf.set(p - 1, u.id)))
  const out: Placement[] = []
  const used = new Set<number>()
  for (const p of Array.isArray(raw?.placements) ? raw.placements : []) {
    const photos: number[] = (Array.isArray(p?.photos) ? p.photos : []).map((x: unknown) => Number(x) - 1).filter((i: number) => Number.isInteger(i) && unitOf.has(i) && !used.has(i))
    if (!photos.length) continue
    const unitIds = [...new Set(photos.map((i) => unitOf.get(i)!))]
    const units = unitIds.map((id) => req.units.find((x) => x.id === id)!)
    // 一组照片必须完整地一起出现，也不能和别的单元混在一条里
    if (units.some((u) => u.id.startsWith('U') && u.layout && (units.length > 1 || !u.photos.every((n) => photos.includes(n - 1))))) continue
    const unit = units[0]
    // 指定了位置的必须放在该位置
    const after = unit.fixedAfter ?? String(p?.after ?? '')
    if (!ids.has(after)) continue
    const fixedLayout = free.find((_, k) => `U${k + 1}` === unit.id)?.layout
    let layout: RoleId | 'singles' | undefined = fixedLayout || roleByName(p?.layout)
    if (photos.length === 1) layout = undefined
    else if (layout && !layoutsFor(input.kit, photos.length, input.opts).includes(layout)) layout = fixedLayout || undefined
    if (p?.layout === '单图' || p?.layout === '逐张单图') layout = 'singles'
    photos.forEach((i) => used.add(i))
    out.push({ after, photos, layout })
  }
  // AI 漏掉的：指定位置的放回原位，其余按规则
  for (const a of askAi) {
    const rest = a.photos.filter((i) => !used.has(i))
    if (rest.length) {
      rest.forEach((i) => used.add(i))
      out.push({ after: a.after, photos: rest, layout: 'singles' })
    }
  }
  const left = free.filter((u) => !u.photos.some((i) => used.has(i)))
  return [...out, ...rulePlacements(input.copy, left, [...fixed, ...out])]
}
