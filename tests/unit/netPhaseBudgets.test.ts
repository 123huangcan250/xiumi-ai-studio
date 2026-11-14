import {afterEach,expect,it,vi} from 'vitest'
import {safeFetch} from '../../server/net'
const resolve=async()=>[{address:'8.8.8.8'}]
afterEach(()=>vi.useRealTimers())
it('allows a slow body beyond the header budget with a separate finite body budget',async()=>{
 const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(new TextEncoder().encode('complete'));c.close()},30)}})))
 const pending=safeFetch('https://example.com',{resolve,fetcher,timeoutMs:10,bodyTimeoutMs:50});await expect(pending.then(r=>r.text())).resolves.toBe('complete')
})
it('enforces one body deadline rather than extending it on each chunk, and cancels the reader',async()=>{
 vi.useFakeTimers();const cancel=vi.fn();let timer:ReturnType<typeof setInterval>
 const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(new Uint8Array([1])),5)},cancel(){clearInterval(timer);cancel()}})))
 const pending=safeFetch('https://example.com',{resolve,fetcher,timeoutMs:100,bodyTimeoutMs:20});const result=expect(pending).rejects.toMatchObject({status:504});await vi.advanceTimersByTimeAsync(25);await result;expect(cancel).toHaveBeenCalledTimes(1)
})
it('shares the header deadline across redirects and stops a fetcher even if it ignores abort',async()=>{
 vi.useFakeTimers();let calls=0
 const fetcher=vi.fn(async()=>{calls++;await new Promise(r=>setTimeout(r,8));return new Response(null,{status:302,headers:{location:'/next'}})})
 const result=expect(safeFetch('https://example.com',{resolve,fetcher,timeoutMs:10,bodyTimeoutMs:60})).rejects.toMatchObject({status:504});await vi.advanceTimersByTimeAsync(20);await result;expect(calls).toBe(2)
})
it('retains actual decoded byte enforcement during the longer body phase',async()=>{
 const cancel=vi.fn();const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(5))},cancel})))
 await expect(safeFetch('https://example.com',{resolve,fetcher,maxBytes:4,bodyTimeoutMs:60})).rejects.toMatchObject({status:413});expect(cancel).toHaveBeenCalled()
})

it.each([0,-1,Infinity,NaN,2_147_483_648])('rejects invalid unbounded body budget %s',async bodyTimeoutMs=>{
 await expect(safeFetch('https://example.com',{resolve,bodyTimeoutMs})).rejects.toMatchObject({status:400})
})
