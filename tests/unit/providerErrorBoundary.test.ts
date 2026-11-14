import {afterEach,expect,it,vi} from 'vitest'
import {inspect} from 'node:util'
vi.mock('../../server/store',()=>({DATA:'unused-mocked-settings',readJson:async()=>({ai:{activeId:'',profiles:[]}}),writeJson:vi.fn()}))
import {chatText} from '../../server/ai'
import {fetchModels,probeEfforts} from '../../server/aiModels'
import {resolveDraftProfile,type AiProfile} from '../../server/settings'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers()})
const profile=(apiKey:string):AiProfile=>({id:'draft',name:'fixture',provider:'openai',apiKey,baseUrl:'https://provider.invalid/v1',model:'fixture',jsonMode:false})
const key='SYNTHETIC_cred/with+"quoted"=value'
const echoes=[key,JSON.stringify(key).slice(1,-1),encodeURIComponent(key)]
const assertSafe=(error:unknown)=>{const value=inspect(error,{depth:8})+JSON.stringify(error);for(const echo of echoes)expect(value).not.toContain(echo);expect(String(error)).toContain('***')}
it.each(echoes)('protects real draft resolution through model discovery error: %s',async echo=>{
 vi.stubEnv('AI_API_KEY','');const draft=await resolveDraftProfile(profile(key))
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:'upstream says '+echo}}),{status:401}))
 const error=await fetchModels(draft,fetcher as typeof fetch).catch(error=>error)
 expect(error).toMatchObject({status:502});assertSafe(error)
})
it.each(echoes)('protects direct generation provider errors: %s',async echo=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'upstream says '+echo}}),{status:500})))
 const error=await chatText('fixture','fixture',{profile:profile(key)}).catch(error=>error)
 expect(error).toMatchObject({status:502});assertSafe(error)
})
it('drops secret-bearing raw causes and stacks while preserving diagnostic status/code',async()=>{
 const failure=Object.assign(new Error('socket '+key,{cause:{secret:key}}),{status:503,code:'ECONNRESET'})
 failure.stack='RAW_PROVIDER_STACK '+key
 vi.stubGlobal('fetch',vi.fn(async()=>{throw failure}))
 const error=await chatText('fixture','fixture',{profile:profile(key)}).catch(error=>error)
 expect(error).toMatchObject({status:503,code:'ECONNRESET'});assertSafe(error);expect(error).not.toHaveProperty('cause');expect(error.stack).not.toContain('RAW_PROVIDER_STACK')
})
it('protects effort probe result strings even when a supplied sender rejects',async()=>{
 const result=await probeEfforts(profile(key),vi.fn(async()=>{throw new Error('upstream says '+key)}))
 expect(result.baseError).toContain('***');expect(JSON.stringify(result)).not.toContain(key)
})
it('preserves caller cancellation identity before attempting a request',async()=>{
 const reason=new DOMException('caller cancellation','AbortError'),controller=new AbortController();controller.abort(reason)
 await expect(chatText('fixture','fixture',{profile:profile(key),signal:controller.signal})).rejects.toBe(reason)
})
it('preserves mid-flight cancellation identity ahead of provider sanitization',async()=>{
 const controller=new AbortController(),reason=new DOMException('cancel now','AbortError')
 vi.stubGlobal('fetch',vi.fn((_url:unknown,options:{signal:AbortSignal})=>new Promise((_done,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))))
 const result=chatText('fixture','fixture',{profile:profile(key),signal:controller.signal});controller.abort(reason)
 await expect(result).rejects.toBe(reason)
})
it('keeps the established timeout status and does not return provider AbortError text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new DOMException('provider '+key,'AbortError')}))
 const error=await chatText('fixture','fixture',{profile:profile(key)}).catch(error=>error)
 expect(error).toMatchObject({status:504});expect(String(error)).not.toContain(key)
})

it.each([null, undefined, 'transport '+key])('normalizes non-Error rejection without replacing it with a TypeError: %s',async failure=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw failure}))
 const error=await chatText('fixture','fixture',{profile:profile(key)}).catch(error=>error)
 expect(error).toBeInstanceOf(Error);expect(error.name).not.toBe('TypeError');expect(String(error)).not.toContain(key)
 expect(error.message).toBe(failure==null?'':'transport ***')
})
