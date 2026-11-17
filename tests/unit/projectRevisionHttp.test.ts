import { mkdtempSync } from 'node:fs'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.hoisted(async () => { const fs=await import('node:fs'); const os=await import('node:os'); const path=await import('node:path'); process.env.XIUMI_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'xiumi-save-http-')); process.env.DATA_DIR=process.env.XIUMI_DATA_DIR; process.env.XIUMI_SKIP_ENV_FILES='1' })
let server: Server; let base: string
beforeAll(async () => { const {createApp}=await import('../../server/app'); server=await new Promise<Server>(resolve=>{ const s=createApp().listen(0,'127.0.0.1',()=>resolve(s)) }); const a=server.address(); if(!a || typeof a==='string')throw Error('address'); base=`http://127.0.0.1:${a.port}` })
afterAll(async()=>{ if(server) await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); await rm(process.env.DATA_DIR!,{recursive:true,force:true}) })
const put=(id:string,body:unknown)=>fetch(`${base}/api/projects/${id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
const get=async(id:string)=>(await fetch(`${base}/api/projects/${id}`)).json()
it('rejects simultaneous stale writes and deleted draft resurrection',async()=>{
 expect((await put('a',{title:'base',blocks:[]})).status).toBe(200)
 const doc=await get('a'); expect(doc.revision).toEqual(expect.any(String))
 const results=await Promise.all([put('a',{...doc,title:'first'}),put('a',{...doc,title:'second'})])
 expect(results.map(r=>r.status).sort()).toEqual([200,409])
 expect((await get('a')).title).toBe(results[0].status === 200 ? 'first' : 'second')
 await fetch(`${base}/api/projects/a`,{method:'DELETE'})
 expect((await put('a',doc)).status).toBe(409)
})
it('derives legacy revisions without rewriting restored data; existing local wins',async()=>{
 const root=process.env.DATA_DIR!; await mkdir(join(root,'projects'),{recursive:true})
 const file=join(root,'projects','legacy.json'); const original=JSON.stringify({id:'legacy',title:'old',blocks:[]}); await writeFile(file,original)
 const loaded=await get('legacy'); expect(loaded.revision).toEqual(expect.any(String)); expect(await readFile(file,'utf8')).toBe(original)
 expect((await put('legacy',{...loaded,title:'edited'})).status).toBe(200)
 const {planMerge,applyMerge}=await import('../../server/dataTools')
 const source=mkdtempSync(join(tmpdir(),'xiumi-restore-source-'))
 try { await mkdir(join(source,'projects')); await writeFile(join(source,'projects','legacy.json'),original); const result=await applyMerge(await planMerge(source,null,root)); expect(result.copied).toBe(0); expect((await get('legacy')).title).toBe('edited') } finally {await rm(source,{recursive:true,force:true})}
 expect((await put('legacy',{id:'legacy',title:'old client'})).status).toBe(409)
})
it.runIf(process.platform === 'win32')('serializes Windows case aliases of the same project file', async()=>{
 expect((await put('Alias',{title:'base',blocks:[]})).status).toBe(200)
 const doc=await get('Alias')
 const responses=await Promise.all([put('Alias',{...doc,title:'first'}),put('alias',{...doc,title:'second'})])
 expect(responses.map(r=>r.status).sort()).toEqual([200,409])
})
it('does not overwrite a corrupt existing project as a new draft',async()=>{
 const file=join(process.env.DATA_DIR!,'projects','damaged.json');await writeFile(file,'{broken original')
 expect((await put('damaged',{title:'blind'})).status).toBeGreaterThanOrEqual(400)
 expect(await readFile(file,'utf8')).toBe('{broken original')
})
it('assigns restored copies a fresh token so a deleted draft token cannot resurrect its writer',async()=>{
 await put('restored',{title:'original',blocks:[]});const old=await get('restored')
 const source=mkdtempSync(join(tmpdir(),'xiumi-revision-backup-'))
 try{
  await mkdir(join(source,'projects'));await writeFile(join(source,'projects','restored.json'),JSON.stringify(old))
  await fetch(`${base}/api/projects/restored`,{method:'DELETE'})
  const {planMerge,applyMerge}=await import('../../server/dataTools')
  await applyMerge(await planMerge(source,null,process.env.DATA_DIR!))
  const fresh=await get('restored');expect(fresh.revision).not.toBe(old.revision)
  expect((await put('restored',{...old,title:'stale overwrite'})).status).toBe(409)
  await applyMerge(await planMerge(source,null,process.env.DATA_DIR!));expect((await get('restored')).revision).toBe(fresh.revision)
  expect((await put('restored',{...fresh,title:'fresh edit'})).status).toBe(200)
  expect(JSON.parse(await readFile(join(source,'projects','restored.json'),'utf8'))).toEqual(old)
 }finally{await rm(source,{recursive:true,force:true})}
})
it.each(['null','false','0','[]','"text"','{"id":"other"}'])('refuses existing non-project JSON %s without changing bytes',async(raw)=>{
 const file=join(process.env.DATA_DIR!,'projects','shape.json');await writeFile(file,raw)
 expect((await put('shape',{title:'blind'})).status).toBe(409)
 expect(await readFile(file,'utf8')).toBe(raw)
})
