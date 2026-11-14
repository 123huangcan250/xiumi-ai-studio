import {expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import {createConnection} from 'node:net'
import express,{type Request,type Response} from 'express'
import {createUploadGate} from '../../server/uploadGate'
const surface=()=>({req:Object.assign(new EventEmitter(),{resume:vi.fn()}) as unknown as Request,res:Object.assign(new EventEmitter(),{setHeader:vi.fn()}) as unknown as Response,next:vi.fn()})
it('ignores duplicate parser completion and retains admission until the one handler settles',async()=>{
 const gate=createUploadGate({concurrency:1});let settle!:()=>void;const handle=vi.fn(()=>new Promise<void>(resolve=>settle=resolve));const route=gate((_req,_res,next)=>{next();next()},handle),a=surface();
 route(a.req,a.res,a.next);expect(handle).toHaveBeenCalledTimes(1);a.res.emit('finish');a.res.emit('close');
 const blocked=surface();route(blocked.req,blocked.res,blocked.next);expect(blocked.next).toHaveBeenCalledWith(expect.objectContaining({status:429}));
 settle();await new Promise(resolve=>setImmediate(resolve));const b=surface();route(b.req,b.res,b.next);expect(handle).toHaveBeenCalledTimes(2);
 const stillBlocked=surface();route(stillBlocked.req,stillBlocked.res,stillBlocked.next);expect(stillBlocked.next).toHaveBeenCalledWith(expect.objectContaining({status:429}));
 b.res.emit('finish');settle();await new Promise(resolve=>setImmediate(resolve));
})
it('closes a rejected real HTTP connection after 429 without waiting for its unfinished multipart body',async()=>{
 const gate=createUploadGate({concurrency:1});const held=surface();let settle!:()=>void;
 gate((_req,_res,next)=>next(),()=>new Promise<void>(resolve=>settle=resolve))(held.req,held.res,held.next);
 const app=express(),parse=vi.fn((_req:Request,_res:Response,next:()=>void)=>next());app.post('/',gate(parse,async(_req,res)=>{res.json({ok:true})}));
 app.use((error:any,_req:Request,res:Response,_next:any)=>res.status(error.status??500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));server.keepAliveTimeout=60000;
 const socket=createConnection({host:'127.0.0.1',port:(server.address() as {port:number}).port});let body='';socket.on('data',chunk=>body+=chunk.toString());socket.on('error',()=>{});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const closed=new Promise<boolean>(resolve=>{socket.once('close',()=>resolve(true));timer=setTimeout(()=>resolve(false),1500)});
  await new Promise<void>(resolve=>socket.once('connect',resolve));socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\nContent-Type: multipart/form-data; boundary=unfinished\r\nContent-Length: 1000000\r\n\r\n--unfinished\r\n');
  expect(await closed).toBe(true);expect(body).toMatch(/^HTTP\/1.1 429/);expect(body).toMatch(/connection: close/i);expect(body).toMatch(/retry-after: 1/i);expect(parse).not.toHaveBeenCalled();
 }finally{clearTimeout(timer);socket.destroy();held.res.emit('finish');settle();await new Promise(resolve=>setImmediate(resolve));server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
