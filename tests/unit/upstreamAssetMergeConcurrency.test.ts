import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import sharp from 'sharp'
const state=vi.hoisted(()=>({file:'',pause:undefined as undefined|(()=>Promise<void>)}))
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return {...actual,readFile:async(...args:Parameters<typeof actual.readFile>)=>{const value=await Reflect.apply(actual.readFile,undefined,args);if(typeof args[0]==='string'&&resolve(args[0])===state.file&&state.pause){const pause=state.pause;state.pause=undefined;await pause()}return value}}})
let root:string,target:string,source:string,png:Buffer
let assets:typeof import('../../server/assets'),dataTools:typeof import('../../server/dataTools')
beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'xiumi-asset-merge-'));target=join(root,'target');source=join(root,'source');await mkdir(join(source,'assets'),{recursive:true});vi.stubEnv('XIUMI_DATA_DIR',target);vi.stubEnv('XIUMI_SKIP_ENV_FILES','1');assets=await import('../../server/assets');dataTools=await import('../../server/dataTools');png=await sharp({create:{width:2,height:2,channels:3,background:'#abc'}}).png().toBuffer();await writeFile(join(source,'assets','restored.png'),png);await writeFile(join(source,'assets','_index.json'),JSON.stringify({restored:{id:'restored',file:'restored.png',name:'restored',width:2,height:2,size:png.length,createdAt:1}}));state.file=resolve(join(target,'assets','_index.json'))})
afterAll(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})})
it.each(['upload-first','restore-first'])('retains both indexes through real file read/write interleaving (%s)',async order=>{
 await writeFile(state.file,'{}');const plan=await dataTools.planMerge(source,null,target);let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);state.pause=async()=>{entered();await hold}
 const upload=()=>assets.saveAsset(png,'new.png'),restore=()=>dataTools.applyMerge(plan)
 const first=order==='upload-first'?upload():restore();await started;const second=order==='upload-first'?restore():upload();await new Promise(r=>setTimeout(r,50));release();const result=await Promise.all([first,second]);const asset=result[order==='upload-first'?0:1] as import('../../server/assets').Asset
 const index=JSON.parse(await readFile(state.file,'utf8'));expect(Object.keys(index).sort()).toEqual([asset.id,'restored'].sort());expect(index.restored.name).toBe('restored')
})
