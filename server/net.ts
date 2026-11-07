// 服务端抓取：防止 SSRF。每一跳都检查目标，域名解析到内网地址同样拒绝，重定向由这里逐跳处理。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const httpError = (message: string, status = 400) => Object.assign(new Error(message), { status })

/**
 * 回环、私有网段、链路本地、保留地址。
 * 198.18.0.0/15 不算：Clash 等代理的 fake-ip 模式会把所有域名解析到这个网段，拦截它会让抓取全部失败。
 * 这个网段本身没有内网服务；直接写成 IP 的链接由 assertPublicUrl 单独拒绝。
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1])
  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (isIP(addr) === 6) return addr === '::' || addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr)
  return false
}

type Lookup = (host: string) => Promise<{ address: string }[]>
const dnsLookup: Lookup = (host) => lookup(host, { all: true })

/** 只允许 http(s) 的公网地址；域名会实际解析后检查 */
export async function assertPublicUrl(url: URL, resolve: Lookup = dnsLookup) {
  if (!/^https?:$/.test(url.protocol)) throw httpError('仅支持 http(s) 链接')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) throw httpError('不允许访问内网地址')
  if (isIP(host)) {
    if (isPrivateAddress(host) || /^198\.(18|19)\./.test(host)) throw httpError('不允许访问内网地址')
    return
  }
  const list = await resolve(host).catch(() => {
    throw httpError('无法解析该域名', 502)
  })
  if (!list.length || list.some((a) => isPrivateAddress(a.address))) throw httpError('不允许访问内网地址')
}

export interface SafeFetchOptions {
  headers?: Record<string, string>
  /** 只允许这些域名（重定向目标同样检查） */
  allowHost?: (host: string) => boolean
  maxRedirects?: number
  timeoutMs?: number
  resolve?: Lookup
  fetcher?: typeof fetch
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { headers, allowHost, maxRedirects = 3, timeoutMs = 20_000, resolve, fetcher = fetch } = opts
  let url = new URL(raw)
  for (let hop = 0; ; hop++) {
    if (allowHost && !allowHost(url.hostname)) throw httpError('不允许访问该域名')
    await assertPublicUrl(url, resolve)
    const r = await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    if (r.status < 300 || r.status >= 400 || !r.headers.get('location')) return r
    if (hop >= maxRedirects) throw httpError('重定向次数过多', 502)
    url = new URL(r.headers.get('location')!, url)
  }
}

/** 导入时允许转存图片的图床：微信、秀米（按官方文档推断，未实测） */
export const IMAGE_HOST = /(^|\.)(qpic\.cn|qlogo\.cn|xiumi\.us|xiumius\.cn)$/i

/** 微信图床：编辑器显示背景图时经服务端转发 */
export const WECHAT_IMAGE_HOST = /(^|\.)(qpic\.cn|qlogo\.cn)$/i
