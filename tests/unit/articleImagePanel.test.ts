// @vitest-environment jsdom
import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { RightPanel } from '../../src/editor/RightPanel'
import { api } from '../../src/editor/api'
import { useStore,emptyDoc } from '../../src/editor/store'
import { createBlock } from '../../src/core/blocks'
let root:Root,host:HTMLDivElement
const state=()=>useStore.getState()
const click=async(name:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===name);expect(b).toBeTruthy();b!.click()})
const enter=async(text:string)=>act(async()=>{const el=document.querySelector('textarea[aria-label="AI 修改指令"]') as HTMLTextAreaElement;expect(el.disabled).toBe(false);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}))})
beforeEach(async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});localStorage.clear();vi.spyOn(api,'aiStatus').mockResolvedValue({enabled:false,name:'none',model:'none',provider:'openai',profileId:''})
 vi.spyOn(api,'aiEdit').mockRejectedValue(new Error('Provider must not be called'));vi.spyOn(api,'importArticleImages').mockImplementation(async urls=>urls.map(url=>({url,status:'imported'})))
 state().load({...emptyDoc(),blocks:['a','b'].map(id=>({...createBlock('image',{image:{src:`https://img.xiumi.us/${id}`}}),id}))});state().select('a')
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(RightPanel)));await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="tab-ai"]')!.click())
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks()})
it('recognizes the local command with no AI configuration and only writes after explicit confirmation',async()=>{
 const doc=state().doc;await enter('帮我把原文中的图片加入我们自己的素材库');await click('收集图片到素材库')
 expect(document.body.textContent).toContain('发现 1 张');expect(api.importArticleImages).not.toHaveBeenCalled();expect(api.aiEdit).not.toHaveBeenCalled()
 await click('确认加入素材库');expect(api.importArticleImages).toHaveBeenCalledWith(['https://img.xiumi.us/a']);expect(state().doc).toBe(doc);expect(state().past).toHaveLength(0)
})
it('captures the actual selected union and rejects selection ABA before confirmation',async()=>{
 act(()=>state().select('b',{toggle:true}));await click('收集当前范围图片到素材库');expect(document.body.textContent).toContain('发现 2 张')
 act(()=>{state().select('a');state().select('b',{toggle:true})});await click('确认加入素材库');expect(api.importArticleImages).not.toHaveBeenCalled();expect(document.body.textContent).toContain('范围已变化')
})
it('stops remaining images on close but does not claim the in-flight request was cancelled',async()=>{
 act(()=>state().select('b',{toggle:true}));let release!:(x:any)=>void;vi.mocked(api.importArticleImages).mockImplementationOnce(()=>new Promise(r=>release=r))
 await click('收集当前范围图片到素材库');await click('确认加入素材库');expect(document.body.textContent).toContain('正在处理')
 await click('停止剩余并关闭');await act(async()=>release([{url:'https://img.xiumi.us/a',status:'imported'}]));expect(api.importArticleImages).toHaveBeenCalledTimes(1);expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('retries only failed or unconfirmed items and a duplicate click does not start another loop',async()=>{
 act(()=>state().select('b',{toggle:true}));vi.mocked(api.importArticleImages).mockResolvedValueOnce([{url:'https://img.xiumi.us/a',status:'existing'}]).mockResolvedValueOnce([])
 await click('收集当前范围图片到素材库');await click('确认加入素材库');expect(document.body.textContent).toContain('失败或未确认 1 张');await click('重试失败图片');expect(api.importArticleImages).toHaveBeenCalledTimes(3);expect(vi.mocked(api.importArticleImages).mock.calls[2][0]).toEqual(['https://img.xiumi.us/b'])
})
it('a changed document rejects stale confirmation and leaves the new draft untouched',async()=>{
 await click('收集当前范围图片到素材库');act(()=>state().updateProps('a',{caption:'new caption'}));const next=state().doc
 await click('确认加入素材库');expect(api.importArticleImages).not.toHaveBeenCalled();expect(state().doc).toBe(next)
})
it('double click has only one in-flight request and document change stops the remaining batch',async()=>{
 act(()=>state().select('b',{toggle:true}));let release!:(x:any)=>void;vi.mocked(api.importArticleImages).mockImplementationOnce(()=>new Promise(r=>release=r))
 await click('收集当前范围图片到素材库')
 await act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='确认加入素材库')!;button.click();button.click()})
 expect(api.importArticleImages).toHaveBeenCalledTimes(1);act(()=>state().updateProps('a',{caption:'changed'}))
 await act(async()=>release([{url:'https://img.xiumi.us/a',status:'imported'}]));expect(api.importArticleImages).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('已停止剩余图片')
})
it('unmount stops remaining work without rewriting the old or new document',async()=>{
 act(()=>state().select('b',{toggle:true}));let release!:(x:any)=>void;vi.mocked(api.importArticleImages).mockImplementationOnce(()=>new Promise(r=>release=r));const doc=state().doc
 await click('收集当前范围图片到素材库');await click('确认加入素材库');await act(async()=>root.render(null));await act(async()=>release([{url:'https://img.xiumi.us/a',status:'imported'}]));expect(api.importArticleImages).toHaveBeenCalledTimes(1);expect(state().doc).toBe(doc)
})
it('does not revive a confirmation after an edit and undo restore the identical document object',async()=>{
 await click('收集当前范围图片到素材库');const doc=state().doc
 act(()=>{state().updateProps('a',{caption:'temporary'});state().undo()});expect(state().doc).toBe(doc)
 await click('确认加入素材库');expect(api.importArticleImages).not.toHaveBeenCalled();expect(document.body.textContent).toContain('范围已变化')
})
it('stops remaining requests after in-flight document edit/undo ABA',async()=>{
 act(()=>state().select('b',{toggle:true}));let release!:(x:any)=>void;vi.mocked(api.importArticleImages).mockImplementationOnce(()=>new Promise(r=>release=r))
 await click('收集当前范围图片到素材库');await click('确认加入素材库');const doc=state().doc
 act(()=>{state().updateProps('a',{caption:'temporary'});state().undo()});expect(state().doc).toBe(doc)
 await act(async()=>release([{url:'https://img.xiumi.us/a',status:'imported'}]));expect(api.importArticleImages).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('已停止剩余图片')
})
async function enableSuggestions(){
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'synthetic',model:'synthetic',provider:'openai',profileId:'p'})
 await act(async()=>window.dispatchEvent(new Event('ai-settings-changed')))
 await act(async()=>host.querySelector<HTMLInputElement>('.props-form > label.hint input[type="checkbox"]')!.click())
}
it('opening collection directly suppresses the already scheduled auto-suggestion',async()=>{
 vi.useFakeTimers();const suggestion=vi.spyOn(api,'aiSuggestInstruction').mockResolvedValue({suggestion:'unexpected'})
 try{await enableSuggestions();await click('收集当前范围图片到素材库');await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(suggestion).not.toHaveBeenCalled()}finally{vi.useRealTimers()}
})
it('opening collection aborts an already in-flight suggestion without populating a late result',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined,release!:()=>void
 const queue=await import('../../src/editor/suggestionQueue');vi.spyOn(queue.instructionSuggestions,'get').mockImplementation((_key,load)=>load().then(r=>r.suggestion))
 vi.spyOn(api,'aiSuggestInstruction').mockImplementation(async(_c,_p,_id,s)=>{signal=s;await new Promise<void>(r=>release=r);return {suggestion:'late private suggestion'}})
 try{await enableSuggestions();await act(async()=>vi.advanceTimersByTimeAsync(1500));expect(signal).toBeDefined();await click('收集当前范围图片到素材库');expect(signal!.aborted).toBe(true);await act(async()=>release());expect(document.body.textContent).not.toContain('late private suggestion')}finally{release?.();vi.useRealTimers()}
})
it('auto-suggestion removes nested replay image sources but preserves ordinary text and HTML text slots',async()=>{
 vi.useFakeTimers();const queue=await import('../../src/editor/suggestionQueue');vi.spyOn(queue.instructionSuggestions,'get').mockImplementation((_key,load)=>load().then(r=>r.suggestion))
 const suggestion=vi.spyOn(api,'aiSuggestInstruction').mockResolvedValue({suggestion:'精简结构'})
 const replay=createBlock('replay');replay.props.canvas.background={type:'image',value:'',image:{src:'https://img.xiumi.us/background?token=SECRET'}};replay.props.scenes[0].items[0].image={src:'https://img.xiumi.us/item?token=SECRET'};replay.props.scenes[0].items[0].content='保留正文 https://example.test/reference'
 const html=createBlock('html',{html:'<img src="https://img.xiumi.us/html?token=SECRET"><p>保留HTML文字</p>'})
 act(()=>state().load({...emptyDoc(),blocks:[replay,html]}));const doc=state().doc
 try{await enableSuggestions();await act(async()=>vi.advanceTimersByTimeAsync(1500));expect(suggestion).toHaveBeenCalledTimes(1);const sent=JSON.stringify(suggestion.mock.calls[0][0]);expect(sent).not.toContain('SECRET');expect(sent).not.toContain('img.xiumi.us');expect(sent).toContain('保留正文 https://example.test/reference');expect(sent).toContain('保留HTML文字');expect(state().doc).toBe(doc)}finally{vi.useRealTimers()}
})

it('keeps both accessible close buttons and scopes the footer action unambiguously',async()=>{
 await click('收集当前范围图片到素材库')
 const dialog=document.querySelector('[role="dialog"]')!
 const namedClose=[...dialog.querySelectorAll('button')].filter(b=>(b.getAttribute('aria-label')??b.textContent)==='关闭')
 expect(namedClose).toHaveLength(2)
 const footerClose=[...dialog.querySelectorAll<HTMLButtonElement>('.modal-actions button')].filter(b=>b.textContent==='关闭')
 expect(footerClose).toHaveLength(1)
 await act(async()=>footerClose[0].click())
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(api.importArticleImages).not.toHaveBeenCalled()
})
