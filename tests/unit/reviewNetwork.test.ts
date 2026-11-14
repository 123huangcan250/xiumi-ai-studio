import { describe, expect, it } from 'vitest'
import { isPrivateAddress, safeFetch, MAX_PAGE_BYTES } from '../../server/net'

describe('review: translated and protocol-assignment addresses', () => {
  it.each(['192.0.0.0', '192.0.0.9', '192.0.0.255', '64:ff9b::7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', '2002:a00:1::'])('rejects %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })
})

describe('review: actionable fetch timeouts', () => {
  it('reports DNS deadline as a Chinese gateway timeout', async () => {
    await expect(safeFetch('https://example.com', { timeoutMs: 10, resolve: () => new Promise(() => {}) })).rejects.toMatchObject({ status: 504, message: expect.stringContaining('超时') })
  })
  it('reports response body deadline as a Chinese gateway timeout', async () => {
    const fetcher = (async () => new Response(new ReadableStream())) as typeof fetch
    await expect(safeFetch('https://example.com', { bodyTimeoutMs: 10, resolve: async () => [{ address: '8.8.8.8' }], fetcher })).rejects.toMatchObject({ status: 504, message: expect.stringContaining('超时') })
  })
})

it('imports a complete multibyte article above 5 MB within the bounded page budget', async () => {
  expect(MAX_PAGE_BYTES).toBe(15_000_000)
  const html = '<article>' + '中'.repeat(2_000_000) + '</article>'
  const response = await safeFetch('https://example.com', {
    resolve: async () => [{ address: '8.8.8.8' }],
    fetcher: (async () => new Response(html)) as typeof fetch,
    maxBytes: MAX_PAGE_BYTES,
  })
  expect(await response.text()).toBe(html)
})
