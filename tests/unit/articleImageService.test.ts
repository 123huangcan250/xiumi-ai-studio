import { expect,it,vi } from 'vitest'
import { createArticleImageImporter } from '../../server/articleImages'
function setup(){
 const assets:any[]=[];const fetch=vi.fn(async()=>new Response(new Uint8Array([1,2,3])))
 const save=vi.fn(async(_b:Buffer,_n:string,sourceKey:string)=>{const asset={id:String(assets.length),file:`${assets.length}.png`,sourceKey,name:'image',width:1,height:1,size:3,createdAt:1};assets.push(asset);return asset})
 const deps={list:async()=>assets,save,fetch,isFile:async(file:string)=>file==='local.png'||file==='rp-012345678901234567890123.png'||assets.some(a=>a.file===file)}
 return {run:createArticleImageImporter(deps),assets,fetch,save}
}
it('imports once by canonical source identity, keeps query, strips fragment and persists only its digest',async()=>{
 const {run,fetch,save}=setup();const url='https://mmbiz.qpic.cn/a?token=PRIVATE#fragment'
 const a=await run([url,url]);expect(a).toHaveLength(1);expect(a[0].status).toBe('imported');expect(fetch).toHaveBeenCalledWith('https://mmbiz.qpic.cn/a?token=PRIVATE')
 expect(save.mock.calls[0][2]).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(a[0].asset)).not.toContain('PRIVATE')
 expect((await run([url]))[0].status).toBe('existing');expect(fetch).toHaveBeenCalledTimes(1)
})
it('reports indexed local variants and managed glyphs without any fetch or re-encoding',async()=>{
 const {run,assets,fetch,save}=setup();assets.push({id:'local',file:'local.png'})
 const result=await run(['/media/local.png?fit=3:2&w=500','/media/rp-012345678901234567890123.png?w=2400'])
 expect(result.map(r=>r.status)).toEqual(['existing','existing']);expect(result[1].kind).toBe('glyph');expect(fetch).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
})
it('fails unsupported, missing or credentialed sources individually without network access',async()=>{
 const {run,fetch}=setup();const urls=['file:///tmp/photo.png','http://localhost/a','https://example.com/a','https://user:pass@mmbiz.qpic.cn/a','/media/../private.png','/media/missing.png','data:image/png;base64,AAAA']
 const result=await run(urls);expect(result.map(r=>r.status)).toEqual(urls.map(()=>'failed'));expect(fetch).not.toHaveBeenCalled();expect(result.map(r=>r.error).join()).not.toMatch(/user:pass|private.png/)
})
it('continues after one failure and never leaks transport messages',async()=>{
 const {run,fetch}=setup();fetch.mockRejectedValueOnce(new Error('secret TOKEN host 10.0.0.1'))
 const result=await run(['https://img.xiumi.us/1','https://img.xiumi.us/2']);expect(result.map(r=>r.status)).toEqual(['failed','imported']);expect(result[0].error).not.toMatch(/TOKEN|10.0.0.1/)
})
it.each([null,{},[''],Array(81).fill('https://img.xiumi.us/a'),['a'.repeat(8193)]].map(input=>[input]))('rejects invalid payload %#',async input=>{await expect(setup().run(input)).rejects.toMatchObject({status:400})})
it('serializes duplicate concurrent requests and bounds admission rather than accumulating arbitrary waiters',async()=>{
 const {run,fetch}=setup();let release!:()=>void;fetch.mockImplementationOnce(async()=>{await new Promise<void>(r=>{release=r});return new Response(new Uint8Array([1]))})
 const first=run(['https://img.xiumi.us/a']);await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 const queued=Array.from({length:15},()=>run(['https://img.xiumi.us/a']));await expect(run(['https://img.xiumi.us/a'])).rejects.toMatchObject({status:429})
 release();await first;expect((await Promise.all(queued)).every(r=>r[0].status==='existing')).toBe(true);expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not encode non-OK, empty or oversized responses and preserves successful retries',async()=>{
 const {run,fetch,save}=setup();fetch.mockResolvedValueOnce(new Response('bad',{status:502})).mockResolvedValueOnce(new Response()).mockResolvedValueOnce(new Response(new Uint8Array(30*1024*1024+1)))
 const results=await run(['https://img.xiumi.us/bad','https://img.xiumi.us/empty','https://img.xiumi.us/large']);expect(results.every(r=>r.status==='failed')).toBe(true);expect(save).not.toHaveBeenCalled()
 expect((await run(['https://img.xiumi.us/bad']))[0].status).toBe('imported')
})
