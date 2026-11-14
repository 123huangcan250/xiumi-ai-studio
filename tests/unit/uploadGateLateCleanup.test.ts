import {EventEmitter} from 'node:events'
import {expect,it,vi} from 'vitest'
import type {Request,Response} from 'express'
import {createUploadGate,trackUpload} from '../../server/uploadGate'
function surface(){const req=Object.assign(new EventEmitter(),{resume:vi.fn()}) as unknown as Request;const res=Object.assign(new EventEmitter(),{setHeader:vi.fn()}) as unknown as Response;res.destroy=vi.fn(()=>{res.emit('close');return res});return {req,res,next:vi.fn()}}
it('releases a permit when cleanup finishes after the parser error and response close',async()=>{
 let cleanup!:()=>void;const parser=vi.fn((req:Request,_res:Response,next:(e?:unknown)=>void)=>{cleanup=trackUpload(req);next(Error('parse'))});const route=createUploadGate({concurrency:1})(parser,async()=>{});const first=surface();route(first.req,first.res,first.next);first.res.emit('close');cleanup();const second=surface();route(second.req,second.res,second.next);expect(parser).toHaveBeenCalledTimes(2);second.res.emit('close');cleanup()
})
it.each(['parser','handler','timeout'])('does not leak unhandled errors if downstream forwarding throws (%s)',async scenario=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});const request=surface();request.next.mockImplementation(()=>{throw Error('private text')})
 const route=createUploadGate({timeoutMs:5})((_req,_res,next)=>{if(scenario==='parser')next(Error('parse'));else if(scenario==='handler')next()},async()=>{throw Error('handler')})
 try{expect(()=>route(request.req,request.res,request.next)).not.toThrow();await new Promise(resolve=>setTimeout(resolve,15));expect(request.res.destroy).toHaveBeenCalledTimes(1);expect(JSON.stringify(warn.mock.calls)).not.toContain('private text')}finally{warn.mockRestore()}
})
it('rejects timers that Node would truncate to one millisecond',()=>{expect(()=>createUploadGate({timeoutMs:2147483648})).toThrow(RangeError)})
