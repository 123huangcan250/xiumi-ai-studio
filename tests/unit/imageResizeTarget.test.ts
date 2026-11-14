// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
import { emptyDoc } from '../../src/editor/store'
import { resolveResizeTarget, resizePhoto } from '../../src/editor/imageResizeTarget'
function fixture(type: Parameters<typeof createBlock>[0], props: Record<string, unknown>) {
 const block=createBlock(type,props); const doc={...emptyDoc(),blocks:[block]}
 const host=document.createElement('div');host.dataset.blockId=block.id;host.innerHTML=`<div class="block-html">${compileBlock(block,THEMES[0],{hints:true})}</div>`
 host.querySelectorAll<HTMLImageElement>('img').forEach((img,i)=>{img.dataset.photo=String(i)})
 return {block,doc,host,images:host.querySelectorAll<HTMLImageElement>('img')}
}
it('resolves duplicate-source gallery references by verified index and changes only one',()=>{
 const {doc,images}=fixture('gallery',{images:[{src:'/media/a.png'},{src:'/media/a.png'}]})
 const target=resolveResizeTarget(images[1],doc)!;expect(target.pos.index).toBe(1)
 const next=resizePhoto(doc,target.pos,45);expect(next.blocks[0].props).toMatchObject({images:[{src:'/media/a.png'},{src:'/media/a.png',displayWidth:45}]})
})
it('refuses missing, shifted or wrong-source DOM mapping instead of guessing',()=>{
 const {doc,images,host}=fixture('gallery',{images:[{src:'/media/a.png'},{src:'/media/b.png'}]})
 images[0].src='/media/other.png';expect(resolveResizeTarget(images[0],doc)).toBeNull()
 host.querySelector('.block-html')!.prepend(document.createElement('img'));expect(resolveResizeTarget(images[1],doc)).toBeNull()
})
it('keeps empty kit slots indexed but never resizes placeholders',()=>{
 const {doc,images}=fixture('photos',{count:2,pics:[{}, {image:{src:'/media/a.png'}}]})
 expect(resolveResizeTarget(images[0],doc)).toBeNull();expect(resolveResizeTarget(images[1],doc)?.pos.index).toBe(1)
 const next=resizePhoto(doc,{blockId:doc.blocks[0].id,index:1},35)
 expect(next.blocks[0].props).toMatchObject({pics:[{}, {image:{displayWidth:35}}]})
})
it('resizes confirmed HTML without changing images, links, SVG or other styles',()=>{
 const {doc,images}=fixture('html',{html:'<p><a href="https://example.com">text</a><img src="/media/a.png" width="600" style="border-radius:8px"></p><svg><text>ART</text></svg>'})
 const target=resolveResizeTarget(images[0],doc)!;expect(target).not.toBeNull()
 const next=resizePhoto(doc,target.pos,60);const parsed=new DOMParser().parseFromString((next.blocks[0].props as {html:string}).html,'text/html')
 expect(parsed.querySelector('img')!.style.width).toBe('60%');expect(parsed.querySelector('img')!.style.borderRadius).toBe('8px')
 expect(parsed.querySelector('img')!.getAttribute('src')).toBe('/media/a.png');expect(parsed.querySelector('a')!.getAttribute('href')).toBe('https://example.com');expect(parsed.querySelector('svg')!.textContent).toBe('ART')
})
it('does not resize decorative HTML or unsupported ending images',()=>{
 const {doc,images}=fixture('ending',{image:{src:'/media/qr.png'}})
 expect(resolveResizeTarget(images[0],doc)).toBeNull();expect(resizePhoto(doc,{blockId:doc.blocks[0].id,index:0},40)).toBe(doc)
})
it('HTML small images remain resizable after 10 percent, with identical source indices kept distinct',()=>{
 const {doc,images}=fixture('html',{html:'<img src="/media/a.png" style="width:12%"><img src="/media/a.png">'})
 delete images[0].dataset.photo
 expect(resolveResizeTarget(images[0],doc)?.pos.index).toBe(0)
 const first=resizePhoto(doc,{blockId:doc.blocks[0].id,index:1},10)
 const second=resizePhoto(first,{blockId:doc.blocks[0].id,index:1},80)
 const parsed=new DOMParser().parseFromString((second.blocks[0].props as {html:string}).html,'text/html')
 expect(parsed.querySelectorAll('img')[0].style.width).toBe('12%');expect(parsed.querySelectorAll('img')[1].style.width).toBe('80%')
})
it('resolves a nested box child to its closest actual block, not the parent',()=>{
 const {doc,block,host,images}=fixture('image',{image:{src:'/media/a.png'}})
 const box=createBlock('box',{children:[block]});doc.blocks=[box]
 const outer=document.createElement('div');outer.dataset.blockId=box.id;outer.append(host)
 expect(resolveResizeTarget(images[0],doc)?.pos.blockId).toBe(block.id)
})
it('rejects HTML DOM count mismatch and SVG foreignObject targets',()=>{
 const {doc,host,images}=fixture('html',{html:'<img src="/media/a.png"><img src="/media/a.png">'})
 images[0].remove();expect(resolveResizeTarget(images[1],doc)).toBeNull()
 host.innerHTML='<div class="block-html"><svg><foreignObject><img src="/media/a.png"></foreignObject></svg></div>'
 const svg=createBlock('html',{html:host.querySelector('.block-html')!.innerHTML});host.dataset.blockId=svg.id;doc.blocks=[svg]
 expect(resolveResizeTarget(host.querySelector('img')!,doc)).toBeNull()
})

import { swapPhotos, replacePhoto } from '../../src/core/photos'
it('preserves source crop query and pixel metadata, while swaps carry ref width and replacements use new ref',()=>{
 const {doc}=fixture('gallery',{images:[{src:'/media/a.png?fit=4%3A3',width:800,height:600},{src:'/media/b.png',displayWidth:80}]})
 const pos={blockId:doc.blocks[0].id,index:0};const resized=resizePhoto(doc,pos,45)
 expect(resized.blocks[0].props).toMatchObject({images:[{src:'/media/a.png?fit=4%3A3',width:800,height:600,displayWidth:45},{displayWidth:80}]})
 const swapped=swapPhotos(resized,pos,{...pos,index:1});expect(swapped.blocks[0].props).toMatchObject({images:[{displayWidth:80},{displayWidth:45}]})
 const replaced=replacePhoto(resized,pos,{src:'/media/new.png'})
 expect((replaced.blocks[0].props as {images:{displayWidth?:number}[]}).images[0].displayWidth).toBeUndefined()
})
