import { afterEach, expect, it, vi } from 'vitest'
import { chatText } from '../../server/ai'
import { api } from '../../src/editor/api'
import { SuggestionQueue } from '../../src/editor/suggestionQueue'
const profile = { id:'test',name:'Test',provider:'openai',baseUrl:'https://example.test/v1',apiKey:'fixture',model:'test',reasoningEffort:'low',jsonMode:false } as const
afterEach(() => vi.unstubAllGlobals())
it('retains rejected configured effort and tells the user exactly how to clear it', async () => {
 const fetch = vi.fn(async (_url:unknown, _init?:RequestInit) => new Response(JSON.stringify({error:{message:'Unsupported parameter reasoning_effort'}}),{status:400}))
 vi.stubGlobal('fetch',fetch)
 await expect(chatText('s','u',{profile})).rejects.toThrow('请在 AI 模型设置中清空“思考强度”')
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).reasoning_effort).toBe('low')
 expect(profile.reasoningEffort).toBe('low')
})
it('does not mislabel unrelated bad credentials as unsupported effort',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('invalid API key',{status:401})))
 await expect(chatText('s','u',{profile})).rejects.not.toThrow('清空')
})
it('propagates already aborted callers without sending and preserves caller cancellation',async()=>{
 const ctrl=new AbortController();ctrl.abort();const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(chatText('s','u',{profile,signal:ctrl.signal})).rejects.toMatchObject({name:'AbortError'})
 expect(fetch).not.toHaveBeenCalled()
})
it('cancels an already sent model request, not reporting it as the 180-second deadline',async()=>{
 const ctrl=new AbortController();let sent!:()=>void;const started=new Promise<void>(r=>sent=r)
 vi.stubGlobal('fetch',vi.fn((_u,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});sent()})))
 const pending=chatText('s','u',{profile,signal:ctrl.signal});const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});await started;ctrl.abort();await rejected
})
it('retains the model timeout when no caller cancellation happened',async()=>{
 vi.stubGlobal('fetch',vi.fn((_u,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})})))
 await expect(chatText('s','u',{profile,timeoutMs:5})).rejects.toMatchObject({status:504})
})
it('does not return a late response after a caller cancellation',async()=>{
 const ctrl=new AbortController()
 vi.stubGlobal('fetch',vi.fn(async()=>{ctrl.abort();return new Response(JSON.stringify({choices:[{message:{content:'late'}}]}))}))
 await expect(chatText('s','u',{profile,signal:ctrl.signal})).rejects.toMatchObject({name:'AbortError'})
})
it('passes the UI signal to browser fetch',async()=>{
 const ctrl=new AbortController();const fetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response('{"suggestion":"x"}'));vi.stubGlobal('fetch',fetch)
 await api.aiSuggestInstruction({},'test',undefined,ctrl.signal)
 expect(fetch.mock.calls[0][1]!.signal).toBe(ctrl.signal)
})
it('does not cache aborted failures or late stale results, allowing a fresh request for the same context',async()=>{
 const queue=new SuggestionQueue(0);const ctrl=new AbortController();let finish!:(x:{suggestion:string})=>void
 const first=queue.get('same',()=>new Promise(r=>finish=r),ctrl.signal);ctrl.abort();finish({suggestion:'stale'});await first
 const fresh=vi.fn(async()=>({suggestion:'fresh'}));expect(await queue.get('same',fresh,new AbortController().signal)).toBe('fresh')
 const stop=new AbortController();const bad=queue.get('other',async()=>{stop.abort();throw new DOMException('Cancelled','AbortError')},stop.signal);await expect(bad).rejects.toThrow()
 expect(await queue.get('other',fresh,new AbortController().signal)).toBe('fresh')
})
