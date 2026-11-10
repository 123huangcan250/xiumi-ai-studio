// 服务端抓取：防止 SSRF。每一跳都检查目标，域名解析到内网地址同样拒绝，重定向由这里逐跳处理。
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent, fetch as transportFetch } from 'undici'

const httpError = (message: string, status = 400) => Object.assign(new Error(message), { status })

// URL 解析器会把点分十进制 mapped IPv6 改写成十六进制，必须先统一格式。
function normalizeAddress(ip: string): string {
  let addr = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(addr) !== 6) return addr
  // DNS 可能返回带接口作用域的 IPv6；作用域不改变地址所属网段。
  addr = new URL(`http://[${addr.split('%')[0]}]/`).hostname.slice(1, -1)
  const mapped = addr.match(/^::ffff:([\da-f]+):([\da-f]+)$/)
  if (!mapped) return addr
  const high = parseInt(mapped[1], 16)
  const low = parseInt(mapped[2], 16)
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.')
}

/**
 * 回环、私有网段、链路本地、保留地址。
 * 198.18.0.0/15 不算：Clash 等代理的 fake-ip 模式会把所有域名解析到这个网段，拦截它会让抓取全部失败。
 * 这个网段本身没有内网服务；直接写成 IP 的链接由 assertPublicUrl 单独拒绝。
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = normalizeAddress(ip)
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
async function publicAddresses(url: URL, resolve: Lookup = dnsLookup) {
  if (!/^https?:$/.test(url.protocol)) throw httpError('仅支持 http(s) 链接')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) throw httpError('不允许访问内网地址')
  if (isIP(host)) {
    if (isPrivateAddress(host) || /^198\.(18|19)\./.test(normalizeAddress(host))) throw httpError('不允许访问内网地址')
    return [{ address: host, family: isIP(host) as 4 | 6 }]
  }
  const list = await resolve(host).catch(() => {
    throw httpError('无法解析该域名', 502)
  })
  if (!list.length || list.some((a) => !isIP(a.address) || isPrivateAddress(a.address))) throw httpError('不允许访问内网地址')
  return list.map(({ address }) => ({ address, family: isIP(address) as 4 | 6 }))
}

export async function assertPublicUrl(url: URL, resolve: Lookup = dnsLookup) {
  await publicAddresses(url, resolve)
}

export interface SafeFetchOptions {
  headers?: Record<string, string>
  /** 只允许这些域名（重定向目标同样检查） */
  allowHost?: (host: string) => boolean
  maxRedirects?: number
  timeoutMs?: number
  /** 解压后的响应体上限；在读取过程中检查，而不是完整下载后截断。 */
  maxBytes?: number
  resolve?: Lookup
  fetcher?: typeof fetch
}

/** DNS API 不支持 AbortSignal；停止等待，但仍处理它稍后返回的拒绝。 */
async function withDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {}
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([pending, interrupted]) }
  finally { signal.removeEventListener('abort', abort) }
}

/** 限制实际读取字节数，也处理没有/伪造 Content-Length 的分块响应。 */
async function boundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    signal.throwIfAborted()
    const declared = Number(response.headers.get('content-length'))
    if (declared > maxBytes) throw httpError('响应体超过大小限制', 413)
    while (true) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw httpError('响应体超过大小限制', 413)
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { headers, allowHost, maxRedirects = 3, timeoutMs = 20_000, maxBytes = 30 * 1024 * 1024, resolve, fetcher = transportFetch as unknown as typeof fetch } = opts
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw httpError('非法响应体大小限制')
  // 同一个截止时间涵盖所有跳转及最终响应体读取。
  const signal = AbortSignal.timeout(timeoutMs)
  let url = new URL(raw)
  for (let hop = 0; ; hop++) {
    if (allowHost && !allowHost(url.hostname)) throw httpError('不允许访问该域名')
    const addresses = await withDeadline(publicAddresses(url, resolve), signal)
    signal.throwIfAborted()
    // 只把本次已检查的地址交给实际 socket，禁止连接时再次解析 DNS。
    // 保留 URL 主机名，HTTP Host / TLS SNI 与证书校验仍使用原域名。
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    } } })
    try {
      const init: RequestInit & { dispatcher: Agent } = { headers, redirect: 'manual', signal, dispatcher }
      const response = await fetcher(url, init)
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel()
        if (hop >= maxRedirects) throw httpError('重定向次数过多', 502)
        url = new URL(response.headers.get('location')!, url)
        continue
      }
      const body = await boundedBody(response, maxBytes, signal)
      // fetch 已自动解压，缓冲结果不再带有压缩体的长度/编码。
      const resultHeaders = new Headers(response.headers)
      resultHeaders.delete('content-encoding')
      resultHeaders.delete('content-length')
      return new Response(body ? new Uint8Array(body) : null, { status: response.status, statusText: response.statusText, headers: resultHeaders })
    } finally {
      await dispatcher.destroy()
    }
  }
}

/** 导入时允许转存图片的图床：微信、秀米（按官方文档推断，未实测） */
export const IMAGE_HOST = /(^|\.)(qpic\.cn|qlogo\.cn|xiumi\.us|xiumius\.cn)$/i

/** 微信图床：编辑器显示背景图时经服务端转发 */
export const WECHAT_IMAGE_HOST = /(^|\.)(qpic\.cn|qlogo\.cn)$/i
