import { cssImageUrls } from './cssImageUrls'
import { selectionScopes } from './ops'
import type { Doc } from './types'
import type { Parse } from './slots'
import { findBlock } from './tree'
/** Local intent only. No provider call or permission to modify a document. */
export function isImageLibraryRequest(text: string): boolean {
  return text.split(/[，。；！？,;!?\n]/).some(clause =>
    /(?:图片|图像|原图|照片)/.test(clause) && /(?:素材库|图片库|图库)/.test(clause) &&
    /(?:加入|添加|保存|导入|收集|存入|转存|放进)/.test(clause) && !/(?:不要|(?<!分)别|无需|不用|不需要|不能|禁止|不许|不想|不(?:加入|添加|保存|导入|收集|存入|转存|放进))/.test(clause))
}
export function collectArticleImages(doc: Doc, selected?: string | string[], parse: Parse = html => new DOMParser().parseFromString(html,'text/html')): string[] {
  if (selected !== undefined && !selectionScopes(doc,selected)) throw new Error('选择范围已失效，请重新选择后收集')
  const urls=new Set<string>()
  const add=(value: unknown)=>{
    if(typeof value !== 'string' || !value.trim()) return
    let url=value.trim()
    if(url.startsWith('/api/wx-image?')) url=new URLSearchParams(url.slice(url.indexOf('?')+1)).get('u') ?? url
    if(url.startsWith('//')) url='https:'+url
    if(!url.startsWith('#')) urls.add(url)
  }
  const visit=(value: unknown):void=>{
    if(!value || typeof value!=='object') return
    if(Array.isArray(value)){value.forEach(visit);return}
    const record=value as Record<string,unknown>
    add(record.src)
    if(typeof record.html==='string'){
      const root=parse(record.html)
      root.querySelectorAll('img').forEach(el=>add(el.getAttribute('data-src')||el.getAttribute('src')))
      root.querySelectorAll('image').forEach(el=>add(el.getAttribute('href')||el.getAttribute('xlink:href')))
      root.querySelectorAll('[style]').forEach(el=>cssImageUrls(el.getAttribute('style')??'').forEach(add))
    }
    Object.values(record).forEach(visit)
  }
  if(selected===undefined){visit(doc.cover);visit(doc.blocks)}
  else (Array.isArray(selected)?selected:[selected]).forEach(id=>visit(findBlock(doc.blocks,id)!.block))
  return [...urls]
}
