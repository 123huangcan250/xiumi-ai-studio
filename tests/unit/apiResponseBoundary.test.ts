import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../../src/editor/api'
afterEach(() => vi.unstubAllGlobals())
it.each([new DOMException('body cancelled', 'AbortError'), new SyntaxError('incomplete JSON')])('preserves successful response body failure: %s', async error => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw error } }))
  await expect(api.projects()).rejects.toBe(error)
})
it.each([204, 205])('supports bodyless success %s without parsing JSON', async status => {
  const json = vi.fn(async () => { throw new SyntaxError('no body') })
  vi.stubGlobal('fetch', async () => ({ ok: true, status, json }))
  expect(await api.deleteProject('fixture')).toEqual({})
  expect(json).not.toHaveBeenCalled()
})
it.each([null, 'not-json', { error: 'conflict' }])('retains status-based HTTP failure for %j', async body => {
  vi.stubGlobal('fetch', async () => new Response(body === 'not-json' ? body : JSON.stringify(body), { status: 409, statusText: 'Conflict' }))
  await expect(api.projects()).rejects.toMatchObject({ status: 409, message: typeof body === 'object' && body ? 'conflict' : '409 Conflict' })
  await expect(api.projects()).rejects.toBeInstanceOf(ApiError)
})
