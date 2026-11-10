import net from 'node:net'
import tls from 'node:tls'
import { gzipSync } from 'node:zlib'
import { MockAgent, fetch as transportFetch } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeFetch } from '../../server/net'

const publicDns = async () => [{ address: '93.184.216.34' }]
afterEach(() => vi.restoreAllMocks())

describe('red team: fetch transport boundaries', () => {
  it('pins the validated DNS answer to the actual socket lookup', async () => {
    // Stop only the external TCP connection. Exercise safeFetch and its real dispatcher.
    let connection: { host?: string; lookup?: (host: string, options: { all: boolean }, cb: (...args: unknown[]) => void) => void } | undefined
    vi.spyOn(net, 'connect').mockImplementation(((options: typeof connection) => {
      connection = options
      const socket = new net.Socket()
      queueMicrotask(() => socket.destroy(new Error('test transport stopped')))
      return socket
    }) as typeof net.connect)
    const resolve = vi.fn().mockResolvedValueOnce([{ address: '93.184.216.34' }]).mockResolvedValue([{ address: '127.0.0.1' }])
    await expect(safeFetch('http://rebind.example/path', { resolve })).rejects.toThrow()
    expect(connection?.host).toBe('rebind.example')
    expect(connection?.lookup).toBeTypeOf('function')
    const addresses = await new Promise((done) => connection!.lookup!('rebind.example', { all: true }, (_error, result) => done(result)))
    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('retains the HTTPS hostname and SNI while pinning the socket address', async () => {
    let connection: { host?: string; servername?: string; rejectUnauthorized?: boolean; lookup?: unknown } | undefined
    vi.spyOn(tls, 'connect').mockImplementation(((options: typeof connection) => {
      connection = options
      const socket = new net.Socket()
      queueMicrotask(() => socket.destroy(new Error('test TLS transport stopped')))
      return socket
    }) as typeof tls.connect)
    await expect(safeFetch('https://secure.example/path', { resolve: publicDns })).rejects.toThrow()
    expect(connection?.host).toBe('secure.example')
    expect(connection?.servername).toBe('secure.example')
    expect(connection?.rejectUnauthorized).not.toBe(false)
    expect(connection?.lookup).toBeTypeOf('function')
  })

  it('shares one deadline across delayed redirects', async () => {
    const signals = new Set<AbortSignal>()
    const fetcher = (async (_url: URL, init: RequestInit) => {
      signals.add(init.signal!)
      await new Promise((done) => setTimeout(done, 40))
      return new Response(null, { status: 302, headers: { location: '/next' } })
    }) as unknown as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, timeoutMs: 100, maxRedirects: 10 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(signals.size).toBe(1)
  })

  it('limits decompressed bytes, not only the small compressed payload', async () => {
    const dispatcher = new MockAgent()
    dispatcher.disableNetConnect()
    const compressed = gzipSync(Buffer.alloc(100_000, 'a'))
    expect(compressed.byteLength).toBeLessThan(1000)
    dispatcher.get('https://example.com').intercept({ path: '/' }).reply(200, compressed, {
      headers: { 'content-encoding': 'gzip', 'content-length': String(compressed.byteLength) },
    })
    const fetcher = ((url: URL, init: RequestInit) => transportFetch(url, { signal: init.signal, redirect: init.redirect, dispatcher })) as unknown as typeof fetch
    try {
      await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 1000 })).rejects.toThrow('大小')
    } finally { await dispatcher.close() }
  })

  it('applies the deadline while DNS resolution is stalled', async () => {
    await expect(safeFetch('https://example.com/', { resolve: () => new Promise(() => {}), timeoutMs: 30 })).rejects.toThrow()
  }, 1000)

  it('rejects an oversized stream and cancels it before reading the tail', async () => {
    let pulled = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(4)) },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const fetcher = (async () => new Response(body)) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 5 })).rejects.toThrow('大小')
    expect(pulled).toBe(2)
    expect(cancelled).toBe(true)
  })

  it('rejects an oversized Content-Length without reading any body', async () => {
    let pulled = false
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled = true; controller.enqueue(new Uint8Array(1)) },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const fetcher = (async () => new Response(body, { headers: { 'content-length': '1000' } })) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 5 })).rejects.toThrow('大小')
    expect(pulled).toBe(false)
    expect(cancelled).toBe(true)
  })

  it('allows an exact byte limit and preserves status and content type', async () => {
    const fetcher = (async () => new Response('你好', { status: 201, headers: { 'content-type': 'text/plain' } })) as typeof fetch
    const response = await safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 6 })
    expect(await response.text()).toBe('你好')
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('text/plain')
  })

  it('cancels redirect bodies rather than buffering them', async () => {
    let cancelled = false
    const redirect = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 302, headers: { location: '/next' } })
    const fetcher = vi.fn().mockResolvedValueOnce(redirect).mockResolvedValueOnce(new Response('ok'))
    expect(await (await safeFetch('https://example.com/', { resolve: publicDns, fetcher })).text()).toBe('ok')
    expect(cancelled).toBe(true)
  })

  it('stops waiting for a stalled response body at the deadline', async () => {
    let cancelled = false
    const fetcher = (async () => new Response(new ReadableStream({ cancel() { cancelled = true } }))) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, timeoutMs: 30 })).rejects.toThrow()
    expect(cancelled).toBe(true)
  }, 1000)
})
