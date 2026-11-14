import * as fileSystem from 'node:fs/promises'
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return {...actual, writeFile: vi.fn(actual.writeFile), rm: vi.fn(actual.rm), rename: vi.fn(actual.rename)} })
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const mock=vi.hoisted(()=>({failIndex:false,root:'',dirs:{} as Record<string,string>,sharp:vi.fn(),metadata:vi.fn(),toFile:vi.fn(),toBuffer:vi.fn(),rotate:vi.fn(),resize:vi.fn(),png:vi.fn(),jpeg:vi.fn(),extract:vi.fn(),flatten:vi.fn()}))
vi.mock('sharp',()=>({default:Object.assign(mock.sharp,{strategy:{attention:'attention'}})}))
vi.mock('../../server/store',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../server/store')>()
  const {mkdtempSync,mkdirSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
  mock.root=mkdtempSync(join(tmpdir(),'xiumi-assets-unit-'));mock.dirs={assets:join(mock.root,'assets'),cache:join(mock.root,'cache')}
  Object.values(mock.dirs).forEach(p=>mkdirSync(p))
  return {...actual,mutateJson:async(...args:Parameters<typeof actual.mutateJson>)=>{if(mock.failIndex)throw Error('index unavailable');return actual.mutateJson(...args)},writeJson:async(path:string,value:unknown)=>{if(mock.failIndex)throw Error('index unavailable');return actual.writeJson(path,value)},DIRS:{...actual.DIRS,...mock.dirs}}
})
import { saveAsset, listAssets, deleteAsset, cropAsset, variantPath, wechatReady, cleanCache, saveGlyph } from '../../server/assets'
beforeEach(async()=>{
  vi.clearAllMocks();mock.failIndex=false;mock.toBuffer.mockReset()
  const chain={metadata:mock.metadata,toFile:mock.toFile,toBuffer:mock.toBuffer,rotate:mock.rotate,resize:mock.resize,png:mock.png,jpeg:mock.jpeg,extract:mock.extract,flatten:mock.flatten}
  mock.sharp.mockReturnValue(chain)
  for(const fn of [mock.rotate,mock.resize,mock.png,mock.jpeg,mock.extract,mock.flatten]) fn.mockReturnValue(chain)
  mock.metadata.mockResolvedValue({format:'jpeg',hasAlpha:false})
  mock.toFile.mockImplementation(async(path:string)=>{await writeFile(path,'encoded');return {width:128,height:96,size:7}})
  mock.toBuffer.mockResolvedValue(Buffer.from('image'))
  await writeFile(join(mock.dirs.assets,'_index.json'),'{}')
  for(const file of await readdir(mock.dirs.cache)) await rm(join(mock.dirs.cache,file))
})
afterAll(async()=>{await rm(mock.root,{recursive:true,force:true})})
describe('asset variants and export size boundaries',()=>{
  it('normalizes alpha and opaque metadata, preserves source and deletes safely',async()=>{
    mock.metadata.mockResolvedValueOnce({pages:1}).mockResolvedValueOnce({format:'png',hasAlpha:true}).mockResolvedValue({format:'jpeg',hasAlpha:false,pages:1})
    const alpha=await saveAsset(Buffer.from('source'),'alpha.png')
    const opaque=await saveAsset(Buffer.from('source'),'opaque.jpg')
    expect(alpha.file).toMatch(/\.png$/);expect(opaque.file).toMatch(/\.jpg$/)
    expect(mock.png).toHaveBeenCalledWith({compressionLevel:9});expect(mock.jpeg).toHaveBeenCalledWith({quality:86,mozjpeg:true})
    expect(await listAssets()).toHaveLength(2)
    await deleteAsset(alpha.id);expect(await listAssets()).toHaveLength(1)
    await deleteAsset('does-not-exist');await expect(deleteAsset('../bad')).rejects.toMatchObject({status:400})
  })
  it('crops to bounded dimensions and leaves the original index entry intact',async()=>{
    const source=await saveAsset(Buffer.from('image'),'source.png')
    const crop=await cropAsset(source.id,{x:-3,y:1.4,width:900,height:900})
    expect(mock.extract).toHaveBeenCalledWith({left:0,top:1,width:128,height:95})
    expect(crop.name).toBe('source-crop.png');expect(await listAssets()).toHaveLength(2)
    await expect(cropAsset('missing',{x:0,y:0,width:1,height:1})).rejects.toMatchObject({status:404})
  })
  it('validates paths, applies crop/default limits and reuses existing cached variants',async()=>{
    await expect(variantPath('../escape.png')).rejects.toMatchObject({status:400})
    await expect(variantPath('missing.png')).rejects.toMatchObject({status:404})
    await writeFile(join(mock.dirs.assets,'test.png'),'png');await writeFile(join(mock.dirs.assets,'test.jpg'),'jpg')
    expect(await variantPath('test.png',undefined,2400)).toBe(join(mock.dirs.assets,'test.png'))
    const cropped=await variantPath('test.png','2:1',400)
    expect(mock.resize).toHaveBeenLastCalledWith({width:400,height:200,fit:'cover',position:'attention'})
    const calls=mock.toFile.mock.calls.length
    expect(await variantPath('test.png','2:1',400)).toBe(cropped);expect(mock.toFile).toHaveBeenCalledTimes(calls)
    await variantPath('test.jpg','invalid',20);expect(mock.resize).toHaveBeenLastCalledWith({width:64,withoutEnlargement:true})
    await variantPath('test.jpg');expect(mock.resize).toHaveBeenLastCalledWith({width:1080,withoutEnlargement:true})
    expect(mock.jpeg).toHaveBeenCalledWith({quality:84,mozjpeg:true})
    await cleanCache();expect(await readdir(mock.dirs.cache)).toEqual([])
  })
  it.each(['png','jpg'])('returns small %s files without recompression',async ext=>{
    const path=join(mock.dirs.assets,`small.${ext}`);await writeFile(path,'image')
    const result=await wechatReady(path)
    expect(result).toEqual({buf:await readFile(path),mime:ext==='png'?'image/png':'image/jpeg',name:`small.${ext}`})
    expect(mock.sharp).not.toHaveBeenCalled()
  })
  it('tries progressively smaller encoding and fails when every variant stays oversized',async()=>{
    const path=join(mock.dirs.assets,'large.png');await writeFile(path,Buffer.alloc(1_000_001))
    const large=Buffer.alloc(1_000_001)
    mock.toBuffer.mockResolvedValueOnce(large).mockResolvedValueOnce(Buffer.from('small'))
    expect(await wechatReady(path)).toEqual({buf:Buffer.from('small'),mime:'image/jpeg',name:'image.jpg'})
    expect(mock.jpeg).toHaveBeenNthCalledWith(1,{quality:80,mozjpeg:true});expect(mock.jpeg).toHaveBeenNthCalledWith(2,{quality:72,mozjpeg:true})
    mock.toBuffer.mockReset().mockResolvedValue(large)
    await expect(wechatReady(path)).rejects.toThrow()
    expect(mock.resize).toHaveBeenLastCalledWith({width:900,withoutEnlargement:true})
  })
})
it('sets an explicit 64MP input ceiling while retaining animation and orientation behavior',async()=>{
 await saveAsset(Buffer.from('source'),'normal.jpg')
 expect(mock.sharp).toHaveBeenCalledWith(Buffer.from('source'),{animated:false,page:0,limitInputPixels:64_000_000})
 expect(mock.rotate).toHaveBeenCalled()
})
it('serializes actual Sharp work until its output promise settles',async()=>{
 let finish!:()=>void;const hold=new Promise<void>(resolve=>finish=resolve)
 mock.toFile.mockImplementationOnce(async(path:string)=>{await hold;await writeFile(path,'encoded');return {width:128,height:96,size:7}})
 const first=saveAsset(Buffer.from('a'),'a.jpg');await vi.waitFor(()=>expect(mock.toFile).toHaveBeenCalledTimes(1))
 const second=saveAsset(Buffer.from('b'),'b.jpg');await new Promise(resolve=>setImmediate(resolve));expect(mock.toFile).toHaveBeenCalledTimes(1)
 finish();await Promise.all([first,second]);expect(mock.toFile).toHaveBeenCalledTimes(2)
})
it('cleans its own partial output if image encoding fails after creating a file',async()=>{
 const error=Error('encoder failed');mock.toFile.mockImplementationOnce(async(path:string)=>{await writeFile(path,'partial');throw error})
 const before=await readdir(mock.dirs.assets);await expect(saveAsset(Buffer.from('source'),'partial.png')).rejects.toBe(error)
 expect(await readdir(mock.dirs.assets)).toEqual(before)
})

it('records failed cleanup without hiding the original encoder error',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});const remove=vi.spyOn(fileSystem,'rm').mockRejectedValueOnce(Error('cleanup failed'));const error=Object.assign(Error('encoder budget'),{status:413});mock.toFile.mockRejectedValueOnce(error)
 await expect(saveAsset(Buffer.from('source'),'x.png')).rejects.toMatchObject({status:413,cleanupFailures:1});expect(warning).toHaveBeenCalledWith('Image output cleanup failed for a newly created asset');remove.mockRestore();warning.mockRestore()
})

it('removes newly encoded output when its index write fails and keeps later writes usable',async()=>{
 mock.failIndex=true;const before=await readdir(mock.dirs.assets);await expect(saveAsset(Buffer.from('source'),'index.jpg')).rejects.toThrow('index unavailable');expect(await readdir(mock.dirs.assets)).toEqual(before);mock.failIndex=false;await expect(saveAsset(Buffer.from('source'),'next.jpg')).resolves.toMatchObject({name:'next.jpg'})
})
it('rejects explosive output before cache lookup but preserves a safe wide ratio',async()=>{
 await writeFile(join(mock.dirs.assets,'ratio.png'),'source');await writeFile(join(mock.dirs.cache,'ratio_1x999_2400.png'),'unsafe-old-cache')
 await expect(variantPath('ratio.png','1:999',2400)).rejects.toMatchObject({status:413});expect(mock.sharp).not.toHaveBeenCalled()
 await variantPath('ratio.png','999:1',2400);expect(mock.resize).toHaveBeenLastCalledWith({width:2400,height:2,fit:'cover',position:'attention'})
})
it('enforces the output pixel boundary without changing ordinary ratios',async()=>{
 await writeFile(join(mock.dirs.assets,'boundary.png'),'source')
 await variantPath('boundary.png','1:16',2000);expect(mock.resize).toHaveBeenLastCalledWith({width:2000,height:32000,fit:'cover',position:'attention'})
 await expect(variantPath('boundary.png','1:16',2001)).rejects.toMatchObject({status:413})
 await variantPath('boundary.png','4:5',1080);expect(mock.resize).toHaveBeenLastCalledWith({width:1080,height:1350,fit:'cover',position:'attention'})
 for(const fit of ['0:1','1:0','999:1'])await expect(variantPath('boundary.png',fit,64)).rejects.toMatchObject({status:400})
})
it('uses identical integer width for cache and rendering and removes a failed new cache output',async()=>{
 await writeFile(join(mock.dirs.assets,'round.png'),'source');const output=await variantPath('round.png','2:1',400.4)
 expect(output).toBe(join(mock.dirs.cache,'round_2x1_400.png'));expect(mock.resize).toHaveBeenLastCalledWith({width:400,height:200,fit:'cover',position:'attention'})
 const error=Error('cache encoder failed');mock.toFile.mockImplementationOnce(async(path:string)=>{await writeFile(path,'partial');throw error})
 await expect(variantPath('round.png','2:1',500)).rejects.toBe(error);expect(await readdir(mock.dirs.cache)).toEqual(['round_2x1_400.png'])
})
it('rechecks cache after acquiring the image slot for concurrent identical requests',async()=>{
 await writeFile(join(mock.dirs.assets,'same.png'),'source');const first=variantPath('same.png','1:1',400),second=variantPath('same.png','1:1',400)
 expect(await first).toBe(await second);expect(mock.toFile).toHaveBeenCalledTimes(1)
})
it('preserves a variant error and reports cleanup failure without invalidating other cached outputs',async()=>{
 await writeFile(join(mock.dirs.assets,'cleanup.png'),'source');const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});const remove=vi.spyOn(fileSystem,'rm').mockRejectedValueOnce(Error('cleanup failure'));mock.toFile.mockRejectedValueOnce(Object.assign(Error('variant encoder failed'),{status:507}))
 await expect(variantPath('cleanup.png','1:1',400)).rejects.toMatchObject({status:507,cleanupFailures:1});expect(warning).toHaveBeenCalledWith('Image variant cleanup failed for a newly created output');remove.mockRestore();warning.mockRestore()
})
it('never publishes a partial cache file to a concurrent reader',async()=>{
 await writeFile(join(mock.dirs.assets,'atomic.png'),'source');let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let written!:()=>void;const partial=new Promise<void>(resolve=>written=resolve)
 mock.toFile.mockImplementationOnce(async(path:string)=>{await writeFile(path,'partial');written();await held;await writeFile(path,'complete');return {width:400,height:400,size:8}})
 const first=variantPath('atomic.png','1:1',400);await partial;let settled=false;const second=variantPath('atomic.png','1:1',400).then(value=>{settled=true;return value});await new Promise(resolve=>setImmediate(resolve));const early=settled;release();const [a,b]=await Promise.all([first,second]);expect(early).toBe(false);expect(a).toBe(b);expect(await readFile(b,'utf8')).toBe('complete')
})

it('removes only its own temporary file if publication fails after another writer has published',async()=>{
 await writeFile(join(mock.dirs.assets,'publish.png'),'source');const final=join(mock.dirs.cache,'publish_1x1_400.png');const failure=Object.assign(Error('publication denied'),{code:'EACCES'});const publish=vi.spyOn(fileSystem,'rename').mockRejectedValueOnce(failure)
 mock.toFile.mockImplementationOnce(async(path:string)=>{expect(path).not.toBe(final);await writeFile(path,'partial-own');await writeFile(final,'other-complete');return {width:400,height:400,size:12}})
 await expect(variantPath('publish.png','1:1',400)).rejects.toBe(failure);expect(await readFile(final,'utf8')).toBe('other-complete');expect(await readdir(mock.dirs.cache)).toEqual(['publish_1x1_400.png']);publish.mockRestore()
})

it('does not publish a partial managed glyph when its disk write fails',async()=>{
 mock.metadata.mockResolvedValue({format:'png'});const before=await readdir(mock.dirs.assets);const real=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');const failure=Error('glyph disk failure');vi.mocked(fileSystem.writeFile).mockImplementationOnce(async(path)=>{await real.writeFile(path,'partial');throw failure})
 await expect(saveGlyph('data:image/png;base64,Z2x5cGg=')).rejects.toBe(failure);expect(await readdir(mock.dirs.assets)).toEqual(before)
 const file=await saveGlyph('data:image/png;base64,Z2x5cGg=');expect(await readFile(join(mock.dirs.assets,file!),'utf8')).toBe('glyph')
})

it('does not delete another published glyph when this publication fails',async()=>{
 mock.metadata.mockResolvedValue({format:'png'});const failure=Error('rename failed');let final='';const publish=vi.spyOn(fileSystem,'rename').mockImplementationOnce(async(_temporary,path)=>{final=String(path);await writeFile(path,'other-success');throw failure})
 try{await expect(saveGlyph('data:image/png;base64,b3RoZXI=')).rejects.toBe(failure);expect(await readFile(final,'utf8')).toBe('other-success');expect((await readdir(mock.dirs.assets)).filter(name=>name.endsWith('.tmp'))).toEqual([])}finally{publish.mockRestore()}
})
