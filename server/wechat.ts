// 微信公众号接口：access_token、正文图片上传、封面永久素材、草稿箱。
// 接口参数、errcode 提示与 20,000 字符校验参考 andrewlaredo/wechat-draft-publisher（MIT），见 THIRD_PARTY_NOTICES.md。
import { join } from 'node:path'
import { DATA, readJson, writeJson } from './store'
import { wechatReady } from './assets'

const API = 'https://api.weixin.qq.com/cgi-bin'
const CACHE = join(DATA, 'wechat-cache.json')

const ERR: Record<number, string> = {
  40001: 'access_token 无效或已过期',
  40007: '封面 thumb_media_id 不合法',
  40164: '调用接口的 IP 不在公众号白名单中，请到公众号后台「设置与开发 → 基本配置」添加本机出口 IP',
  45009: '接口调用频率超出限制，请稍后重试',
  45166: '内容包含不合规字符或未通过安全过滤',
  48001: '公众号没有该接口权限（草稿箱接口需要已认证的服务号/订阅号）',
}

function wxError(data: any, stage: string) {
  const msg = ERR[data.errcode] ?? data.errmsg ?? '未知错误'
  return Object.assign(new Error(`[微信 ${stage} 失败 ${data.errcode}] ${msg}`), { status: 502 })
}

export function wechatStatus() {
  return { configured: Boolean(process.env.WECHAT_APPID && process.env.WECHAT_APPSECRET), appid: process.env.WECHAT_APPID ? process.env.WECHAT_APPID.slice(0, 6) + '…' : '' }
}

let token: { value: string; expires: number } | null = null

async function accessToken(force = false): Promise<string> {
  if (!force && token && token.expires > Date.now() + 60_000) return token.value
  const { WECHAT_APPID: appid, WECHAT_APPSECRET: secret } = process.env
  if (!appid || !secret) throw Object.assign(new Error('未在 .env 中配置 WECHAT_APPID / WECHAT_APPSECRET'), { status: 503 })
  // stable_token：多处调用不会互相使旧 token 失效
  const res = await fetch(`${API}/stable_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: force }),
  })
  const data: any = await res.json()
  if (!data.access_token) throw wxError(data, '获取 access_token')
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return token.value
}

async function withToken<T>(fn: (t: string) => Promise<any>, stage: string): Promise<T> {
  let data = await fn(await accessToken())
  if (data?.errcode === 40001 || data?.errcode === 42001) data = await fn(await accessToken(true))
  if (data?.errcode) throw wxError(data, stage)
  return data
}

function form(buf: Buffer, mime: string, name: string) {
  const fd = new FormData()
  fd.append('media', new Blob([new Uint8Array(buf)], { type: mime }), name)
  return fd
}

type Cache = { images: Record<string, string>; covers: Record<string, { media_id: string; url: string }> }

/** 正文图片 → mmbiz URL（media/uploadimg，不占素材库额度）；按本地路径缓存 */
export async function uploadContentImage(key: string, path: string): Promise<string> {
  const cache = await readJson<Cache>(CACHE, { images: {}, covers: {} })
  if (cache.images[key]) return cache.images[key]
  const { buf, mime, name } = await wechatReady(path)
  const data: any = await withToken((t) => fetch(`${API}/media/uploadimg?access_token=${t}`, { method: 'POST', body: form(buf, mime, name) }).then((r) => r.json()), '上传正文图片')
  cache.images[key] = data.url
  await writeJson(CACHE, cache)
  return data.url
}

/** 封面 → 永久素材 media_id */
export async function uploadCover(key: string, path: string) {
  const cache = await readJson<Cache>(CACHE, { images: {}, covers: {} })
  if (cache.covers[key]) return cache.covers[key]
  const { buf, mime, name } = await wechatReady(path)
  const data: any = await withToken((t) => fetch(`${API}/material/add_material?access_token=${t}&type=image`, { method: 'POST', body: form(buf, mime, name) }).then((r) => r.json()), '上传封面')
  cache.covers[key] = { media_id: data.media_id, url: data.url }
  await writeJson(CACHE, cache)
  return cache.covers[key]
}

export interface DraftInput {
  title: string
  author?: string
  digest?: string
  content: string
  thumb_media_id: string
  content_source_url?: string
}

export function validateDraft(a: DraftInput): string[] {
  const errs: string[] = []
  if (!a.title?.trim()) errs.push('标题不能为空')
  if (a.title.length > 64) errs.push('标题超过 64 字')
  if ((a.author ?? '').length > 16) errs.push('作者超过 16 字')
  if ((a.digest ?? '').length > 120) errs.push('摘要超过 120 字')
  if (a.content.length >= 20000) errs.push(`正文 HTML ${a.content.length} 字符，超过草稿箱接口 20,000 字符上限；请精简模块或改用“复制到公众号”`)
  if (Buffer.byteLength(a.content, 'utf8') >= 1024 * 1024) errs.push('正文超过 1MB')
  if (/src="(?!https:\/\/mmbiz\.qpic\.cn)/.test(a.content)) errs.push('正文中存在未上传到微信的图片')
  if (!a.thumb_media_id) errs.push('缺少封面')
  return errs
}

export async function addDraft(a: DraftInput): Promise<{ media_id: string }> {
  const errs = validateDraft(a)
  if (errs.length) throw Object.assign(new Error(errs.join('；')), { status: 400 })
  const article = { ...a, author: a.author ?? '', digest: a.digest ?? '', need_open_comment: 0, only_fans_can_comment: 0 }
  return withToken(
    (t) =>
      fetch(`${API}/draft/add?access_token=${t}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articles: [article] }),
      }).then((r) => r.json()),
    '创建草稿',
  )
}
