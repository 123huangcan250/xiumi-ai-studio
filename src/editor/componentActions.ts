// 组件库的操作：画布、左侧面板和拖放共用，放在这里避免循环依赖。
import { componentBlock, type ComponentOrigin } from '../core/components'
import { collectColors, docMainColors, harmonize, recolorHtml } from '../core/recolor'
import { resolveTheme } from '../core/themes'
import type { Block, ContentSource } from '../core/types'
import { useStore } from './store'

export const parseDoc = (s: string) => new DOMParser().parseFromString(s, 'text/html')

/** 把组件插入文档：重新清洗并分配新 id；开启匹配配色时统一到本文主色 */
export function insertComponent(block: Block, opts: { index?: number; missing?: string[] } = {}) {
  const s = useStore.getState()
  let b = componentBlock(block, parseDoc)
  if (s.matchColors && b.type === 'html') {
    const map = harmonize(collectColors(b.props.html, parseDoc), docMainColors(s.doc.blocks, resolveTheme(s.doc), parseDoc))
    b = { ...b, props: { ...b.props, html: recolorHtml(b.props.html, map, parseDoc) } }
  }
  s.insertBlock(b, opts.index)
  if (opts.missing?.length) s.notify(`这个组件有 ${opts.missing.length} 张图片已从素材库删除，显示不出来，请替换`, 'error')
}

export interface CollectRequest {
  block: Block
  /** 已在画布上选好的子结构 */
  fragment?: string
  via: ComponentOrigin['via']
  /** 模板部件等没有记录来源时的预填 */
  source?: Partial<ContentSource>
}

export const openCollect = (detail: CollectRequest) => window.dispatchEvent(new CustomEvent('open-collect', { detail }))
