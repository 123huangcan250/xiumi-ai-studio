// SMIL 序列化：动画一律写成“绝对时间关键帧”，按播放模式输出 <animate> / <animateTransform> / <set>。
// 约定：元素的基础属性写终态；动画从 0 开始计时，起点前用保持帧压回初始态。
// 这样即使动画被过滤，也会退化为静态成稿，而不是空白。

export type PlayMode =
  /** 方案 B：加载后自动播放一次，结束定格 */
  | { kind: 'once' }
  /** 方案 B 循环：所有动画共用同一个 dur，repeatCount = indefinite */
  | { kind: 'loop'; cycle: number }
  /** 方案 A：点击触发（依赖 id），cycle 存在时点击后循环；replay：另一个按钮从本模块的开始时间重播 */
  | { kind: 'tap'; trigger: string; cycle?: number; replay?: { id: string; offset: number } }

export type Ease = 'out' | 'in' | 'inout' | 'linear'

export interface Key {
  t: number
  v: string | number
  /** 到达这一帧的缓动（spline 模式） */
  ease?: Ease
}

export interface AnimSpec {
  attr: string
  keys: Key[]
  discrete?: boolean
  /** 有值时输出 animateTransform */
  transform?: 'translate' | 'scale' | 'rotate'
}

/** 急起缓停：0.2 0.9 0.1 1 */
export const SPLINES: Record<Ease, string> = { out: '0.2 0.9 0.1 1', in: '0.6 0 0.9 0.4', inout: '0.45 0 0.2 1', linear: '0 0 1 1' }

const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}
const val = (v: string | number) => (typeof v === 'number' ? fmt(v) : v)
/** 时间保留 3 位小数 */
const sec = (t: number) => `${Math.round(t * 1000) / 1000}s`

export function smil(spec: AnimSpec, mode: PlayMode): string {
  const keys = [...spec.keys].map((k) => ({ ...k, t: Math.max(0, k.t) })).sort((a, b) => a.t - b.t)
  if (!keys.length) return ''
  const values = keys.map((k) => val(k.v))
  if (values.every((v) => v === values[0])) return ''
  if (keys[0].t > 0) keys.unshift({ t: 0, v: keys[0].v, ease: 'linear' })
  const cycle = mode.kind === 'loop' ? mode.cycle : mode.kind === 'tap' ? mode.cycle : undefined
  let end = keys[keys.length - 1].t
  if (cycle !== undefined) {
    if (end < cycle) keys.push({ t: cycle, v: keys[keys.length - 1].v, ease: 'linear' })
    end = Math.max(end, cycle)
  }
  end = Math.max(end, 0.001)
  // keyTimes 必须从 0 到 1 单调不减；同一时刻的两帧（跳变）保留先后顺序
  const kt: number[] = []
  for (const k of keys) {
    let x = Math.round((k.t / end) * 100000) / 100000
    if (kt.length && x <= kt[kt.length - 1]) x = Math.min(1, kt[kt.length - 1] + 0.00001)
    kt.push(x)
  }
  kt[0] = 0
  kt[kt.length - 1] = 1
  const attrs: string[] = []
  if (spec.transform) attrs.push(`attributeName="transform"`, `type="${spec.transform}"`)
  else attrs.push(`attributeName="${spec.attr}"`)
  attrs.push(`begin="${begin(mode)}"`, `dur="${sec(end)}"`)
  attrs.push(`values="${keys.map((k) => val(k.v)).join(';')}"`, `keyTimes="${kt.join(';')}"`)
  if (spec.discrete) attrs.push('calcMode="discrete"')
  else attrs.push('calcMode="spline"', `keySplines="${keys.slice(1).map((k) => SPLINES[k.ease ?? 'linear']).join(';')}"`)
  if (cycle !== undefined) attrs.push('repeatCount="indefinite"')
  else attrs.push('fill="freeze"')
  return `<${spec.transform ? 'animateTransform' : 'animate'} ${attrs.join(' ')}/>`
}

/** 开始时间：重播按钮用负偏移，让动画直接跳到本模块开始的那一刻（关键帧都按触发后的绝对时间写） */
function begin(mode: PlayMode): string {
  if (mode.kind !== 'tap') return '0s'
  const r = mode.replay
  return `${mode.trigger}.click` + (r ? `;${r.id}.click${r.offset > 0 ? `-${Math.round(r.offset * 1000) / 1000}s` : ''}` : '')
}

/** 常用：在 t 时刻从 a 跳到 b（离散） */
export const jump = (attr: string, t: number, a: string | number, b: string | number): AnimSpec => ({ attr, discrete: true, keys: [{ t: Math.max(0, t - 0.001), v: a }, { t, v: b }] })
