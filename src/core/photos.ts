// 文档里的照片位置：按模块渲染后 <img> 的先后编号（与编译结果一致）。
// 用于在画布上拖动照片互换位置、把素材拖到某张照片上替换；原文片段里换照片时按原相框比例裁切。
import { extractSlots, fillSlots, type Parse } from './slots'
import type { Block, Doc, ImageRef } from './types'

export interface PhotoPos {
  blockId: string
  index: number
}

/** 只有一张图的内置模块（结尾的图通常是二维码，不参与移动） */
const SINGLE = new Set(['image', 'imageText', 'profile', 'cover'])

/** 本地素材去掉裁切参数，换到新位置时按新位置重新裁切 */
const baseSrc = (src: string) => (src.startsWith('/media/') ? src.split('?')[0] : src)

/** 从 /media/x.jpg?fit=100:68 中读出原相框的高宽比 */
export function fitRatio(src: string): number | undefined {
  const m = decodeURIComponent(src).match(/[?&]fit=(\d+):(\d+)/)
  return m ? Number(m[2]) / Number(m[1]) : undefined
}

/** 模块里按 <img> 顺序排列的照片；装饰图、二维码为 null（不可移动） */
export function blockPhotos(block: Block, parse?: Parse): (ImageRef | null)[] {
  if (block.type === 'html') return extractSlots(block.props.html, parse).flatMap((s) => (s.kind === 'image' ? [s.decor ? null : { src: s.src }] : []))
  if (block.type === 'gallery') return block.props.images
  const image = (block.props as { image?: ImageRef }).image
  if (!image) return []
  return [SINGLE.has(block.type) ? image : null]
}

/** 把一张照片放到模块的第 index 张图的位置；ratio 为该位置相框的高宽比（原文片段用） */
export function setPhoto(block: Block, index: number, ref: ImageRef, opts: { ratio?: number; parse?: Parse } = {}): Block {
  if (block.type === 'html') {
    const slot = extractSlots(block.props.html, opts.parse).filter((s) => s.kind === 'image')[index]
    if (!slot) return block
    const r = fitRatio(slot.src) ?? opts.ratio
    const html = fillSlots(block.props.html, { [slot.id]: { src: baseSrc(ref.src) } }, { parse: opts.parse, ratios: r ? { [slot.src]: r } : undefined })
    return { ...block, props: { ...block.props, html } }
  }
  const clean: ImageRef = { ...ref, src: baseSrc(ref.src) }
  if (block.type === 'gallery') {
    if (index >= block.props.images.length) return block
    return { ...block, props: { ...block.props, images: block.props.images.map((im, i) => (i === index ? clean : im)) } }
  }
  if (SINGLE.has(block.type) && index === 0) return { ...block, props: { ...block.props, image: clean } } as Block
  return block
}

const photoAt = (doc: Doc, pos: PhotoPos, parse?: Parse) => {
  const b = doc.blocks.find((x) => x.id === pos.blockId)
  return b ? (blockPhotos(b, parse)[pos.index] ?? null) : null
}

/** 交换两张照片的位置；各自按所在相框重新裁切 */
export function swapPhotos(doc: Doc, a: PhotoPos, b: PhotoPos, opts: { ratioA?: number; ratioB?: number; parse?: Parse } = {}): Doc {
  if (a.blockId === b.blockId && a.index === b.index) return doc
  const pa = photoAt(doc, a, opts.parse)
  const pb = photoAt(doc, b, opts.parse)
  if (!pa || !pb) return doc
  const blocks = doc.blocks
    .map((x) => (x.id === a.blockId ? setPhoto(x, a.index, pb, { ratio: opts.ratioA, parse: opts.parse }) : x))
    .map((x) => (x.id === b.blockId ? setPhoto(x, b.index, pa, { ratio: opts.ratioB, parse: opts.parse }) : x))
  return { ...doc, blocks }
}

/** 用新照片替换某个位置（从素材库拖入） */
export function replacePhoto(doc: Doc, pos: PhotoPos, ref: ImageRef, opts: { ratio?: number; parse?: Parse } = {}): Doc {
  if (!photoAt(doc, pos, opts.parse)) return doc
  return { ...doc, blocks: doc.blocks.map((x) => (x.id === pos.blockId ? setPhoto(x, pos.index, ref, opts) : x)) }
}
