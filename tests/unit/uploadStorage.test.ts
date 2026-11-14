import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
import multer from 'multer'
import { request, type Server } from 'node:http'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { Request } from 'express'
import { boundedDiskStorage } from '../../server/uploadStorage'
const servers: Server[]=[]
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))))})
async function endpoint(){
 const app=express(); const upload=multer({storage:boundedDiskStorage(10),limits:{fileSize:8,files:5}})
 app.post('/',upload.array('files'),(req,res)=>res.json((req.files as Express.Multer.File[]).map(f=>f.buffer.toString())))
 app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status??(err instanceof multer.MulterError?413:500)).json({error:err.message}))
 const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(r=>server.once('listening',r));return (server.address() as {port:number}).port
}
async function send(port:number,files:string[],chunked=false){
 const boundary='test-boundary';const body=files.map((s,i)=>`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${i}.txt"\r\nContent-Type: text/plain\r\n\r\n${s}\r\n`).join('')+`--${boundary}--\r\n`
 return new Promise<{status:number;body:any}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,method:'POST',path:'/',headers:{'content-type':`multipart/form-data; boundary=${boundary}`,...(!chunked?{'content-length':Buffer.byteLength(body)}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(raw)}))});req.on('error',reject);if(chunked){for(let i=0;i<body.length;i+=7)req.write(body.slice(i,i+7));req.end()}else req.end(body)})
}
it('accepts multiple files exactly at aggregate budget',async()=>{expect(await send(await endpoint(),['123456','7890'])).toEqual({status:200,body:['123456','7890']})})
it.each([false,true])('rejects cumulative bytes even without content length=%s and permits next request',async chunked=>{const port=await endpoint();const result=await send(port,['123456','78901'],chunked);expect(result.status).toBe(413);expect(result.body.error).toContain('upload');expect((await send(port,['ok'],chunked)).status).toBe(200)})
it('retains per-file limits',async()=>{expect((await send(await endpoint(),['123456789'])).status).toBe(413)})
it('clears concurrent pending buffers on aggregate overflow and calls each callback once',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request
 const streams=[new PassThrough(),new PassThrough()];const results:any[]=[]
 streams.forEach((stream,i)=>storage._handleFile(req,{stream} as unknown as Express.Multer.File,(error,info)=>results.push({i,error,info})))
 streams[0].write('123456');streams[1].write('78901');streams.forEach(s=>s.end())
 await vi.waitFor(()=>expect(results).toHaveLength(2));expect(results.every(r=>r.error?.status===413&&!r.info)).toBe(true)
})
it('settles an aborted upload without retaining data or leaking request listeners',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request,stream=new PassThrough();const results:any[]=[]
 storage._handleFile(req,{stream} as unknown as Express.Multer.File,(error,info)=>results.push({error,info}));stream.write('partial');req.emit('aborted');stream.end()
 await vi.waitFor(()=>expect(results).toHaveLength(1));expect(results[0].error).toBeTruthy();expect(req.listenerCount('aborted')).toBe(0)
})
it('cleans completed files on removal and rejects invalid configured budgets',()=>{
 for(const value of [0,-1,Infinity,1.2])expect(()=>boundedDiskStorage(value)).toThrow(RangeError)
 const storage=boundedDiskStorage(10),file={buffer:Buffer.from('old')} as unknown as Express.Multer.File
 let removed=false;storage._removeFile({} as Request,file,error=>{expect(error).toBeNull();removed=true})
 expect(removed).toBe(true);expect(file.buffer).toBeUndefined()
})
it('propagates stream errors once and fails later files in the same failed request',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request,stream=new PassThrough();const results:any[]=[]
 storage._handleFile(req,{stream} as unknown as Express.Multer.File,error=>results.push(error))
 const error=Error('stream failed');stream.emit('error',error);stream.emit('error',error);stream.end()
 const later=new PassThrough();storage._handleFile(req,{stream:later} as unknown as Express.Multer.File,error=>results.push(error));later.end('x')
 await vi.waitFor(()=>expect(results).toEqual([error,error]));expect(req.listenerCount('aborted')).toBe(0)
})
it('recovers after a client interrupts a real chunked multipart request',async()=>{
 const port=await endpoint()
 await new Promise<void>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method:'POST',headers:{'content-type':'multipart/form-data; boundary=interrupted'}},res=>res.resume())
  req.on('error',()=>resolve());req.on('close',resolve)
  req.write('--interrupted\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\npartial',error=>{if(error)reject(error);else setTimeout(()=>req.destroy(),10)})
 })
 expect(await send(port,['ok'],true)).toEqual({status:200,body:['ok']})
})
