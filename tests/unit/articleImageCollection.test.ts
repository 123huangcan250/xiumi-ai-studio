// @vitest-environment jsdom
import { expect,it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc } from '../../src/editor/store'
import { collectArticleImages,isImageLibraryRequest } from '../../src/core/articleImages'
const photo=(id:string,src:string)=>({...createBlock('image',{image:{src}}),id})
it('recognizes an explicit local library command while refusing negated or ordinary edits',()=>{
 for(const text of ['帮我把原文中的图片加入我们自己的素材库','分别把照片保存到图库','收集图片到素材库，不要改正文']) expect(isImageLibraryRequest(text)).toBe(true)
 for(const text of ['不要把图片加入素材库','不要把这些正文里面原本存在的各种图片全部加入我们的素材库','给图片添加说明','图库不错']) expect(isImageLibraryRequest(text)).toBe(false)
})
it('collects stored images, lazy HTML/SVG/background and replay references without mutation or generated glyphs',()=>{
 const replay=createBlock('replay');replay.props.canvas.background={type:'image',value:'',image:{src:'https://img.xiumi.us/replay'}}
 const html=createBlock('html',{html:'<img src="placeholder" data-src="//mmbiz.qpic.cn/lazy?q=1"><svg><image href="https://img.xiumi.us/svg"/><path d="x"/></svg><p style="background:url(https://img.xiumi.us/bg)">文字</p>'})
 const doc={...emptyDoc(),cover:{src:'/media/cover.png?w=800'},blocks:[photo('a','https://mmbiz.qpic.cn/a?q=2'),html,replay]};const before=JSON.stringify(doc)
 expect(collectArticleImages(doc)).toEqual(expect.arrayContaining(['/media/cover.png?w=800','https://mmbiz.qpic.cn/a?q=2','https://mmbiz.qpic.cn/lazy?q=1','https://img.xiumi.us/svg','https://img.xiumi.us/bg','https://img.xiumi.us/replay']))
 expect(JSON.stringify(doc)).toBe(before)
})
it('collects only actual selected subtrees, not AI parent-context siblings or cover',()=>{
 const a=photo('a','/media/a.png'),b=photo('b','/media/b.png');const box={...createBlock('box',{children:[a,b]}),id:'box'};const doc={...emptyDoc(),cover:{src:'/media/cover.png'},blocks:[box,photo('c','/media/c.png')]}
 expect(collectArticleImages(doc,['a'])).toEqual(['/media/a.png']);expect(collectArticleImages(doc,['box','a'])).toEqual(['/media/a.png','/media/b.png'])
})
it.each([[],['missing'],['a','a'],'', ['a','missing']].map(scope=>[scope]))('rejects invalid requested scope %j instead of falling back',scope=>{
 const doc={...emptyDoc(),blocks:[photo('a','/media/a.png')]};expect(()=>collectArticleImages(doc,scope as string|string[])).toThrow()
})
it('rejects ambiguous selected ids and restores display proxy without losing signed query',()=>{
 const doc={...emptyDoc(),blocks:[photo('a','/api/wx-image?u='+encodeURIComponent('https://mmbiz.qpic.cn/a?k=1&x=2'))]}
 expect(collectArticleImages(doc,'a')).toEqual(['https://mmbiz.qpic.cn/a?k=1&x=2']);doc.blocks.push(photo('a','/media/b.png'));expect(()=>collectArticleImages(doc,'a')).toThrow()
})
it('does not interpret explicit prohibitions as a library action',()=>{
 for(const text of ['不用把图片加入素材库','禁止将照片导入图库','不保存图片到素材库']) expect(isImageLibraryRequest(text)).toBe(false)
})
