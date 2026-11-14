import {expect,it} from 'vitest'
import sharp from 'sharp'
import {MAX_INPUT_PIXELS,withImageBudget} from '../../server/imageBudget'
it('bounds the image queue and recovers after completion and synchronous/asynchronous failure',async()=>{
 let finish!:()=>void;const held=withImageBudget(()=>new Promise<void>(resolve=>{finish=resolve}));await Promise.resolve();
 const waiting=Array.from({length:64},()=>withImageBudget(async()=>42));await expect(withImageBudget(async()=>99)).rejects.toMatchObject({status:429});finish();await held;expect(await Promise.all(waiting)).toHaveLength(64)
 await expect(withImageBudget(()=>{throw Error('sync')})).rejects.toThrow('sync')
 await expect(withImageBudget(async()=>{throw Error('async')})).rejects.toThrow('async')
 expect(await withImageBudget(async()=>1)).toBe(1)
})
it('uses the actual Sharp header pixel limit without decoding an oversized SVG',async()=>{
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8001" height="8000"></svg>')
 await expect(withImageBudget(()=>sharp(svg,{limitInputPixels:MAX_INPUT_PIXELS}).metadata())).rejects.toMatchObject({status:413})
 const meta=await withImageBudget(()=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="6000"></svg>'),{limitInputPixels:MAX_INPUT_PIXELS}).metadata());expect(meta.width! * meta.height!).toBe(48_000_000)
})
