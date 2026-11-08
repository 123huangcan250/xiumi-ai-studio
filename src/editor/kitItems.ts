// 左侧「清华电机 · 德国实践」套件：双图 / 三图 / 四图是同一种模块的不同预设。
import { createBlock } from '../core/blocks'
import type { Block } from '../core/types'

const empty = (n: number) => Array.from({ length: n }, () => ({ caption: '' }))

export interface KitItem {
  key: string
  label: string
  icon: string
  make: () => Block
}

export const KIT_ITEMS: KitItem[] = [
  { key: 'box', label: '大型文本框', icon: '▭', make: () => createBlock('box') },
  { key: 'carousel', label: '轮播', icon: '⇆', make: () => createBlock('carousel') },
  { key: 'frame', label: '图片框', icon: '⧈', make: () => createBlock('frame') },
  { key: 'photos2', label: '双图', icon: '◫', make: () => createBlock('photos', { count: 2, layout: 'even', pics: empty(2) }) },
  { key: 'photos3', label: '三图', icon: '⬒', make: () => createBlock('photos', { count: 3, layout: 'feature', pics: empty(3) }) },
  { key: 'photos4', label: '四图', icon: '⊞', make: () => createBlock('photos', { count: 4, layout: 'even', pics: empty(4) }) },
]

export const KIT_THEME_ID = 'thu-eea-de'
