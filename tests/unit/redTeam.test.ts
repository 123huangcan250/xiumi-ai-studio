import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isPrivateAddress, safeFetch } from '../../server/net'
import { writeJson } from '../../server/store'

const publicDns = async () => [{ address: '93.184.216.34' }]

describe('red team: alternate IP representations', () => {
  it.each([
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:198.18.0.5]/',
  ])('rejects mapped private or literal proxy target %s', async (url) => {
    await expect(assertPublicUrl(new URL(url), publicDns)).rejects.toThrow('内网')
  })

  it('rejects mapped private addresses returned by DNS', async () => {
    await expect(assertPublicUrl(new URL('https://example.com/'), async () => [{ address: '::ffff:a00:1' }])).rejects.toThrow('内网')
  })

  it('does not send a redirected request to mapped loopback', async () => {
    const seen: string[] = []
    const fetcher = (async (url: URL) => {
      seen.push(String(url))
      return new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/' } })
    }) as unknown as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher })).rejects.toThrow('内网')
    expect(seen).toEqual(['https://example.com/'])
  })

  it('rejects scoped link-local DNS addresses without a URL parsing error', () => {
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true)
  })

  it.each(['198.19.0.5', '::ffff:c613:5'])('preserves fake-IP proxy DNS compatibility for %s', async (address) => {
    await expect(assertPublicUrl(new URL('https://example.com/'), async () => [{ address }])).resolves.toBeUndefined()
    await expect(assertPublicUrl(new URL(address.includes(':') ? `http://[${address}]/` : `http://${address}/`))).rejects.toThrow('内网')
  })

  it('continues allowing public mapped IPv4 addresses', async () => {
    await expect(assertPublicUrl(new URL('https://[::ffff:8.8.8.8]/'), publicDns)).resolves.toBeUndefined()
  })
})

describe('red team: overlapping autosaves', () => {
  it('removes temporary data if atomic replacement fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-failed-save-'))
    try {
      const target = join(dir, 'target')
      await mkdir(target)
      await expect(writeJson(target, { text: 'unsaved' })).rejects.toThrow()
      expect(await readdir(dir)).toEqual(['target'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('completes concurrent writes with a complete JSON document and no temporary files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-concurrent-'))
    try {
      const file = join(dir, 'project.json')
      const docs = Array.from({ length: 32 }, (_, id) => ({ id, text: String(id).repeat(10000) }))
      const results = await Promise.allSettled(docs.map((doc) => writeJson(file, doc)))
      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
      const saved = JSON.parse(await readFile(file, 'utf8'))
      expect(docs).toContainEqual(saved)
      expect(await readdir(dir)).toEqual(['project.json'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
