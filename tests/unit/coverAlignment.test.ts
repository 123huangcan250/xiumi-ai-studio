// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { coerceProps, createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
import { EDIT_SYSTEM } from '../../server/ai'

const title = '秋日读书会 在清华园里，与一本书相遇'
describe('cover title alignment', () => {
  it.each(['auto', 'hero', 'band', 'minimal'] as const)('centers only the title in %s and survives reload normalization', (variant) => {
    const original = createBlock('cover', { title, variant, image: { src: '/media/keep.jpg' } })
    const patch = coerceProps('cover', { titleAlign: 'center' }, true)
    expect(patch).toEqual({ titleAlign: 'center' })
    const [block] = normalizeBlocks([{ ...original, props: { ...original.props, ...patch } }])
    const before = new DOMParser().parseFromString(compileBlock(original, THEMES[0]), 'text/html')
    const after = new DOMParser().parseFromString(compileBlock(block, THEMES[0]), 'text/html')
    const heading = [...after.querySelectorAll('p')].find(p => p.textContent === title)!
    expect(heading.style.textAlign).toBe('center')
    const oldHeading = [...before.querySelectorAll('p')].find(p => p.textContent === title)!
    oldHeading.style.textAlign = 'center'
    expect(heading.style.cssText).toBe(oldHeading.style.cssText)
    heading.remove()
    oldHeading.remove()
    expect(after.body.innerHTML).toBe(before.body.innerHTML)
    expect(block.props).toMatchObject({ image: original.props.image })
  })
  it('supports left/right and restores the unchanged legacy layout with auto', () => {
    const legacy = createBlock('cover', { title, variant: 'minimal' })
    delete legacy.props.titleAlign
    const html = compileBlock(legacy, THEMES[0])
    expect(compileBlock(createBlock('cover', { ...legacy.props, titleAlign: 'auto' }), THEMES[0])).toBe(html)
    for (const titleAlign of ['left', 'right'] as const) {
      const [block] = normalizeBlocks([{ ...legacy, props: { ...legacy.props, titleAlign } }])
      const dom = new DOMParser().parseFromString(compileBlock(block, THEMES[0]), 'text/html')
      expect([...dom.querySelectorAll('p')].find(p => p.textContent === title)!.style.textAlign).toBe(titleAlign)
    }
  })
  it('advertises the real title alignment field to AI and rejects invalid values', () => {
    expect(EDIT_SYSTEM).toContain('titleAlign:auto|left|center|right')
    expect(coerceProps('cover', { titleAlign: 'invalid' }, true)).toEqual({ titleAlign: 'auto' })
  })
})
