import {afterEach,expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import type {Request,Response,RequestHandler} from 'express'
import {createUploadGate} from '../../server/uploadGate'
afterEach(()=>vi.useRealTimers())
const surface=()=>({req:Object.assign(new EventEmitter(),{resume:vi.fn()}) as unknown as Request,res:Object.assign(new EventEmitter(),{setHeader:vi.fn()}) as unknown as Response,next:vi.fn()})
it('admits two requests and rejects the third while their processing is active',async()=>{
 const gate=createUploadGate(),pending:Array<()=>void>=[],handle=vi.fn(()=>new Promise<void>(resolve=>pending.push(resolve)))
 const parser:RequestHandler=(_req,_res,next)=>next();const route=gate(parser,handle),a=surface(),b=surface(),c=surface()
 route(a.req,a.res,a.next);route(b.req,b.res,b.next);route(c.req,c.res,c.next)
 expect(handle).toHaveBeenCalledTimes(2);expect(c.next).toHaveBeenCalledWith(expect.objectContaining({status:429}))
 a.req.emit('close');const d=surface();route(d.req,d.res,d.next);expect(d.next).toHaveBeenCalledWith(expect.objectContaining({status:429}))
 a.res.emit('finish');a.res.emit('close');pending[0]();await new Promise(resolve=>setImmediate(resolve))
 const e=surface();route(e.req,e.res,e.next);expect(handle).toHaveBeenCalledTimes(3)
 b.res.emit('finish');e.res.emit('finish');pending.slice(1).forEach(done=>done());await Promise.resolve()
})
it('times out only the upload phase and does not call the handler afterwards',async()=>{
 vi.useFakeTimers();const gate=createUploadGate({timeoutMs:120000}),handle=vi.fn(async()=>{});let complete:any
 const parser:RequestHandler=(_req,_res,next)=>{complete=next};const route=gate(parser,handle),a=surface()
 route(a.req,a.res,a.next);await vi.advanceTimersByTimeAsync(119999);expect(a.next).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(1);expect(a.next).toHaveBeenCalledWith(expect.objectContaining({status:408}));complete();expect(handle).not.toHaveBeenCalled();a.res.emit('finish')
})
it('does not time out ordinary processing after the request has been read',async()=>{
 vi.useFakeTimers();const route=createUploadGate({timeoutMs:5})((_req,_res,next)=>next(),async()=>{}),a=surface()
 route(a.req,a.res,a.next);a.req.emit('close');await vi.advanceTimersByTimeAsync(10);expect(a.next).not.toHaveBeenCalled();a.res.emit('finish')
})
it('retains the permit after disconnect until non-cancellable processing actually finishes',async()=>{
 const gate=createUploadGate({concurrency:1});let done!:()=>void
 const handle=vi.fn(()=>new Promise<void>(resolve=>done=resolve)),route=gate((_req,_res,next)=>next(),handle),a=surface()
 route(a.req,a.res,a.next);a.res.emit('close');a.req.emit('aborted')
 const b=surface();route(b.req,b.res,b.next);expect(b.next).toHaveBeenCalledWith(expect.objectContaining({status:429}));expect(handle).toHaveBeenCalledTimes(1)
 done();await new Promise(resolve=>setImmediate(resolve));a.res.emit('finish');a.res.emit('close')
 const c=surface();route(c.req,c.res,c.next);expect(handle).toHaveBeenCalledTimes(2);c.res.emit('finish');done();await new Promise(resolve=>setImmediate(resolve))
})
it('handles parser and handler errors without double release or leaked listeners',async()=>{
 for(const parserThrows of [true,false]) {
 const gate=createUploadGate({concurrency:1}),a=surface(),error=Error('failure')
 const route=gate((_req,_res,next)=>{if(parserThrows)throw error;next()},async()=>{throw error})
 route(a.req,a.res,a.next);await new Promise(resolve=>setImmediate(resolve));expect(a.next).toHaveBeenCalledExactlyOnceWith(error);a.res.emit('finish');a.res.emit('close');expect(a.req.listenerCount('aborted')).toBe(0)
 const b=surface();gate((_req,_res,next)=>next(),async()=>{})(b.req,b.res,b.next);expect(b.next).not.toHaveBeenCalled();b.res.emit('finish');await new Promise(resolve=>setImmediate(resolve))
 }
})
it('rejects invalid concurrency and deadline configuration',()=>{
 for(const value of [0,-1,1.5,Infinity]){expect(()=>createUploadGate({concurrency:value})).toThrow(RangeError);expect(()=>createUploadGate({timeoutMs:value})).toThrow(RangeError)}
})
it('handles synchronous business failure and clears admission after the response',async()=>{
 const gate=createUploadGate({concurrency:1}),a=surface(),error=Error('sync business error')
 gate((_req,_res,next)=>next(),()=>{throw error})(a.req,a.res,a.next)
 expect(a.next).toHaveBeenCalledExactlyOnceWith(error);a.res.emit('finish')
 const b=surface();gate((_req,_res,next)=>next(),async()=>{})(b.req,b.res,b.next);expect(b.next).not.toHaveBeenCalled();b.res.emit('finish');await new Promise(resolve=>setImmediate(resolve))
})
