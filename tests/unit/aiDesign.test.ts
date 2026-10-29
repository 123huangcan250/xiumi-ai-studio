import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SECTION_LAYOUTS, buildFromDesign, normalizeDesign, outlineBrief } from '../../src/core/aiDesign'
import { lum } from '../../src/core/color'
import { compileDoc } from '../../src/core/compiler'
import { parseArticle } from '../../src/core/outline'
import type { ImageRef } from '../../src/core/types'

const text = readFileSync(join(import.meta.dirname, '..', '..', 'samples', 'activity.txt'), 'utf8')
const o = parseArticle(text)
const images: ImageRef[] = Array.from({ length: 10 }, (_, i) => ({ src: `/media/p${i}.jpg`, width: 1600, height: 1067 }))
const usedImages = (blocks: any[]) => {
  const s = new Set<string>()
  for (const b of blocks) {
    if (b.props.image) s.add(b.props.image.src)
    b.props.images?.forEach((i: ImageRef) => s.add(i.src))
  }
  return s.size
}

describe('normalizeDesign', () => {
  it('repairs garbage input into a valid spec', () => {
    const d = normalizeDesign({ palette: { primary: 'red', text: '#eeeeee' }, type: { fontSize: 40 }, styles: { heading: 'nope' }, sections: 'x' }, 3)
    expect(d.palette.primary).toMatch(/^#[0-9a-f]{6}$/i)
    expect(lum(d.palette.text)).toBeLessThan(0.35)
    expect(d.type.fontSize).toBe(17)
    expect(d.styles.heading).toBe('number')
    expect(d.sections).toHaveLength(3)
  })
  it('darkens primary colors too light for white text', () => {
    const d = normalizeDesign({ palette: { primary: '#ffe9a8' } }, 1)
    expect(lum(d.palette.primary)).toBeLessThanOrEqual(0.5)
  })
})

describe('buildFromDesign', () => {
  it('every section layout builds a valid, wechat-safe doc that uses all images', () => {
    for (const layout of SECTION_LAYOUTS) {
      const d = normalizeDesign(
        {
          palette: { primary: '#1F4E79', accent: '#C8A44D' },
          type: { headingFont: 'serif' },
          styles: { cover: 'band', heading: 'underline', quote: 'center', card: 'accent', divider: 'dots' },
          opening: 'card',
          sections: o.sections.map(() => ({ layout, images: 1, subtitle: 'PART' })),
        },
        o.sections.length,
      )
      const doc = buildFromDesign(o, images, d)
      expect(usedImages(doc.blocks), layout).toBe(10)
      expect(doc.blocks[0].type).toBe('cover')
      expect(doc.blocks.at(-1)!.type).toBe('ending')
      const r = compileDoc(doc, { mapImage: (u) => `https://example.com${u}` })
      // 只检查兼容性告警；长度上限由导出面板提示（复制粘贴不受限）
      expect(r.warnings.filter((w) => !w.includes('20,000')), layout).toEqual([])
      expect(r.charCount, layout).toBeLessThan(22000)
      expect(r.html).toContain('#1f4e79')
    }
  })
  it('brief summarises structure without full text', () => {
    const b = outlineBrief(o, 10)
    expect(b.sections.length).toBe(o.sections.length)
    expect(JSON.stringify(b).length).toBeLessThan(3000)
  })
})
