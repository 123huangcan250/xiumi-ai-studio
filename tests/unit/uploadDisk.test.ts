import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import fs from 'node:fs'
import {mkdtemp,readdir,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PassThrough,Writable} from 'node:stream'
import {EventEmitter} from 'node:events'
import type {Request} from 'express'
import type {StorageEngine} from 'multer'
import {boundedDiskStorage} from '../../server/uploadStorage'
let root:string
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'xiumi-storage-test-'))})
afterEach(async()=>{vi.restoreAllMocks();await rmdir(root)})
const storage=()=> (boundedDiskStorage as unknown as (bytes:number,root:string)=>StorageEngine)(20,root)
const start=(engine:StorageEngine)=>{const req=new EventEmitter() as Request,stream=new PassThrough();let finish!:(result:any)=>void;const done=new Promise<any>(resolve=>finish=resolve);engine._handleFile(req,{stream,originalname:'../../user.txt'} as unknown as Express.Multer.File,(error,info)=>finish({error,info}));return{req,stream,done}}
it('streams to a private temporary file before the upload finishes, then returns identical buffer and removes it',async()=>{
 const {stream,done}=start(storage());stream.write('partial')
 try {await vi.waitFor(async()=>expect(await readdir(root)).toHaveLength(1))} finally {stream.end(' done')}
 const result=await done;expect(result.error).toBeNull();expect(result.info.buffer.toString()).toBe('partial done');expect(await readdir(root)).toEqual([])
})
it('reports disk pressure and cleans the partial file without retaining upload bytes',async()=>{
 vi.spyOn(fs,'createWriteStream').mockImplementation(()=>new Writable({write(_chunk,_encoding,callback){callback(Object.assign(new Error('disk full'),{code:'ENOSPC'}))}}) as unknown as fs.WriteStream)
 const {stream,done}=start(storage());stream.end('data');const result=await done
 expect(result.error).toMatchObject({status:507});expect(result.info).toBeUndefined();expect(await readdir(root)).toEqual([])
})
it('cleans a partial disk upload on abort',async()=>{
 const {req,stream,done}=start(storage());stream.write('partial')
 await new Promise(resolve=>setImmediate(resolve));req.emit('aborted');stream.end()
 const result=await done;expect(result.error).toBeTruthy();expect(result.info).toBeUndefined();expect(await readdir(root)).toEqual([]);expect(req.listenerCount('aborted')).toBe(0)
})
it('reports unavailable temporary storage without creating arbitrary paths',async()=>{
 const {stream,done}=start(boundedDiskStorage(20,join(root,'missing')));stream.end('data')
 const result=await done;expect(result.error).toMatchObject({code:'ENOENT'});expect(result.info).toBeUndefined();expect(await readdir(root)).toEqual([])
})
import {uploadContext} from '../../server/uploadGate'
it('rejects already-cancelled requests before creating disk state',async()=>{
 const engine=storage(),req=new EventEmitter() as Request,stream=new PassThrough(),reason=Object.assign(Error('cancelled'),{status:408})
 uploadContext(req).controller.abort(reason)
 const result=await new Promise<any>(resolve=>engine._handleFile(req,{stream} as unknown as Express.Multer.File,(error,info)=>resolve({error,info})))
 stream.end();expect(result.error).toBe(reason);expect(result.info).toBeUndefined();expect(await readdir(root)).toEqual([])
})
it('normalizes non-Error stream failures and still cleans temporary state',async()=>{
 const {stream,done}=start(storage());stream.emit('error','failed stream');stream.end()
 const result=await done;expect(result.error).toBeInstanceOf(Error);expect(result.error.message).toBe('failed stream');expect(await readdir(root)).toEqual([])
})

it('shares request abort listeners across supported multipart file counts',async()=>{
 const engine=boundedDiskStorage(100,root),req=new EventEmitter() as Request;const streams=Array.from({length:12},()=>new PassThrough());const pending=streams.map(stream=>new Promise<void>(resolve=>engine._handleFile(req,{stream} as unknown as Express.Multer.File,()=>resolve())));
 try{expect(req.listenerCount('aborted')).toBe(1)}finally{streams.forEach(stream=>stream.end('x'));await Promise.all(pending)}
 expect(req.listenerCount('aborted')).toBe(0);expect(await readdir(root)).toEqual([])
})
