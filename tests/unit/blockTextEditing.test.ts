import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { blockTextFields, textFieldPatch } from '../../src/core/blockTextEditing'

describe('block text editing without image changes', () => {
  it('exposes captions and labels of image blocks including empty captions', () => {
    expect(blockTextFields(createBlock('image')).map((f) => f.key)).toEqual(['caption'])
    expect(blockTextFields(createBlock('gallery')).map((f) => f.key)).toEqual(['caption'])
    expect(blockTextFields(createBlock('frame')).map((f) => f.key)).toEqual(['caption', 'label'])
    expect(blockTextFields(createBlock('carousel')).map((f) => f.key)).toEqual(['label', 'pics.0.caption', 'pics.1.caption', 'pics.2.caption'])
    expect(blockTextFields(createBlock('photos')).map((f) => f.key)).toEqual(['pics.0.caption', 'pics.1.caption'])
  })
  it('changes only the requested photo caption and preserves all image references', () => {
    const image = { src: '/media/example.jpg', assetId: 'a', alt: 'keep', width: 900, height: 600 }
    const block = createBlock('photos', { pics: [{ image, caption: 'old' }, { image: { ...image, src: '/media/second.jpg' }, caption: 'other' }] })
    const before = structuredClone(block)
    const patch = textFieldPatch(block, 'pics.0.caption', '  新图注\n第二行 ')
    expect(patch).toEqual({ pics: [{ image, caption: '  新图注\n第二行 ' }, block.props.pics[1]] })
    expect(block).toEqual(before)
    expect({ ...block.props, ...patch }).toMatchObject({ count: 2, layout: 'even', ratio: '4:3' })
  })
  it('rejects non-text image or layout keys', () => {
    const block = createBlock('image', { image: { src: '/media/keep.jpg' } })
    expect(textFieldPatch(block, 'image.src', 'new')).toEqual({})
    expect(textFieldPatch(block, 'variant', 'rounded')).toEqual({})
    expect(textFieldPatch(block, 'caption', '')).toEqual({ caption: '' })
  })
  it('supports ordinary structured text but leaves rich text and HTML to their editors', () => {
    expect(blockTextFields(createBlock('heading')).some((f) => f.key === 'title')).toBe(true)
    expect(blockTextFields(createBlock('table')).some((f) => f.key === 'rows.0.0')).toBe(true)
    expect(blockTextFields(createBlock('timeline')).some((f) => f.key === 'items.0.desc')).toBe(true)
    for (const type of ['paragraph', 'card', 'imageText', 'html', 'divider'] as const) expect(blockTextFields(createBlock(type))).toEqual([])
  })
})
