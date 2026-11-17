// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import type { Doc } from '../../src/core/types'
import { createBlock } from '../../src/core/blocks'
import { validateOp, applyOp } from '../../src/core/ops'
import { aiContext } from '../../src/core/quickActions'
import { compileDoc } from '../../src/core/compiler'
import { useStore, emptyDoc } from '../../src/editor/store'
import { previewProposal } from '../../src/editor/proposalSafety'
const state=()=>useStore.getState()
const htmlOf=(doc:Doc)=>{const block=doc.blocks[0];if(block.type!=='html')throw new Error('Expected HTML fixture');return block.props.html}
const source='<div><h2 style="color:#ee2222">标题</h2><p>正文 <a href="https://example.test/page">链接</a></p><img src="/media/original.png" alt="原图"></div>'
const load=(html=source)=>state().load({...emptyDoc(),blocks:[{...createBlock('html',{html,label:'原文'}),id:'html'}]})
const update=(extra:Record<string,unknown>)=>validateOp(state().doc,{op:'update',id:'html',...extra})
beforeEach(()=>load())
it('explicit theme restyles locally, ignores supplied HTML, and preserves content/resources',()=>{
 const result=update({themeId:'tsinghua-purple',props:{html:'<p>ATTACK</p>'}})
 expect(result.error).toBeUndefined();expect(result.op).toBeTruthy()
 const after=applyOp(state().doc,result.op!);const html=htmlOf(after) as string
 expect(html).not.toBe(source);expect(html).not.toContain('ATTACK');expect(html).toContain('/media/original.png');expect(html).toContain('https://example.test/page')
 expect(new DOMParser().parseFromString(html,'text/html').body.textContent).toBe('标题正文 链接')
})
it.each(['editorial','chapters'])('layout %s creates real ordered structure and keeps complex islands',layout=>{
 const table='<table><tbody><tr><td>表格</td></tr></tbody></table>',svg='<svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>'
 load('<div><h2>标题</h2><p>正文</p>'+table+svg+'<h2>第二章</h2><p>结束</p></div>')
 const result=update({themeId:'tsinghua-purple',layout});expect(result.error).toBeUndefined()
 const html=result.op!.op==='update'?result.op!.props.html:''
 expect(html).toContain(`data-article-layout="${layout}"`);expect(html).toContain('表格');expect(html).toContain('d="M0 0L10 10"');expect(result.op?.reason).toContain('复杂')
 expect(new DOMParser().parseFromString(html,'text/html').body.textContent).toBe('标题正文表格第二章结束')
})
it('rejects wholly opaque rebuilding and protects white text on dark islands',()=>{
 const dark='<section style="background-color:#111"><p style="color:#fff">白字</p></section>'
 load(dark);expect(update({themeId:'tsinghua-purple',layout:'chapters'}).error).toContain('复杂')
 load('<h2>标题</h2>'+dark);const result=update({themeId:'tsinghua-purple',layout:'chapters'});expect(result.error).toBeUndefined()
 const html=result.op!.op==='update'?result.op!.props.html:'';expect(html).toContain('rgb(17, 17, 17)');expect(html).toContain('rgb(255, 255, 255)')
})
it.each([{themeId:'unknown'},{layout:'chapters'},{themeId:'tsinghua-purple',layout:'arbitrary'},{props:{html:'<p>untrusted</p>'}}])('rejects invalid command %j',raw=>{expect(update(raw).error).toBeTruthy()})
it('preview is readonly, acceptance persists/export renders, repeated accept is inert and undo restores source',()=>{
 state().propose('章节重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}]);const original=state().doc
 const preview=previewProposal(state().proposal!,original);expect(htmlOf(preview)).toContain('data-article-layout');expect(state().doc).toBe(original)
 state().resolveProposal(0,'accepted');const accepted=state().doc;expect(compileDoc(accepted).html).toContain('border-left');expect(compileDoc(accepted).html).toContain('/media/original.png')
 state().resolveProposal(0,'accepted');expect(state().doc).toBe(accepted);state().undo();expect(htmlOf(state().doc)).toBe(source);state().redo();expect(state().doc).toBe(accepted)
})
it.each([source.replace('正文','手改'),source.replace('original.png','replacement.png'),source.replace('#ee2222','#112233')])('theme/layout rejects any later complete HTML change',changed=>{
 state().propose('重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}]);state().updateProps('html',{html:changed});state().resolveProposal(0,'accepted')
 expect(htmlOf(state().doc)).toBe(changed);expect(state().proposal!.items[0].status).not.toBe('accepted')
})
it.each([undefined,'html',['html']].map(scope=>[scope]))('full long slot context survives emoji and image in scope %j',scope=>{
 const text='文'.repeat(299)+'😀'+'尾文'.repeat(200);load(`<p>${text}</p><img src="/media/original.png">`)
 const context=aiContext(state().doc,scope) as any;expect(context.blocks[0].props.slots[0].text).toBe(text)
 const result=update({slots:{t0:'改'+context.blocks[0].props.slots[0].text.slice(1)}});expect(result.error).toBeUndefined()
 const html=htmlOf(applyOp(state().doc,result.op!)) as string;expect(html).toContain('😀');expect(html).toContain('尾文'.repeat(200));expect(html).toContain('/media/original.png')
})
it('pure text-slot proposal still merges independent text and rejects the same-slot edit',()=>{
 load('<p>第一段</p><p>第二段</p>');state().propose('文字',[{op:'update',id:'html',slots:{t0:'建议第一段'}}])
 state().updateProps('html',{html:'<p>第一段</p><p>手改第二段</p>'});state().resolveProposal(0,'accepted')
 expect(htmlOf(state().doc)).toContain('建议第一段');expect(htmlOf(state().doc)).toContain('手改第二段')
 load('<p>第一段</p><p>第二段</p>');state().propose('文字',[{op:'update',id:'html',slots:{t0:'建议第一段'}}]);state().updateProps('html',{html:'<p>手改第一段</p><p>第二段</p>'});state().resolveProposal(0,'accepted');expect(htmlOf(state().doc)).toContain('手改第一段')
})
it('rejecting structural proposal never mutates the source and undo/redo cannot revive it',()=>{
 state().propose('重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'editorial'}]);const doc=state().doc;state().resolveProposal(0,'rejected');expect(state().doc).toBe(doc)
 state().updateProps('html',{label:'手改标签'});state().undo();state().redo();expect(state().proposal).toBeNull()
})
it('theme plus slots uses existing slot writer and subsequent color editing remains available',async()=>{
 const {slotColors,setSlotColor}=await import('../../src/core/slots')
 load('<p style="color:#ff0000">第一段</p><p>第二段</p>');const result=update({themeId:'tsinghua-purple',slots:{t0:'新文'}});expect(result.error).toBeUndefined()
 const html=result.op!.op==='update'?result.op!.props.html:'';const changed=setSlotColor(html,'t0','#123456');expect(slotColors(changed).t0).toBe('#123456');expect(changed).toContain('新文')
})
it('keeps SVG geometry animation and pre/code typography rather than pretending to redraw them',()=>{
 load('<h2>标题</h2><svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="#ee2222"><animate attributeName="opacity" values="0;1" dur="1s"></animate></path></svg><pre style="font-family:monospace;font-size:12px"><code> code </code></pre>')
 const result=update({themeId:'tsinghua-purple',layout:'chapters'});expect(result.error).toBeUndefined();const html=result.op!.op==='update'?result.op!.props.html:''
 expect(html).toContain('d="M0 0L10 10"');expect(html).toContain('attributeName="opacity"');expect(html).toContain('values="0;1"');expect(html).toContain('font-size:12px');expect(html).toContain(' code ')
})
it('keeps replay AI refusal and server-owned strict/filter selection semantics',async()=>{
 const {limitToSelection}=await import('../../src/core/ops')
 const doc=state().doc,raw={op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}
 expect(limitToSelection(doc,'html',[raw],'strict').ops).toHaveLength(1)
 expect(limitToSelection(doc,'html',[raw,{op:'remove',id:'html'}],'filter').ops).toHaveLength(2)
 expect(limitToSelection(doc,'html',[{...raw,id:'outside'}],'strict').dropped).toHaveLength(1)
 const replay=createBlock('replay');expect(validateOp({...doc,blocks:[replay]},{op:'update',id:replay.id,themeId:'tsinghua-purple',layout:'chapters'}).error).toContain('不支持')
})
it('prompt requires explicit structure and states complex/bitmap limitations',async()=>{
 const {EDIT_SYSTEM}=await import('../../server/ai');expect(EDIT_SYSTEM).toContain('layout:"chapters"');expect(EDIT_SYSTEM).toContain('不能只 setTheme');expect(EDIT_SYSTEM).toContain('完全无法安全拆分');expect(EDIT_SYSTEM).toContain('tsinghua-purple')
})
it.each([undefined,'chapters'])('keeps readable explicit and inherited white headings inside dark background islands (%s)',layout=>{
 load('<h2>外标题</h2><section style="background-color:#111"><h2 style="color:#fff">显式白字</h2><div style="color:#eee"><h2>继承浅字</h2></div></section>')
 const result=update({themeId:'tsinghua-purple',...(layout&&{layout})});expect(result.error).toBeUndefined()
 const output=new DOMParser().parseFromString(result.op!.op==='update'?result.op!.props.html:'','text/html')
 const headings=[...output.querySelectorAll('h2')]
 expect((headings[1] as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
 expect((headings[2] as HTMLElement).style.color).toBe('')
 expect((headings[2].parentElement as HTMLElement).style.color).toBe('rgb(238, 238, 238)')
 expect(headings[1].closest('section')!.getAttribute('style')).toContain('background-color: rgb(17, 17, 17)')
})
it('preserves inherited foreground when an opaque wrapper uses an unresolved background variable',()=>{
 load('<h2>外标题</h2><section style="background:var(--authored-panel);color:#fff"><h2>继承白字</h2></section>')
 const result=update({themeId:'tsinghua-purple',layout:'chapters'});expect(result.error).toBeUndefined()
 const output=new DOMParser().parseFromString(result.op!.op==='update'?result.op!.props.html:'','text/html')
 expect((output.querySelectorAll('h2')[1] as HTMLElement).style.color).toBe('')
 expect((output.querySelectorAll('h2')[1].parentElement as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
})
it('comments do not turn wholly opaque content into safely restructureable text',()=>{
 load('<section style="background-color:#111;color:#fff"><h2>保留复杂区块</h2></section><!--publisher note-->')
 expect(update({themeId:'tsinghua-purple',layout:'chapters'}).error).toContain('复杂')
})
it.each([
 '<section style="background-image:url(/media/background.png);color:#fff"><h2>图片背景标题</h2></section>',
 '<table bgcolor="#111111" style="color:#fff"><tbody><tr><td><h2>背景属性标题</h2></td></tr></tbody></table>',
])('preserves inherited heading foreground in image/legacy bgcolor islands',island=>{
 load('<h2>外标题</h2>'+island)
 const result=update({themeId:'tsinghua-purple',layout:'chapters'});expect(result.error).toBeUndefined()
 const output=new DOMParser().parseFromString(result.op!.op==='update'?result.op!.props.html:'','text/html')
 const heading=output.querySelectorAll('h2')[1] as HTMLElement
 expect(heading.style.color).toBe('')
 const foreground=heading.closest('[style*="color"]') as HTMLElement
 expect(foreground.style.color).toBe('rgb(255, 255, 255)')
 if(island.includes('background-image'))expect(output.querySelector('section[style*="background-image"]')?.getAttribute('style')).toContain('/media/background.png')
 else expect(output.querySelector('table')?.getAttribute('bgcolor')).toBe('#111111')
})
it('does not import a fork-specific insertion index contract with the HTML prompt',async()=>{
 const {EDIT_SYSTEM}=await import('../../server/ai');expect(EDIT_SYSTEM).not.toContain('insert.index 始终指当前请求中原始文稿')
})
