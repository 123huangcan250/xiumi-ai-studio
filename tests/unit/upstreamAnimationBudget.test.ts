import {afterAll,beforeEach,expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync} from 'node:fs'
import {rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const mock=vi.hoisted(()=>({sharp:vi.fn(),stats:vi.fn(),calls:[] as Array<Record<string,unknown>>,root:''}))
vi.mock('sharp',()=>({default:Object.assign(mock.sharp,{strategy:{attention:'attention'}})}))
vi.mock('../../server/store',async original=>{const actual=await original<typeof import('../../server/store')>();mock.root=mkdtempSync(join(tmpdir(),'xiumi-animation-budget-'));const assets=join(mock.root,'assets'),cache=join(mock.root,'cache');mkdirSync(assets);mkdirSync(cache);return {...actual,DIRS:{...actual.DIRS,assets,cache}}})
import {bestFrame,saveGlyph} from '../../server/assets'
beforeEach(()=>{vi.clearAllMocks();mock.calls=[];mock.sharp.mockImplementation((_source,options={})=>{mock.calls.push(options);const chain={metadata:vi.fn(async()=>({pages:3,format:'png'})),ensureAlpha:()=>chain,stats:()=>mock.stats(options.page??0)};return chain});mock.stats.mockImplementation(async(page:number)=>({channels:[{},{},{},{mean:[0,80,250][page]}]}))})
afterAll(async()=>{await rm(mock.root,{recursive:true,force:true})})
it('limits metadata and every sampled frame without discarding the upstream fullest-frame algorithm',async()=>{expect(await bestFrame(Buffer.from('animated'))).toBe(2);expect(mock.calls).toEqual([{animated:true,limitInputPixels:64000000},{page:0,limitInputPixels:64000000},{page:1,limitInputPixels:64000000},{page:2,limitInputPixels:64000000}])})
it('holds the same permit through all frame statistics and does not start another selector early',async()=>{let release!:()=>void;mock.stats.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>release=resolve);return {channels:[{},{},{},{mean:255}]}});const first=bestFrame(Buffer.from('a'));await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const second=bestFrame(Buffer.from('b'));await new Promise(resolve=>setImmediate(resolve));expect(mock.calls).toHaveLength(2);release();expect(await first).toBe(0);expect(await second).toBe(2)})
it('keeps the managed replay PNG path but budgets its metadata',async()=>{const value=await saveGlyph('data:image/png;base64,aW1hZ2U=');expect(value).toMatch(/^rp-[a-f0-9]{24}\.png$/);expect(mock.calls).toEqual([{limitInputPixels:64000000}])})
