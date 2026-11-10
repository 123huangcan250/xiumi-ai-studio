import { afterEach, expect, it, vi } from 'vitest'
import { api, type AiProfile } from '../../src/editor/api'
const profile: AiProfile = { id: 'p', name: 'P', provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: '', model: 'm', jsonMode: true }
afterEach(() => vi.unstubAllGlobals())
it.each([false, true])('normalizes the model response without losing metadata (envelope=%s)', async (envelope) => {
  const models = [{ id: 'm', contextWindow: 128000, maxOutput: 8192, efforts: ['low', 'high'] }]
  vi.stubGlobal('fetch', async () => Response.json(envelope ? { models } : models))
  expect(await api.aiModels(profile)).toEqual(models)
})
it('rejects malformed model responses with a useful error', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ models: 'not a list' }))
  await expect(api.aiModels(profile)).rejects.toThrow(/模型列表/)
})
