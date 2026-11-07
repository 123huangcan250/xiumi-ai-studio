import { describe, expect, it } from 'vitest'
import { assertPublicUrl, IMAGE_HOST, isPrivateAddress, safeFetch, WECHAT_IMAGE_HOST } from '../../server/net'
import { validateDraft } from '../../server/wechat'

const publicDns = async () => [{ address: '93.184.216.34' }]
const privateDns = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.8' }]

describe('private address check', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })
  it.each(['8.8.8.8', '198.18.0.5', '172.32.0.1', '100.128.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('public url check', () => {
  it.each(['http://localhost/x', 'http://foo.local/', 'http://a.internal/', 'http://127.0.0.1/', 'http://2130706433/', 'http://[::1]/', 'http://0x7f.0.0.1/', 'http://198.18.0.5/'])('rejects %s', async (u) => {
    await expect(assertPublicUrl(new URL(u), publicDns)).rejects.toThrow('内网')
  })
  it('rejects other protocols', async () => {
    await expect(assertPublicUrl(new URL('file:///etc/passwd'), publicDns)).rejects.toThrow('http')
  })
  it('rejects a domain that resolves to a private address', async () => {
    await expect(assertPublicUrl(new URL('https://rebind.example/'), privateDns)).rejects.toThrow('内网')
  })
  it('allows domains behind a fake-ip proxy, which all resolve to 198.18.x.x', async () => {
    await expect(assertPublicUrl(new URL('https://mmbiz.qpic.cn/a'), async () => [{ address: '198.18.0.5' }])).resolves.toBeUndefined()
  })
  it('allows a public domain', async () => {
    await expect(assertPublicUrl(new URL('https://example.com/'), publicDns)).resolves.toBeUndefined()
  })
})

describe('safe fetch', () => {
  const respond = (status: number, location?: string) => new Response(status === 200 ? 'ok' : null, { status, headers: location ? { location } : {} })
  const seq = (...list: Response[]) => {
    const seen: string[] = []
    const fetcher = (async (u: URL) => {
      seen.push(String(u))
      return list.shift()!
    }) as unknown as typeof fetch
    return { seen, fetcher }
  }
  it('follows a redirect after checking the target', async () => {
    const { seen, fetcher } = seq(respond(302, '/next'), respond(200))
    const r = await safeFetch('https://a.example/start', { fetcher, resolve: publicDns })
    expect(r.status).toBe(200)
    expect(seen).toEqual(['https://a.example/start', 'https://a.example/next'])
  })
  it('refuses a redirect to an internal address', async () => {
    const { seen, fetcher } = seq(respond(302, 'http://169.254.169.254/latest/meta-data'))
    await expect(safeFetch('https://a.example/', { fetcher, resolve: publicDns })).rejects.toThrow('内网')
    expect(seen).toHaveLength(1)
  })
  it('refuses a redirect off the allowed image hosts', async () => {
    const { fetcher } = seq(respond(302, 'https://evil.example/x.jpg'))
    await expect(safeFetch('https://mmbiz.qpic.cn/x', { fetcher, resolve: publicDns, allowHost: (h) => IMAGE_HOST.test(h) })).rejects.toThrow('域名')
  })
  it('stops after too many redirects', async () => {
    const { fetcher } = seq(respond(302, '/1'), respond(302, '/2'), respond(302, '/3'))
    await expect(safeFetch('https://a.example/', { fetcher, resolve: publicDns, maxRedirects: 2 })).rejects.toThrow('重定向')
  })
  it('only forwards WeChat images for display', () => {
    expect(WECHAT_IMAGE_HOST.test('mmbiz.qpic.cn')).toBe(true)
    for (const h of ['img.xiumi.us', 'evil.com', 'qpic.cn.evil.com', 'localhost']) expect(WECHAT_IMAGE_HOST.test(h)).toBe(false)
  })
  it('limits image hosts to WeChat and Xiumi', () => {
    for (const h of ['mmbiz.qpic.cn', 'wx.qlogo.cn', 'img.xiumi.us', 'xiumi.us', 'a.xiumius.cn']) expect(IMAGE_HOST.test(h)).toBe(true)
    for (const h of ['evil.com', 'xiumi.us.evil.com', 'fakexiumi.us', 'qpic.cn.evil.com']) expect(IMAGE_HOST.test(h)).toBe(false)
  })
})

describe('draft validation of backgrounds', () => {
  const base = { title: '标题', thumb_media_id: 'm1' }
  it('rejects local and non-WeChat backgrounds', () => {
    expect(validateDraft({ ...base, content: '<section style="background-image: url(&quot;/media/a.jpg&quot;)"></section>' }).join()).toContain('背景图')
    expect(validateDraft({ ...base, content: '<section style="background-image: url(https://img.xiumi.us/a.jpg)"></section>' }).join()).toContain('背景图')
  })
  it('accepts WeChat backgrounds, gradients and svg paint references', () => {
    const content = '<section style="background-image: url(&quot;https://mmbiz.qpic.cn/a/0&quot;)"></section><section style="background-image: linear-gradient(0deg, #fff, #000)"></section><svg><rect fill="url(#a)"></rect></svg>'
    expect(validateDraft({ ...base, content })).toEqual([])
  })
})
