import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { rehostUrls, rewriteImages } from '../../src/core/images'

const parse = (html: string) => new JSDOM(html).window.document

it('collects and rewrites background URLs without changing case-sensitive style selection', () => {
  const lower = 'https://statics.xiumi.us/lower.png'
  const upper = 'https://statics.xiumi.us/upper.png'
  const html = `<section style="background:url('${lower}');color:red"></section><p style="background:URL('${upper}')"></p><i style="color:red"></i>`
  expect(rehostUrls(html, parse)).toEqual([lower])
  const output = parse(rewriteImages(html, { [lower]: '/media/lower.png', [upper]: '/media/upper.png' }, parse))
  expect(output.querySelector('section')?.getAttribute('style')).toBe('background:url("/media/lower.png");color:red')
  expect(output.querySelector('p')?.getAttribute('style')).toBe(`background:URL('${upper}')`)
  expect(output.querySelector('i')?.getAttribute('style')).toBe('color:red')
})