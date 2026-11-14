import type { ImageRef } from './types'
/** Percentage within the existing image cell, not source pixel dimensions. */
export const clampImageWidth = (width: number) => Math.max(10, Math.min(100, Math.round(width * 10) / 10))
export function validImageWidth(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 10 && value <= 100 ? clampImageWidth(value) : undefined
}
/** Called at the exact image renderer with its own ref; never infer images by output order. */
export function applyImageWidths(tag: string, image: ImageRef | undefined): string {
  const width = validImageWidth(image?.displayWidth)
  if (width === undefined) return tag
  const size = `width:${width}%;max-width:100%;height:auto;`
  let result = tag.replace(/\s(?:width|height)=(?:"[^"]*"|'[^']*')/gi, '')
  const style = /\sstyle=("([^"]*)"|'([^']*)')/i
  if (style.test(result)) result = result.replace(style, (_m, _q, double: string, single: string) => {
    const kept = (double ?? single).split(';').filter(decl => !/^\s*(width|max-width|height)\s*:/i.test(decl) && decl.trim()).join(';')
    return ` style="${kept ? kept + ';' : ''}${size}"`
  })
  else result = result.replace(/\s*\/?>(\s*)$/, ` style="${size}">$1`)
  return result
}
