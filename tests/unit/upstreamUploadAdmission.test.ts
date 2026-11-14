import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Server} from 'node:http'
let root:string,server:Server,base:string
const pending:Array<()=>void>=[]
const imports=vi.fn(async()=>{if(imports.mock.calls.length<=2)await new Promise<void>(resolve=>pending.push(resolve));return {text:'ok',assets:[]}})
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'xiumi-upstream-upload-'))
 vi.stubEnv('XIUMI_SKIP_ENV_FILES','1');vi.stubEnv('XIUMI_DATA_DIR',root)
 vi.doMock('../../server/importer',()=>({importFile:imports}))
 const {createApp}=await import('../../server/app')
 server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
})
afterAll(async()=>{pending.forEach(done=>done());server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();vi.doUnmock('../../server/importer');await rm(root,{recursive:true,force:true})})
function body(){const data=new FormData();data.append('file',new Blob(['text']),'text.txt');return data}
it('admits only two ordinary uploads through downstream processing',async()=>{
 const a=fetch(base+'/api/import',{method:'POST',body:body()});await vi.waitFor(()=>expect(pending).toHaveLength(1))
 const b=fetch(base+'/api/import',{method:'POST',body:body()});await vi.waitFor(()=>expect(pending).toHaveLength(2))
 try{const response=await fetch(base+'/api/import',{method:'POST',body:body()});expect(response.status).toBe(429);expect(imports).toHaveBeenCalledTimes(2)}
 finally{pending.forEach(done=>done());await Promise.all([a,b])}
})

it('rejects unexpected multipart fields without retaining an upload permit',async()=>{imports.mockImplementation(async()=>({text:'ok',assets:[]}));const data=body();data.append('unused','field');const result=await fetch(base+'/api/import',{method:'POST',body:data});expect(result.status).toBe(413);expect((await fetch(base+'/api/import',{method:'POST',body:body()})).status).toBe(200)})

it('preserves the supported 50-file asset boundary and rejects 51',async()=>{
 const sharp=(await import('sharp')).default;const png=await sharp({create:{width:1,height:1,channels:3,background:'#abc'}}).png().toBuffer();const files=(count:number)=>{const form=new FormData();for(let i=0;i<count;i++)form.append('files',new Blob([png]),`p${i}.png`);return form}
 const accepted=await fetch(base+'/api/assets',{method:'POST',body:files(50)});expect(accepted.status).toBe(200);expect(await accepted.json()).toHaveLength(50)
 expect((await fetch(base+'/api/assets',{method:'POST',body:files(51)})).status).toBe(413)
})
