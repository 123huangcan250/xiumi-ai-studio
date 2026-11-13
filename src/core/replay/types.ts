// 「编辑回放」动效模板的数据模型：把一篇推文的写作过程做成 SVG（SMIL）动画回放。
// 作为普通模块（BlockType = 'replay'）接入文档，属性即 ReplayDoc；字段说明见 docs/edit-replay/INTEGRATION.md。
import type { ImageRef } from '../types'

export type ReplayItemType = 'title' | 'subtitle' | 'text' | 'image' | 'tag' | 'button' | 'stat' | 'quote' | 'divider' | 'shape'
export type EnterPreset = 'inspect-draw' | 'glitch-settle' | 'type-on' | 'drag-in' | 'pop' | 'count-up' | 'select-highlight' | 'alert-box'
export type Pace = 'fast' | 'turbo' | 'normal'
export type TextMode = 'image' | 'svg-text'
export type CursorAction = 'click' | 'drag' | 'type' | 'none'

export interface ReplayBackground {
  type: 'color' | 'gradient' | 'image'
  /** color：#RRGGBB；gradient：自上而下的颜色，逗号分隔（如 "#0a0f1f,#12305a"） */
  value: string
  /** type = image 时的背景图（素材库或微信图片） */
  image?: ImageRef
}

export interface ReplayStyle {
  color: string
  /** 背景色（按钮、标签、卡片底色）；空字符串表示透明 */
  fill: string
  stroke: string
  fontSize: number
  fontWeight: 400 | 700
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  radius: number
}

export interface ReplayFrame {
  x: number
  y: number
  w: number
  h?: number
}

export interface ReplayItem {
  /** 界面排序用的稳定 id，不会输出到 SVG */
  id: string
  type: ReplayItemType
  /** 文案；stat 为最终数值（可带前后缀，如 "98%"、"3.2万"） */
  content: string
  /** stat 的说明文字、quote 的出处、image 的图注 */
  label?: string
  image?: ImageRef
  /** absolute 布局时使用；flow 布局时自动计算 */
  frame?: ReplayFrame
  style?: Partial<ReplayStyle>
  /** 不填则按 type 取默认预设 */
  enter?: EnterPreset
  /** 相对自动排期的偏移（秒，可为负） */
  delay?: number
  cursor?: { action?: CursorAction; who?: number }
}

export interface ReplayScene {
  id: string
  /** 不填时 flow 布局按内容自动计算，absolute 布局默认 1100 */
  height?: number
  layout: 'flow' | 'absolute'
  items: ReplayItem[]
}

export interface ReplayDoc {
  canvas: { width: 750; background: ReplayBackground }
  /** trigger：auto = 方案 B（begin="Xs" 自动播放）；tap = 方案 A（begin="id.click+Xs"，依赖 id 保留） */
  playback: { trigger: 'auto' | 'tap'; loop?: { hold: number }; pace: Pace }
  textMode: TextMode
  theme: { accent: string; inspector: string; alert: string; text: string; cursorPalette: string[] }
  cursors: { count: number; names?: string[]; show: boolean }
  /** 体积预算（KB），导出时超出则警告；默认值是估计值，上限待公众号后台实测 */
  budget: { sceneKB: number; totalKB: number }
  scenes: ReplayScene[]
}

// ---------- 时间轴（引擎输出，与光标无关） ----------

export interface TimedItem {
  item: ReplayItem
  index: number
  /** 布局后的位置与尺寸（SVG 坐标，宽 750） */
  box: { x: number; y: number; w: number; h: number }
  preset: EnterPreset
  tStart: number
  tEnd: number
}

export interface Timeline {
  items: TimedItem[]
  /** 场景高度 */
  height: number
  /** 最后一个元素完成的时间 */
  end: number
}

// ---------- 光标轨迹（由时间轴反推，只用于展示） ----------

export interface CursorStop {
  /** 到达时间 */
  t: number
  x: number
  y: number
  action: CursorAction
  /** 对应的元素序号 */
  item: number
}

export interface CursorTrack {
  who: number
  color: string
  name?: string
  spawn: { t: number; x: number; y: number }
  stops: CursorStop[]
  exit: { t: number; x: number; y: number }
}
