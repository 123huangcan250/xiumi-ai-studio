// 时间轴引擎：只根据元素和节奏排期，不读取任何光标数据。
import { layoutScene, type LaidItem } from './layout'
import { paceTable, presetDuration } from './pace'
import { defaultAction, DEFAULT_PRESET } from './schema'
import type { CursorAction, EnterPreset, ReplayDoc, ReplayItem, ReplayScene } from './types'

export interface TimedItem extends LaidItem {
  preset: EnterPreset
  /** 光标动作（none 表示不派光标） */
  action: CursorAction
  tStart: number
  tEnd: number
}

export interface Timeline {
  items: TimedItem[]
  height: number
  overflow: boolean
  /** 最后一个元素完成的时间 */
  end: number
}

/** 预设对元素类型不适用时的替代（例如给按钮选了“打字”） */
export function effectivePreset(item: ReplayItem): EnterPreset {
  const p = item.enter ?? DEFAULT_PRESET[item.type]
  const texty = item.type === 'title' || item.type === 'subtitle' || item.type === 'text' || item.type === 'quote'
  if (p === 'type-on' && !texty) return 'pop'
  if (p === 'count-up' && item.type !== 'stat') return 'pop'
  if (p === 'drag-in' && item.type === 'divider') return 'inspect-draw'
  return p
}

const chars = (item: ReplayItem) => [...item.content.replace(/\*\*/g, '').replace(/\s+/g, '')].length

/**
 * 给每个元素算出 tStart / tEnd：下一个元素在上一个完成约 60% 时开始（相邻重叠），
 * delay 在自动排期基础上偏移，并顺延后面的元素。
 */
export function scheduleScene(scene: ReplayScene, doc: ReplayDoc): Timeline {
  const pace = doc.playback.pace
  const t = paceTable(pace)
  const layout = layoutScene(scene, doc)
  const start = doc.playback.start ?? 0
  const overlap = scene.overlap ?? t.overlap
  let prevStart = -1
  let prevDur = 0
  const items: TimedItem[] = layout.items.map((l) => {
    const preset = effectivePreset(l.item)
    const speed = doc.playback.typeSpeed
    const dur = presetDuration(preset, pace, chars(l.item), l.item.type === 'text' || l.item.type === 'quote', speed ? 1 / speed : undefined)
    const auto = prevStart < 0 ? start + t.intro : prevStart + prevDur * overlap
    const tStart = round(Math.max(0, auto + (l.item.delay ?? 0)))
    prevStart = tStart
    prevDur = dur
    const action = l.item.cursor?.action ?? defaultAction(preset)
    return { ...l, preset, action, tStart, tEnd: round(tStart + dur) }
  })
  return { items, height: layout.height, overflow: layout.overflow, end: round(Math.max(start + t.intro, ...items.map((i) => i.tEnd))) }
}

export const round = (v: number) => Math.round(v * 1000) / 1000
