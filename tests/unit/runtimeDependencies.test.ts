import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {mkdirSync,writeFileSync,mkdtempSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {copyRuntimeDependencies} from '../../scripts/runtimeDependencies'
vi.mock('node:fs', async (importOriginal) => {
 const actual = await importOriginal<typeof import('node:fs')>()
 return {...actual, realpathSync: vi.fn(actual.realpathSync)}
})
let root:string
beforeAll(()=>{root=mkdtempSync(join(tmpdir(),'xiumi-package-deps-'))})
afterAll(()=>rmSync(root,{recursive:true,force:true}))
const make=(dir:string,name:string,version:string,dependencies:Record<string,string>={})=>{mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name,version,main:'index.js',dependencies}));writeFileSync(join(dir,'index.js'),`module.exports='${version}'`)}
it('retains incompatible nested runtime versions instead of flattening names',()=>{
 const source=join(root,'source'),output=join(root,'output','node_modules')
 make(join(source,'node_modules/a'),'a','1',{shared:'1'});make(join(source,'node_modules/a/node_modules/shared'),'shared','1')
 make(join(source,'node_modules/b'),'b','1',{shared:'2'});make(join(source,'node_modules/b/node_modules/shared'),'shared','2')
 copyRuntimeDependencies(['a','b'],source,output)
 expect(createRequire(join(output,'a/package.json'))('shared')).toBe('1')
 expect(createRequire(join(output,'b/package.json'))('shared')).toBe('2')
 expect(JSON.parse(readFileSync(join(output,'b/node_modules/shared/package.json'),'utf8')).version).toBe('2')
})
it('resolves dependency cycles through ancestor modules without recursion or symlinks',()=>{
 const source=join(root,'cycles'),output=join(root,'cycles-output','node_modules')
 make(join(source,'node_modules/a'),'a','1',{b:'1'});make(join(source,'node_modules/b'),'b','1',{a:'1'})
 copyRuntimeDependencies(['a'],source,output)
 expect(createRequire(join(output,'a/node_modules/b/package.json'))('a')).toBe('1')
 expect(existsSync(join(output,'a/node_modules/b/node_modules/a'))).toBe(false)
})

it('skips only absent optional packages and propagates resolution permission failures',async()=>{
 const source=join(root,'optional'),output=join(root,'optional-output','node_modules')
 const pkg=join(source,'node_modules/a')
 make(pkg,'a','1')
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'a',version:'1',optionalDependencies:{missing:'1'}}))
 expect(()=>copyRuntimeDependencies(['a'],source,output)).not.toThrow()
 make(join(source,'node_modules/blocked'),'blocked','1')
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'a',version:'1',optionalDependencies:{blocked:'1'}}))
 const actual=await vi.importActual<typeof import('node:fs')>('node:fs')
 const denied=Object.assign(new Error('permission denied'),{code:'EACCES'})
 vi.mocked(realpathSync).mockImplementation((path,options)=>{
  if(String(path).endsWith('blocked'))throw denied
  return actual.realpathSync(path,options as never)
 })
 try {expect(()=>copyRuntimeDependencies(['a'],source,output)).toThrow(denied)}
 finally {vi.mocked(realpathSync).mockImplementation(actual.realpathSync)}
})
