import { blockPhotos, type PhotoPos } from '../core/photos'
import { clampImageWidth } from '../core/imageResize'
import { findBlock, updateBlock } from '../core/tree'
import type { Block, Doc, ImageRef } from '../core/types'
export interface ResizeTarget { img: HTMLImageElement; pos: PhotoPos; block: Block; docId: string }
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const base = (src: string) => src.startsWith('/media/') ? src.split('?')[0] : src
/** Reuse existing photo indices, but fail closed if the rendered mapping is ambiguous. */
export function resolveResizeTarget(img: HTMLImageElement, doc: Doc): ResizeTarget | null {
  const host = img.closest<HTMLElement>('[data-block-id]')
  const body = img.closest('.block-html')
  if (!host || !body || body.closest('[data-block-id]') !== host) return null
  const block = findBlock(doc.blocks, host.dataset.blockId!)?.block
  if (!block || block.type === 'box' || block.type === 'replay') return null
  const images = [...body.querySelectorAll<HTMLImageElement>('img')]
  const originals = block.type === 'html' ? [...parse(block.props.html).querySelectorAll('img')] : null
  const photos = originals ? originals.map(image => image.closest('svg') ? null : { src: image.getAttribute('src') ?? '' }) : blockPhotos(block, parse)
  if (!originals && !/^\d+$/.test(img.dataset.photo ?? '')) return null
  const index = originals ? images.indexOf(img) : Number(img.dataset.photo)
  if (images.length !== photos.length || images[index] !== img || !photos[index]) return null
  if (images.some((image, i) => photos[i] && base(image.getAttribute('src') ?? '') !== base(photos[i]!.src))) return null
  return { img, pos: { blockId: block.id, index }, block, docId: doc.id }
}
/** Pure document update; image dimensions and source/crop URL stay unchanged. */
export function resizePhoto(doc: Doc, pos: PhotoPos, width: number): Doc {
  if (!Number.isFinite(width) || !Number.isInteger(pos.index) || pos.index < 0) return doc
  const block = findBlock(doc.blocks, pos.blockId)?.block
  const htmlImage = block?.type === 'html' ? parse(block.props.html).querySelectorAll('img')[pos.index] : null
  const photo: ImageRef | null | undefined = htmlImage ? (htmlImage.closest('svg') ? null : { src: htmlImage.getAttribute('src') ?? '' }) : block && blockPhotos(block, parse)[pos.index]
  if (!block || !photo) return doc
  const percent = clampImageWidth(width)
  let next: Block
  if (block.type === 'html') {
    const parsed = parse(block.props.html), img = parsed.querySelectorAll('img')[pos.index]
    if (!img || base(img.getAttribute('src') ?? '') !== base(photo.src)) return doc
    if (img.style.width === `${percent}%` && img.style.height === 'auto' && img.style.maxWidth === '100%') return doc
    img.style.width = `${percent}%`; img.style.maxWidth = '100%'; img.style.height = 'auto'
    img.removeAttribute('width'); img.removeAttribute('height')
    next = { ...block, props: { ...block.props, html: parsed.body.innerHTML } }
  } else {
    if (photo.displayWidth === percent) return doc
    const image = { ...photo, displayWidth: percent }
    if (block.type === 'gallery') next = { ...block, props: { ...block.props, images: block.props.images.map((p, i) => i === pos.index ? image : p) } }
    else if (block.type === 'photos' || block.type === 'carousel') next = { ...block, props: { ...block.props, pics: block.props.pics.map((p, i) => i === pos.index ? { ...p, image } : p) } } as Block
    else if (['image', 'imageText', 'profile', 'cover', 'frame'].includes(block.type) && pos.index === 0) next = { ...block, props: { ...block.props, image } } as Block
    else return doc
  }
  return { ...doc, blocks: updateBlock(doc.blocks, pos.blockId, () => next) }
}
