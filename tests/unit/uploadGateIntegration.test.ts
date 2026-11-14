import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import {mkdtemp,readdir,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request,type Server} from 'node:http'
import {Writable} from 'node:stream'
import {boundedDiskStorage} from '../../server/uploadStorage'
import {createUploadGate} from '../../server/uploadGate'
let root:string,server:Server,base:string
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'xiumi-gate-test-'))})
afterEach(async()=>{vi.restoreAllMocks();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await rmdir(root)})
async function endpoint(handle:(req:any,res:any)=>Promise<void>=async(req,res)=>{res.json({bytes:req.file.buffer.length})},timeoutMs=1000){
 const app=express(),parser=multer({storage:boundedDiskStorage(100,root),limits:{fileSize:100}}).single('file'),gate=createUploadGate({concurrency:1,timeoutMs})
 app.post('/',gate(parser,handle));app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({error:error.message}))
 server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
}
const multipart=()=>{const data=new FormData();data.append('file',new Blob(['contents']),'../../unsafe.txt');return data}
it('returns 408 for an unfinished multipart upload, cleans disk and admits the next request',async()=>{
 await endpoint(undefined,50)
 const status=await new Promise<number>((resolve,reject)=>{
 const req=request(base,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=slow'}},res=>{res.resume();res.once('end',()=>{req.end();resolve(res.statusCode!)})});req.once('error',reject)
 req.write('--slow\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\npartial')
 })
 expect(status).toBe(408);expect(await readdir(root)).toEqual([]);expect((await fetch(base,{method:'POST',body:multipart()})).status).toBe(200)
})
it('does not release processing admission when the real client disconnects',async()=>{
 const finishers:Array<()=>void>=[];let started!:()=>void;const processing=new Promise<void>(resolve=>started=resolve)
 await endpoint(async(_req,res)=>{started();await new Promise<void>(resolve=>finishers.push(resolve));res.json({ok:true})})
 const controller=new AbortController();const first=fetch(base,{method:'POST',body:multipart(),signal:controller.signal}).catch(error=>error)
 await processing;controller.abort();await first
 expect((await fetch(base,{method:'POST',body:multipart()})).status).toBe(429)
 finishers[0]();await new Promise(resolve=>setImmediate(resolve))
 const second=fetch(base,{method:'POST',body:multipart()});await vi.waitFor(()=>expect(finishers).toHaveLength(2));finishers[1]();expect((await second).status).toBe(200);expect(await readdir(root)).toEqual([])
})
it('returns 507 on disk exhaustion and recovers admission after cleanup',async()=>{
 await endpoint()
 vi.spyOn(fs,'createWriteStream').mockImplementation(()=>new Writable({write(_chunk,_encoding,callback){callback(Object.assign(Error('full'),{code:'ENOSPC'}))}}) as unknown as fs.WriteStream)
 const failed=await fetch(base,{method:'POST',body:multipart()});expect(failed.status).toBe(507);expect(await readdir(root)).toEqual([])
 vi.restoreAllMocks();expect((await fetch(base,{method:'POST',body:multipart()})).status).toBe(200)
})
