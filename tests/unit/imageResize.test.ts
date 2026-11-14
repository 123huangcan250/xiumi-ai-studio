import { expect, it } from 'vitest'
import { applyImageWidths, validImageWidth } from '../../src/core/imageResize'
import { createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
it('retains finite 10–100 percent widths and rejects arbitrary values', () => {
 expect(validImageWidth(37.45)).toBe(37.5)
 for (const value of [NaN, Infinity, '50', 0, 9, 101, null]) expect(validImageWidth(value)).toBeUndefined()
})
it('adds width styling even to an image with no style attribute', () => {
 expect(applyImageWidths('<img src="/media/a.png" width="900" height="600">', { src:'/media/a.png', displayWidth:50 } as never)).toBe('<img src="/media/a.png" style="width:50%;max-width:100%;height:auto;">')
})
it('replaces only dimensions and preserves unrelated styles and invalid-width output', () => {
 const tag='<img src="x" style="width:100%;height:60px;display:block;border-radius:4px;">'
 const out=applyImageWidths(tag,{src:'x',displayWidth:30} as never)
 expect(out).toContain('width:30%');expect(out).not.toContain('height:60px');expect(out).toContain('border-radius:4px')
 expect(applyImageWidths(tag,{src:'x',displayWidth:Infinity} as never)).toBe(tag)
})
it('persists valid width and compiles each identical-src gallery reference independently', () => {
 const block=createBlock('gallery',{images:[{src:'/media/a.png',width:900,height:600,displayWidth:40},{src:'/media/a.png',displayWidth:70}]})
 const normalized=normalizeBlocks([block])[0]
 expect(normalized.props).toMatchObject({images:[{displayWidth:40,width:900,height:600},{displayWidth:70}]})
 const html=compileBlock(normalized,THEMES[0]);expect(html).toContain('width:40%');expect(html).toContain('width:70%')
})
it('sizes carousel and nested box images by their own refs without sizing placeholders', () => {
 const children=[createBlock('photos',{count:2,pics:[{caption:''}, {caption:'',image:{src:'/media/same.png',displayWidth:35}}]}),createBlock('carousel',{pics:[{caption:'',image:{src:'/media/same.png',displayWidth:60}},{caption:'',image:{src:'/media/same.png',displayWidth:80}}]})]
 const html=compileBlock(createBlock('box',{children}),THEMES[0],{hints:true})
 for(const size of [35,60,80])expect(html).toContain(`width:${size}%`)
 expect(html).toContain('data-slot="0"')
 expect(html).not.toContain('image-resize')
})
it('does not keep invalid display widths through document normalization', () => {
 for(const displayWidth of [NaN,Infinity,9,101,'40']) {
  const block=createBlock('image',{image:{src:'/media/a.png',displayWidth} as never})
  expect((normalizeBlocks([block])[0].props as {image:{displayWidth?:number}}).image.displayWidth).toBeUndefined()
 }
})
