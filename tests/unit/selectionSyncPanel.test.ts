// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { api } from '../../src/editor/api'
import { RightPanel } from '../../src/editor/RightPanel'
import { emptyDoc, useStore } from '../../src/editor/store'
let root:Root,host:HTMLDivElement
const state=()=>useStore.getState()
const card=(id:string)=>({...createBlock('card',{title:`Title ${id}`}),id})
const tab=async(name:string)=>act(async()=>host.querySelector<HTMLButtonElement>(`[data-testid="tab-${name}"]`)!.click())
const scope=()=>host.querySelector<HTMLSelectElement>('select')!
const changeScope=(value:string)=>act(()=>{scope().value=value;scope().dispatchEvent(new Event('change',{bubbles:true}))})
async function request(){
 await act(async()=>{
  const input=host.querySelector<HTMLTextAreaElement>('textarea[aria-label="AI 修改指令"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'修改标题')
  input.dispatchEvent(new Event('input',{bubbles:true}))
 })
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='生成修改建议')!.click())
}
beforeEach(async()=>{
 localStorage.clear();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
 vi.spyOn(api,'aiStatus').mockResolvedValue({enabled:true,name:'Synthetic',model:'synthetic',provider:'openai',profileId:'synthetic'})
 vi.spyOn(api,'aiEdit').mockResolvedValue({summary:'new',ops:[]})
 state().load({...emptyDoc(),blocks:[card('a'),card('b')]});state().select('a')
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 await act(async()=>root.render(createElement(RightPanel)));await tab('ai')
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers()})
it('manual document scope resets immediately for another selection, not same-block typing',()=>{
 changeScope('document');act(()=>state().updateProps('a',{title:'Typing'}));expect(scope().value).toBe('document')
 act(()=>state().select('b'));expect(scope().value).toBe('selection');expect(scope().selectedOptions[0].textContent).toContain('Title b')
})
it('selection ABA within a single React batch resets the manual override',()=>{
 changeScope('document');act(()=>{state().select('b');state().select('a')});expect(scope().value).toBe('selection')
})
it('cancel, deletion, undo, redo and document load always derive a valid scope',()=>{
 changeScope('document');act(()=>state().select(null));expect(scope().value).toBe('document')
 act(()=>state().select('a'));expect(scope().value).toBe('selection')
 act(()=>state().removeBlock('a'));expect(scope().value).toBe('selection');expect(scope().selectedOptions[0].textContent).toContain('Title b')
 act(()=>state().removeBlock('b'));expect(scope().value).toBe('document')
 act(()=>state().undo());expect(scope().value).toBe('document')
 act(()=>state().select('b'));expect(scope().value).toBe('selection');act(()=>state().redo());expect(scope().value).toBe('document')
 act(()=>state().load({...emptyDoc(),blocks:[card('c')]}));expect(scope().value).toBe('document');act(()=>state().select('c'));expect(scope().value).toBe('selection')
})
it('same ID in a different document does not inherit document scope',()=>{
 changeScope('document');act(()=>{state().load({...emptyDoc(),blocks:[card('a')]});state().select('a')});expect(scope().value).toBe('selection')
})
it('module properties follow the effective selection through delete and history',async()=>{
 await tab('style');expect(host.textContent).toContain('模块')
 const title=()=>Array.from(host.querySelectorAll('label')).find(l=>l.querySelector('span')?.textContent==='标题')?.querySelector('input')
 expect(title()?.value).toBe('Title a');act(()=>state().select('b'));expect(title()?.value).toBe('Title b')
 act(()=>state().removeBlock('b'));expect(title()?.value).toBe('Title a')
 act(()=>state().undo());expect(title()?.value).toBe('Title a');act(()=>state().select('b'));expect(title()?.value).toBe('Title b')
 act(()=>state().redo());expect(host.textContent).toContain('文章');expect(title()).toBeUndefined()
})
it.each(['selection','aba','unmount'] as const)('drops an old response after %s without creating a proposal',async change=>{
 let finish!:(v:any)=>void;vi.mocked(api.aiEdit).mockReturnValueOnce(new Promise(r=>{finish=r}))
 await request();expect(api.aiEdit).toHaveBeenCalledTimes(1)
 if(change==='selection')act(()=>state().select('b'))
 if(change==='aba')act(()=>{state().select('b');state().select('a')})
 if(change==='unmount')await tab('style')
 await act(async()=>finish({summary:'stale',ops:[{op:'update',id:'a',props:{title:'stale'}}]}))
 expect(state().proposal).toBeNull();expect((state().doc.blocks[0] as any).props.title).toBe('Title a')
})
it('a late A response cannot end or overwrite a newer B request',async()=>{
 const finishes:Array<(v:any)=>void>=[];vi.mocked(api.aiEdit).mockImplementation(()=>new Promise(r=>finishes.push(r)))
 await request();act(()=>state().select('b'));await request();expect(finishes).toHaveLength(2)
 await act(async()=>finishes[0]({summary:'old A',ops:[]}));expect(state().proposal).toBeNull()
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='AI 思考中…')?.disabled).toBe(true)
 await act(async()=>finishes[1]({summary:'new B',ops:[],selectionPolicy:'filter',ignoredOps:2}));expect(state().proposal?.summary).toBe('new B');expect(state().proposal?.selectionPolicy).toBe('filter');expect(state().proposal?.ignoredOps).toBe(2)
})
it('ignores stale request errors after selection change',async()=>{
 let fail!:(e:Error)=>void;vi.mocked(api.aiEdit).mockReturnValueOnce(new Promise((_r,reject)=>{fail=reject}))
 await request();act(()=>state().select('b'));await act(async()=>fail(new Error('old request failure')))
 expect(state().toast?.text).not.toBe('old request failure');expect(state().proposal).toBeNull()
})
it('an opt-in suggestion from an ABA selection is cancelled before it can fill the placeholder',async()=>{
 vi.useFakeTimers();let finish!:(v:any)=>void
 vi.spyOn(api,'aiSuggestInstruction').mockReturnValueOnce(new Promise(r=>{finish=r}))
 act(()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
 await act(async()=>{await vi.advanceTimersByTimeAsync(1500)})
 expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(1)
 act(()=>{state().select('b');state().select('a')})
 await act(async()=>finish({suggestion:'old ABA suggestion'}))
 expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="AI 修改指令"]')!.placeholder).not.toBe('old ABA suggestion')
 vi.useRealTimers()
})
it('does not dispatch an old rendered action between the store selection change and React render',async()=>{
 await act(async()=>{
  const input=host.querySelector<HTMLTextAreaElement>('textarea[aria-label="AI 修改指令"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'修改标题')
  input.dispatchEvent(new Event('input',{bubbles:true}))
 })
 const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='生成修改建议')!
 act(()=>{state().select('b');button.click()})
 expect(api.aiEdit).not.toHaveBeenCalled();expect(scope().value).toBe('selection');expect(scope().selectedOptions[0].textContent).toContain('Title b')
})
