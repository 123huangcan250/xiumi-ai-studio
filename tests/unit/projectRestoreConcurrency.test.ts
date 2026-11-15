import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const copying=vi.hoisted(()=>({target:'',entered:()=>{},wait:Promise.resolve()}))
const hold=vi.hoisted(()=>({target:'',entered:()=>{},wait:Promise.resolve()}))
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,copyFile:async(from:string,to:string,mode?:number)=>{if(to===copying.target){copying.entered();await copying.wait}return fs.copyFile(from,to,mode)},rename:async(from:string,to:string)=>{if(to===hold.target){hold.entered();await hold.wait}return fs.rename(from,to)}}})
import { projectCollection } from '../../server/projectStore'
import { applyMerge, planMerge } from '../../server/dataTools'
const roots:string[]=[]
afterEach(async()=>{hold.target='';copying.target='';await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
it('serializes add-only restore behind an in-flight new project save without replacing local content',async()=>{
 const target=await mkdtemp(join(tmpdir(),'xiumi-cas-target-'));const source=await mkdtemp(join(tmpdir(),'xiumi-cas-source-'));roots.push(target,source)
 await mkdir(join(source,'projects'));await writeFile(join(source,'projects','draft.json'),JSON.stringify({id:'draft',title:'restore'}))
 const plan=await planMerge(source,null,target)
 let entered!:()=>void, release!:()=>void
 const started=new Promise<void>(r=>{entered=r});hold.wait=new Promise<void>(r=>{release=r});hold.entered=entered;hold.target=join(target,'projects','draft.json')
 const projects=projectCollection(join(target,'projects'))
 const saving=projects.put({id:'draft',title:'local'})
 await started
 let restored=false;const restoring=applyMerge(plan).then(result=>{restored=true;return result})
 await new Promise(r=>setTimeout(r,25));expect(restored).toBe(false)
 release();await saving;const result=await restoring
 expect(result.copied).toBe(0);expect(result.skipped).toBe(1)
 expect(JSON.parse(await readFile(hold.target,'utf8')).title).toBe('local')
})

it('keeps GET and blind PUT behind an in-flight add-only restore', async () => {
 const target=await mkdtemp(join(tmpdir(),'xiumi-cas-target-'));const source=await mkdtemp(join(tmpdir(),'xiumi-cas-source-'));roots.push(target,source)
 await mkdir(join(source,'projects'));await writeFile(join(source,'projects','draft.json'),JSON.stringify({id:'draft',title:'restore'}))
 const plan=await planMerge(source,null,target)
 let entered!:()=>void,release!:()=>void
 const started=new Promise<void>(r=>{entered=r});copying.wait=new Promise<void>(r=>{release=r});copying.entered=entered;copying.target=join(target,'projects','draft.json')
 const restoring=applyMerge(plan);await started
 const projects=projectCollection(join(target,'projects'))
 let readDone=false; const reading=projects.get('draft').then(doc=>{readDone=true;return doc})
 const saving=projects.put({id:'draft',title:'blind save'}).then(()=>200,(e: {status:number})=>e.status)
 await new Promise(r=>setTimeout(r,25));expect(readDone).toBe(false)
 release();expect((await restoring).copied).toBe(1)
 expect(await reading).toMatchObject({title:'restore',revision:expect.any(String)})
 expect(await saving).toBe(409)
 expect((await projects.get('draft'))?.title).toBe('restore')
})
