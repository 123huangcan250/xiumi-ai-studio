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
  /** 蓝图网格（可选）：线条颜色与间距 */
  grid?: { color: string; size: number }
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
  /** 用文档里内嵌的字形路径绘制（见 ReplayDoc.glyphs），缺字时回退为普通文字 */
  face?: string
}

/** 一个字的轮廓：d 以 1000 为字号、基线在 y = 0（向下为正），adv 为步进宽度 */
export interface Glyph {
  d: string
  adv: number
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
  /** 文案；stat 为最终数值（可带前后缀，如 "98%"、"3.2万"）。文字类元素可用 **关键词** 标出重点 */
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
  /** 收尾：光标各自离场，或全部聚到焦点绕圈后散开 */
  finale: 'exit' | 'swarm'
  /** 下一个元素在上一个完成到这个比例时开始（默认 0.6；1 = 依次出现，适合逐段打字的正文） */
  overlap?: number
  /** 上下留白（默认 88 / 96），正文场景可以收紧 */
  padding?: number
  /** 元素之间的间距（不填按类型取默认值） */
  gap?: number
  items: ReplayItem[]
}

export interface ReplayDoc {
  canvas: { width: 750; background: ReplayBackground }
  /** trigger：auto = 方案 B（begin="Xs" 自动播放）；tap = 方案 A（begin="id.click+Xs"，依赖 id 保留） */
  playback: {
    trigger: 'auto' | 'tap'
    loop?: { hold: number }
    pace: Pace
    /** 开始前等待的秒数：同一篇里多个回放可以接力，依次播放（所有 SVG 从页面加载起共用同一个时钟） */
    start?: number
    /** trigger = tap 时由文章里另一个元素（如开头的“开始阅读”按钮）触发：填它的 id，不再画本模块自己的“点击开始” */
    triggerId?: string
    /** 右上角显示 ↻，轻触后本模块从头重播（依赖 id） */
    replay?: boolean
    /** 正文打字速度（字/秒），不填按节奏档位 */
    typeSpeed?: number
  }
  textMode: TextMode
  theme: { accent: string; inspector: string; alert: string; text: string; cursorPalette: string[] }
  cursors: { count: number; names?: string[]; show: boolean }
  /** 体积预算（KB），导出时超出则警告；默认值是估计值，上限待公众号后台实测 */
  budget: { sceneKB: number; totalKB: number }
  scenes: ReplayScene[]
  /** 特殊字体的字形路径（只存用到的字）：不需要字体文件和图片，秀米、公众号都能显示 */
  glyphs?: Record<string, Record<string, Glyph>>
}

// 时间轴（TimedItem / Timeline）由引擎生成，定义在 schedule.ts；光标轨迹定义在 cursors.ts
