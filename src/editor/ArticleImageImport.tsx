import { useEffect,useRef,useState } from 'react'
import type { Doc } from '../core/types'
import { collectArticleImages } from '../core/articleImages'
import type { ArticleImageResult } from '../../server/articleImages'
import { api } from './api'
import { Modal } from './Modal'
/** Read-only document snapshot. Closing cannot roll back a request already accepted by the server. */
export function ArticleImageImport({doc,selection,isCurrent,onClose}:{doc:Doc;selection?:string|string[];isCurrent:()=>boolean;onClose:()=>void}) {
 const [snapshot]=useState(()=>{try{return {urls:collectArticleImages(doc,selection),error:''}}catch{return {urls:[],error:'选择范围已变化，请关闭后重新收集'}}})
 const [chosen,setChosen]=useState(()=>new Set(snapshot.urls)),[results,setResults]=useState<ArticleImageResult[]>([])
 const [busy,setBusy]=useState(false),[error,setError]=useState(snapshot.error)
 const cancelled=useRef(false),running=useRef(false)
 useEffect(()=>{cancelled.current=false;return()=>{cancelled.current=true}},[])
 const close=()=>{cancelled.current=true;onClose()}
 const run=async()=>{
  if(running.current)return
  if(!isCurrent()){setError('文稿或选择范围已变化，请关闭后重新收集');return}
  running.current=true;setBusy(true);setError('')
  const done=new Set(results.filter(r=>r.status!=='failed').map(r=>r.url))
  try{
   for(const url of chosen){
    if(cancelled.current)break
    if(!isCurrent()){setError('文稿或选择范围已变化，已停止剩余图片');break}
    if(done.has(url))continue
    let result:ArticleImageResult
    try{const response=await api.importArticleImages([url]);result=response.find(r=>r.url===url && ['imported','existing','failed'].includes(r.status))??{url,status:'failed',error:'服务器未确认结果，可重试核查'}}
    catch{result={url,status:'failed',error:'请求失败或结果未确认，可重试核查'}}
    if(result.status!=='failed')window.dispatchEvent(new Event('assets-changed'))
    if(!cancelled.current)setResults(prev=>[...prev.filter(r=>r.url!==url),result])
   }
  }finally{running.current=false;if(!cancelled.current)setBusy(false)}
 }
 const imported=results.filter(r=>r.status==='imported').length,existing=results.filter(r=>r.status==='existing').length,failed=results.filter(r=>r.status==='failed').length
 const remaining=[...chosen].some(url=>!results.some(r=>r.url===url&&r.status!=='failed'))
 return <Modal title="收集文中图片" onClose={close} width={640}>
  <p>{selection===undefined?'全文（含封面）':'仅当前选中模块及其子模块'}：发现 {snapshot.urls.length} 张不同图片。</p>
  <p>仅加入本机素材库，不修改正文，不向AI发送图片地址。其他排版要求不会执行，原指令仍保留。只支持微信／秀米图床和已管理的本地图片。</p>
  <p>关闭会停止剩余图片；正在处理的一张仍可能入库，重试会核查已有结果。回放文字字形属于已管理资源，不重复创建照片素材。</p>
  {snapshot.urls.length===0?<p role="status">当前范围没有可收集的图片。</p>:<div className="article-image-list" style={{maxHeight:'40vh',overflowY:'auto'}}>{snapshot.urls.map((url,index)=>{
   const result=results.find(r=>r.url===url)
   return <div key={url} style={{padding:'8px 0',overflowWrap:'anywhere'}}>
    <label><input type="checkbox" checked={chosen.has(url)} disabled={busy||!!result&&result.status!=='failed'} onChange={e=>setChosen(prev=>{const next=new Set(prev);if(e.target.checked)next.add(url);else next.delete(url);return next})}/> 图片 {index+1}</label>
    <details><summary>来源地址</summary><span>{url}</span></details>
    {result&&<p>{result.status==='imported'?'已加入素材库':result.status==='existing'?result.kind==='glyph'?'已管理的回放字形资源':'已在素材库':result.error}</p>}
   </div>
  })}</div>}
  <p role="status" aria-live="polite">{busy?'正在处理… ':''}新增 {imported} 张，已存在 {existing} 张，失败或未确认 {failed} 张。</p>
  {error&&<p role="alert">{error}</p>}
  <div className="modal-actions"><button onClick={close}>{busy?'停止剩余并关闭':'关闭'}</button><button className="primary" disabled={busy||!remaining||!!snapshot.error} onClick={run}>{busy?'导入中…':failed?'重试失败图片':'确认加入素材库'}</button></div>
 </Modal>
}
