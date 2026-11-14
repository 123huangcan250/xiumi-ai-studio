// 光标层：根据时间轴反推光标轨迹，只负责展示和提示。删掉整层，元素照样按时出现。
import { drawRun, el, group, shape, type RenderCtx } from './draw'
import { mix } from './layout'
import { paceTable, PACE_SCALE } from './pace'
import { round, type TimedItem, type Timeline } from './schedule'
import type { AnimSpec, Key } from './smil'
import type { CursorAction, ReplayDoc, ReplayScene } from './types'

export interface CursorStop {
  /** 元素序号 */
  item: number
  action: CursorAction
  /** 出发、到达（= tStart - lead）、动作开始（= tStart）、空闲（动作结束） */
  depart: number
  arrive: number
  act: number
  free: number
  x: number
  y: number
}

export interface CursorTrack {
  who: number
  color: string
  name?: string
  spawn: { t: number; x: number; y: number } | null
  stops: CursorStop[]
  /** 位置关键帧（左上角为光标尖端） */
  pos: Key[]
  scale: Key[]
  ripples: { t: number; x: number; y: number }[]
  exit: { t: number; x: number; y: number } | null
}

export interface CursorPlan {
  tracks: CursorTrack[]
  /** 没有分到空闲光标的元素（照常出现，只是没有光标演示） */
  unassigned: number[]
  swarm: { t: number; x: number; y: number; radius: number; members: number[] } | null
  end: number
}

/** 元素的锚点：文字起点，否则左上角 */
export function anchorOf(ti: TimedItem): { x: number; y: number } {
  if (ti.text && ti.item.type !== 'stat') return { x: ti.text.x + 2, y: ti.text.y + ti.text.lineHeight * 0.55 }
  return { x: ti.box.x + 4, y: ti.box.y + 4 }
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

export function planCursors(tl: Timeline, doc: ReplayDoc, scene: ReplayScene): CursorPlan {
  const p = paceTable(doc.playback.pace)
  const k = PACE_SCALE[doc.playback.pace] ?? 1
  const moveDur = (d: number) => p.moveMin + (p.moveMax - p.moveMin) * Math.min(1, d / 700)
  const n = doc.cursors.count
  const tracks: CursorTrack[] = Array.from({ length: n }, (_, who) => ({
    who,
    color: doc.theme.cursorPalette[who % doc.theme.cursorPalette.length],
    ...(doc.cursors.names?.[who] && { name: doc.cursors.names[who] }),
    spawn: null,
    stops: [],
    pos: [],
    scale: [],
    ripples: [],
    exit: null,
  }))
  const state = tracks.map(() => ({ x: 0, y: 0, free: 0 }))
  const unassigned: number[] = []
  let turn = 0
  const items = [...tl.items].sort((a, b) => a.tStart - b.tStart || a.index - b.index)

  for (const ti of items) {
    if (ti.action === 'none') continue
    const target = anchorOf(ti)
    const arrive = round(ti.tStart - p.lead)
    const hold = ti.action === 'drag' ? 0.3 * k + 0.04 : ti.action === 'type' ? Math.min(ti.tEnd - ti.tStart, 0.55 * k) : p.click
    // 能按时赶到的光标：已出场且空闲，或尚未出场（在元素附近弹出）
    const options = tracks
      .map((tr, who) => {
        const st = state[who]
        if (!tr.spawn) return { who, cost: 120 + (who === turn % n ? 0 : 160), ok: true }
        const need = moveDur(dist(st, target))
        return { who, cost: dist(st, target) + (who === turn % n ? 0 : 160), ok: st.free + need <= arrive + 1e-6 }
      })
      .filter((o) => o.ok)
    const forced = ti.item.cursor?.who
    const pick = options.find((o) => o.who === forced) ?? options.sort((a, b) => a.cost - b.cost)[0]
    if (!pick) {
      unassigned.push(ti.index)
      continue
    }
    turn++
    const tr = tracks[pick.who]
    const st = state[pick.who]
    let depart: number
    if (!tr.spawn) {
      // 在元素右下方附近弹出，短距离飞入
      const sp = { x: Math.min(720, target.x + 60), y: Math.min(tl.height - 40, target.y + 70) }
      const fly = Math.min(moveDur(dist(sp, target)), Math.max(0.12, arrive - p.spawn))
      const spawnT = round(Math.max(0, arrive - fly - p.spawn))
      tr.spawn = { t: spawnT, ...sp }
      tr.pos.push({ t: spawnT, v: `${r(sp.x)} ${r(sp.y)}` })
      tr.scale.push({ t: spawnT, v: 0 }, { t: spawnT + p.spawn * 0.65, v: 1.15, ease: 'out' }, { t: spawnT + p.spawn, v: 1, ease: 'inout' })
      depart = round(Math.max(spawnT + p.spawn, arrive - fly))
      st.x = sp.x
      st.y = sp.y
    } else {
      const need = moveDur(dist(st, target))
      depart = round(arrive - need)
      // 等待较久时在原地附近小幅漂移，避免僵住
      if (depart - st.free > 0.6) {
        const mid = round((st.free + depart) / 2)
        tr.pos.push({ t: mid, v: `${r(st.x + 10)} ${r(st.y - 8)}`, ease: 'inout' }, { t: depart, v: `${r(st.x)} ${r(st.y)}`, ease: 'inout' })
      } else tr.pos.push({ t: depart, v: `${r(st.x)} ${r(st.y)}` })
    }
    // 长距离移动加一点过冲
    const far = dist(st, target) > 200
    if (far) {
      const dx = (target.x - st.x) / dist(st, target)
      const dy = (target.y - st.y) / dist(st, target)
      tr.pos.push({ t: round(arrive - 0.05), v: `${r(target.x + dx * 7)} ${r(target.y + dy * 7)}`, ease: 'out' }, { t: arrive, v: `${r(target.x)} ${r(target.y)}`, ease: 'inout' })
    } else tr.pos.push({ t: arrive, v: `${r(target.x)} ${r(target.y)}`, ease: 'out' })

    const act = ti.tStart
    let end = { ...target }
    if (ti.action === 'click') {
      tr.scale.push({ t: act, v: 1 }, { t: act + p.click * 0.4, v: 0.8, ease: 'out' }, { t: act + p.click, v: 1, ease: 'out' })
      tr.ripples.push({ t: act, x: target.x, y: target.y })
    } else if (ti.action === 'drag') {
      // 按住拖到对角，和 drag-in 的选框同步
      end = { x: ti.box.x + ti.box.w, y: ti.box.y + ti.box.h }
      tr.scale.push({ t: act, v: 1 }, { t: act + 0.06, v: 0.88, ease: 'out' }, { t: act + 0.3 * k, v: 0.88 }, { t: act + 0.3 * k + 0.06, v: 1, ease: 'out' })
      tr.pos.push({ t: act, v: `${r(target.x)} ${r(target.y)}` }, { t: round(act + 0.3 * k), v: `${r(end.x)} ${r(end.y)}`, ease: 'out' })
      tr.ripples.push({ t: act, x: target.x, y: target.y })
    } else {
      // 打字：停在文字起点左下方
      end = { x: target.x - 14, y: target.y + 26 }
      tr.pos.push({ t: round(act + 0.08), v: `${r(end.x)} ${r(end.y)}`, ease: 'out' })
    }
    const free = round(act + hold)
    tr.stops.push({ item: ti.index, action: ti.action, depart, arrive, act, free, x: target.x, y: target.y })
    st.x = end.x
    st.y = end.y
    st.free = free
  }

  const active = tracks.filter((t) => t.spawn)
  let swarm: CursorPlan['swarm'] = null
  let end = tl.end
  if (scene.finale === 'swarm' && active.length) {
    const t = round(Math.max(tl.end, ...active.map((tr) => state[tr.who].free)) + 0.1)
    const last = tl.items[tl.items.length - 1]
    const fx = 375
    const fy = Math.min(tl.height - 140, Math.max(160, last ? last.box.y + last.box.h / 2 : tl.height / 2))
    const radius = 46
    swarm = { t, x: fx, y: fy, radius, members: active.map((a) => a.who) }
    active.forEach((tr, i) => {
      const st = state[tr.who]
      const a = (i / active.length) * Math.PI * 2
      const px = fx + Math.cos(a) * radius
      const py = fy + Math.sin(a) * radius
      tr.pos.push({ t, v: `${r(st.x)} ${r(st.y)}` }, { t: round(t + p.swarmGather), v: `${r(px)} ${r(py)}`, ease: 'out' })
      // 聚拢后由 swarm 层接替（同一位置），原光标隐藏
      tr.exit = { t: round(t + p.swarmGather), x: px, y: py }
    })
    end = round(t + p.swarmGather + p.swarmOrbit + p.swarmScatter)
  } else {
    for (const tr of active) {
      const st = state[tr.who]
      const t = round(Math.max(st.free + 0.12, tl.end - 0.1))
      const ex = st.x < 375 ? -60 : 810
      tr.pos.push({ t, v: `${r(st.x)} ${r(st.y)}` }, { t: round(t + p.exit), v: `${r(ex)} ${r(st.y - 40)}`, ease: 'in' })
      tr.scale.push({ t, v: 1 }, { t: round(t + p.exit), v: 0.6, ease: 'in' })
      tr.exit = { t: round(t + p.exit), x: ex, y: st.y - 40 }
      end = Math.max(end, round(t + p.exit))
    }
  }
  return { tracks, unassigned, swarm, end }
}

const r = (v: number) => Math.round(v * 10) / 10

// ---------- 渲染 ----------

/** 箭头光标（尖端在 0,0），深色描边 */
const ARROW = 'M0 0L0 25L6.5 19.5L11 29.5L15.5 27.5L11 17.5L19.5 17.5Z'

function cursorShape(color: string, name: string | undefined, ctx: RenderCtx): string {
  let out = el('path', { d: ARROW, fill: color, stroke: '#0a0f1c', 'stroke-width': 1.6, 'stroke-linejoin': 'round' })
  if (name) {
    const w = 20 + [...name].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x100 ? 8.5 : 15), 0)
    const ink = mix(color, '#000000', 0.78)
    out +=
      el('rect', { x: 14, y: 26, width: w, height: 24, rx: 6, fill: color }) +
      drawRun({ x: 14, y: 26, w, lines: [name], font: { size: 14, weight: 700, letterSpacing: 0 }, color: ink, lineHeight: 24, align: 'center' }, ctx).join('')
  }
  return out
}

export function renderCursors(plan: CursorPlan, ctx: RenderCtx): string {
  const p = paceTable(ctx.doc.playback.pace)
  const parts: string[] = []
  for (const tr of plan.tracks) {
    if (!tr.spawn) continue
    const hideAt = tr.exit?.t ?? plan.end
    const opacity: AnimSpec = { attr: 'opacity', discrete: true, keys: [{ t: tr.spawn.t - 0.001, v: 0 }, { t: tr.spawn.t, v: 1 }, { t: hideAt, v: 0 }] }
    const last = tr.pos[tr.pos.length - 1]
    const inner = group(ctx, {}, [{ attr: 'transform', transform: 'scale', keys: tr.scale }], cursorShape(tr.color, tr.name, ctx))
    parts.push(group(ctx, { transform: `translate(${last.v})`, opacity: 0 }, [{ attr: 'transform', transform: 'translate', keys: tr.pos }, opacity], inner))
    for (const rp of tr.ripples) {
      parts.push(
        shape('circle', { cx: rp.x, cy: rp.y, r: 28, fill: 'none', stroke: tr.color, 'stroke-width': 2.5, opacity: 0 }, ctx, [
          { attr: 'r', keys: [{ t: rp.t, v: 4 }, { t: rp.t + p.ripple, v: 28, ease: 'out' }] },
          { attr: 'opacity', keys: [{ t: rp.t - 0.001, v: 0 }, { t: rp.t, v: 0.9 }, { t: rp.t + p.ripple, v: 0, ease: 'linear' }] },
        ]),
      )
    }
  }
  if (plan.swarm) parts.push(renderSwarm(plan, ctx))
  return parts.join('')
}

/**
 * 收尾 swarm：外层 scale 控制半径（先收拢再散开），中层 rotate 绕圈，
 * 每个光标内层反向 rotate 保持朝向、反向 scale 保持大小。
 */
function renderSwarm(plan: CursorPlan, ctx: RenderCtx): string {
  const sw = plan.swarm!
  const p = paceTable(ctx.doc.playback.pace)
  const t0 = sw.t + p.swarmGather
  const t1 = t0 + p.swarmOrbit
  const t2 = t1 + p.swarmScatter
  const sKeys: Key[] = [{ t: t0, v: 1 }, { t: t0 + p.swarmOrbit * 0.5, v: 0.7, ease: 'inout' }, { t: t1, v: 1, ease: 'inout' }, { t: t2, v: 6, ease: 'in' }]
  const inv: Key[] = sKeys.map((x) => ({ ...x, v: Math.round((1 / Number(x.v)) * 1000) / 1000 }))
  const rot: Key[] = [{ t: t0, v: 0 }, { t: t1, v: 360, ease: 'inout' }]
  const counter: Key[] = [{ t: t0, v: 0 }, { t: t1, v: -360, ease: 'inout' }]
  const members = sw.members
    .map((who, i) => {
      const tr = plan.tracks[who]
      const a = (i / sw.members.length) * Math.PI * 2
      const pos = `translate(${r(Math.cos(a) * sw.radius)} ${r(Math.sin(a) * sw.radius)})`
      const body = group(ctx, {}, [{ attr: 'transform', transform: 'scale', keys: inv }], cursorShape(tr.color, tr.name, ctx))
      return `<g transform="${pos}">${group(ctx, {}, [{ attr: 'transform', transform: 'rotate', keys: counter }], body)}</g>`
    })
    .join('')
  const orbit = group(ctx, {}, [{ attr: 'transform', transform: 'rotate', keys: rot }], members)
  const scaled = group(ctx, {}, [{ attr: 'transform', transform: 'scale', keys: sKeys }], orbit)
  return group(
    ctx,
    { transform: `translate(${sw.x} ${sw.y})`, opacity: 0 },
    [{ attr: 'opacity', keys: [{ t: t0 - 0.001, v: 0 }, { t: t0, v: 1 }, { t: t1 + p.swarmScatter * 0.4, v: 1 }, { t: t2, v: 0, ease: 'linear' }] }],
    scaled,
  )
}
