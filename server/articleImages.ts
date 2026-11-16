import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { listAssets,saveAsset,type Asset } from './assets'
import { DIRS } from './store'
import { IMAGE_HOST,safeFetch } from './net'
export interface ArticleImageResult { url:string;status:'imported'|'existing'|'failed';asset?:Asset;error?:string;kind?:'glyph' }
interface Dependencies {list:()=>Promise<Asset[]>;save:(bytes:Buffer,name:string,key:string)=>Promise<Asset>;fetch:(url:string)=>Promise<Response>;isFile:(file:string)=>Promise<boolean>}
const MAX=30*1024*1024
/** Separate from legacy rehosting: this endpoint never returns document replacement instructions. */
export function createArticleImageImporter(deps:Dependencies) {
 let tail:Promise<unknown>=Promise.resolve(),pending=0
 const one=async(raw:string):Promise<ArticleImageResult>=>{
  try{
   const local=/^\/media\/([\w-]+\.(?:png|jpg))(?:\?[^#]*)?$/.exec(raw)
   if(local){
    const file=local[1],asset=(await deps.list()).find(a=>a.file===file)
    if(!await deps.isFile(file)) return {url:raw,status:'failed',error:'本地图片已不存在，请重新上传原图'}
    if(asset)return {url:raw,status:'existing',asset}
    if(/^rp-[a-f0-9]{24}\.png$/.test(file))return {url:raw,status:'existing',kind:'glyph'}
    return {url:raw,status:'failed',error:'此本地图片不属于素材索引，请重新上传原图'}
   }
   const url=new URL(raw)
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!IMAGE_HOST.test(url.hostname)) return {url:raw,status:'failed',error:'仅支持微信／秀米图床或已有本地素材，其他来源请上传原图'}
   url.hash=''
   const key=createHash('sha256').update(url.href).digest('hex')
   const found=(await deps.list()).find(a=>a.sourceKey===key)
   if(found && await deps.isFile(found.file)) return {url:raw,status:'existing',asset:found}
   const response=await deps.fetch(url.href)
   if(!response.ok)return {url:raw,status:'failed',error:`图片下载失败（HTTP ${response.status}）`}
   const bytes=Buffer.from(await response.arrayBuffer())
   if(!bytes.length||bytes.length>MAX)return {url:raw,status:'failed',error:'图片为空或超过30MiB'}
   return {url:raw,status:'imported',asset:await deps.save(bytes,'文稿图片',key)}
  }catch{return {url:raw,status:'failed',error:'图片读取失败、格式不支持或资源繁忙，请重试或上传原图'}}
 }
 return (input:unknown):Promise<ArticleImageResult[]>=>{
  if(!Array.isArray(input)||input.length>80||input.some(u=>typeof u!=='string'||!u.trim()||u.length>8192))return Promise.reject(Object.assign(new Error('请选择最多80张有效图片'),{status:400}))
  if(pending>=16)return Promise.reject(Object.assign(new Error('图片收集队列繁忙，请稍后重试'),{status:429}))
  const urls=[...new Set(input as string[])];pending++
  const result=tail.then(async()=>{const results:ArticleImageResult[]=[];for(const url of urls)results.push(await one(url));return results}).finally(()=>{pending--})
  tail=result.catch(()=>{})
  return result
 }
}
export const importArticleImages=createArticleImageImporter({
 list:listAssets,save:saveAsset,
 fetch:url=>safeFetch(url,{headers:{'user-agent':'Mozilla/5.0'},allowHost:host=>IMAGE_HOST.test(host),maxBytes:MAX}),
 isFile:async file=>/^[\w-]+\.(png|jpg)$/.test(file) && await lstat(join(DIRS.assets,file)).then(s=>s.isFile()).catch(()=>false),
})
