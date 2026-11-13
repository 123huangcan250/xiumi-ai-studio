// 节奏参数：所有时长集中在这里调整。数值为 fast 档（秒），其他档位整体缩放。
import type { EnterPreset, Pace } from './types'

export const PACE_BASE = {
  /** 开场只显示背景板的时间 */
  intro: 0.3,
  /** 下一个元素在上一个完成到这个比例时开始 */
  overlap: 0.6,
  /** 光标弹出（0 → 1.15 → 1） */
  spawn: 0.15,
  /** 光标单段移动：按距离在区间内取值 */
  moveMin: 0.22,
  moveMax: 0.38,
  /** 光标比元素开始时间提前到达 */
  lead: 0.06,
  /** 点击：光标缩小回弹 */
  click: 0.16,
  /** 点击涟漪 */
  ripple: 0.25,
  /** 线框描边 */
  stroke: 0.28,
  /** 标题打字：每字 */
  typePerChar: 0.024,
  typeMin: 0.35,
  typeMax: 1.3,
  /** 光标离场 */
  exit: 0.28,
  /** 收尾 swarm：聚拢、绕圈、散开 */
  swarmGather: 0.32,
  swarmOrbit: 0.8,
  swarmScatter: 0.36,
} as const

export type PaceTable = { -readonly [K in keyof typeof PACE_BASE]: number }

/** turbo 整体压缩约 35%，normal 放慢约 40% */
export const PACE_SCALE: Record<Pace, number> = { fast: 1, turbo: 0.65, normal: 1.4 }

/** 进场预设的基础时长（fast 档，type-on 另按字数计算） */
export const PRESET_BASE: Record<EnterPreset, number> = {
  'inspect-draw': 0.7,
  'glitch-settle': 0.5,
  'type-on': 0.6,
  'drag-in': 0.62,
  pop: 0.4,
  'count-up': 0.7,
  'select-highlight': 0.72,
  'alert-box': 0.56,
}

export function paceTable(p: Pace): PaceTable {
  const k = PACE_SCALE[p] ?? 1
  const out = {} as PaceTable
  for (const [key, v] of Object.entries(PACE_BASE)) out[key as keyof PaceTable] = key === 'overlap' ? v : v * k
  return out
}

export function presetDuration(preset: EnterPreset, p: Pace, chars = 0): number {
  const k = PACE_SCALE[p] ?? 1
  if (preset === 'type-on') {
    const t = paceTable(p)
    return Math.min(t.typeMax, Math.max(t.typeMin, chars * t.typePerChar)) + 0.12 * k
  }
  return PRESET_BASE[preset] * k
}
